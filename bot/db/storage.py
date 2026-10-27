"""Async storage layer (SQLite for development, PostgreSQL/Supabase in prod)."""

from __future__ import annotations

import contextlib
import datetime as dt
import os
import secrets
import ssl
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .models import Base, GameSession, MatchResult, User


def normalise_dsn(url: str) -> str:
    """Accept Supabase/Heroku style URLs and add the async driver."""
    url = url.strip()
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("sqlite://") and "+aiosqlite" not in url:
        url = url.replace("sqlite://", "sqlite+aiosqlite://", 1)
    return url


def is_supabase_host(host: str | None) -> bool:
    if not host:
        return False
    return "supabase.co" in host or "supabase.com" in host or "supabase.net" in host


def split_ssl_options(url: str) -> tuple[str, dict[str, Any]]:
    """Translate libpq ``sslmode``/``ssl`` query params to asyncpg connect args.

    The Supabase dashboard hands out URLs like
    ``postgresql://user.pass@host:5432/postgres?sslmode=require``.
    asyncpg does not understand ``sslmode`` (it would be passed through as an
    unexpected keyword), so the parameter is removed from the URL and converted
    into an ``ssl`` connect argument.
    """
    try:
        parsed = make_url(url)
    except Exception:  # pragma: no cover - malformed URL, let the driver complain
        return url, {}

    if parsed.drivername.startswith("sqlite"):
        return url, {}

    query = dict(parsed.query)
    mode = query.pop("sslmode", None) or query.pop("ssl", None)
    if isinstance(mode, (list, tuple)):  # pragma: no cover
        mode = mode[0]

    connect_args: dict[str, Any] = {}
    host = parsed.host or ""

    if mode is None and is_supabase_host(host):
        mode = "require"  # Supabase always wants TLS

    if mode:
        mode = str(mode).lower()
        if mode in ("disable", "false", "0", "off"):
            connect_args["ssl"] = False
        elif mode in ("no-verify", "allow", "insecure"):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            connect_args["ssl"] = ctx
        else:  # require / prefer / verify-ca / verify-full
            connect_args["ssl"] = ssl.create_default_context()

    parsed = parsed.set(query=query) if query else parsed.set(query={})
    return parsed.render_as_string(hide_password=False), connect_args


def new_id() -> str:
    return secrets.token_hex(8)


class Database:
    def __init__(self, dsn: str) -> None:
        url, connect_args = split_ssl_options(normalise_dsn(dsn))
        kwargs: dict[str, Any] = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            path = url.split("///")[-1]
            if path and path != ":memory:":
                os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
            kwargs = {}
        else:
            # Supabase/Supavisor: keep the pool small and recycle stale sockets
            kwargs.update(pool_size=5, max_overflow=5, pool_recycle=1800)
            if connect_args:
                kwargs["connect_args"] = connect_args
        self.engine = create_async_engine(url, **kwargs)
        self.sessions = async_sessionmaker(self.engine, class_=AsyncSession, expire_on_commit=False)

    async def start(self) -> None:
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def close(self) -> None:
        await self.engine.dispose()

    # ------------------------------------------------------------------ users
    async def upsert_user(self, user_id: int, username: str | None, first_name: str | None) -> User:
        async with self.sessions() as db:
            user = await db.get(User, user_id)
            if user is None:
                user = User(id=user_id, username=username, first_name=first_name)
                db.add(user)
            else:
                user.username = username
                user.first_name = first_name
            await db.commit()
            return user

    async def get_user(self, user_id: int) -> User | None:
        async with self.sessions() as db:
            return await db.get(User, user_id)

    async def leaderboard(self, limit: int = 10) -> Sequence[User]:
        async with self.sessions() as db:
            rows = await db.execute(
                select(User)
                .where(User.games_played > 0)
                .order_by(User.wins.desc(), User.points.desc(), User.games_played.desc())
                .limit(limit)
            )
            return rows.scalars().all()

    # ------------------------------------------------------------------ sessions
    async def create_session(
        self,
        *,
        chat_id: int,
        chat_type: str,
        game: str,
        owner_id: int,
        players: list[int],
    ) -> GameSession:
        async with self.sessions() as db:
            session = GameSession(
                id=new_id(),
                chat_id=chat_id,
                chat_type=chat_type,
                game=game,
                status="lobby",
                owner_id=owner_id,
                state={"phase": "lobby", "players": players},
            )
            db.add(session)
            await db.commit()
            return session

    async def get_session(self, session_id: str) -> GameSession | None:
        async with self.sessions() as db:
            return await db.get(GameSession, session_id)

    async def get_active_session(self, chat_id: int) -> GameSession | None:
        async with self.sessions() as db:
            rows = await db.execute(
                select(GameSession)
                .where(GameSession.chat_id == chat_id, GameSession.status.in_(("lobby", "running")))
                .order_by(GameSession.created_at.desc())
                .limit(1)
            )
            return rows.scalar_one_or_none()

    async def save_session(self, session: GameSession) -> None:
        async with self.sessions() as db:
            await db.execute(
                update(GameSession)
                .where(GameSession.id == session.id)
                .values(
                    status=session.status,
                    state=session.state,
                    message_id=session.message_id,
                    updated_at=dt.datetime.now(dt.timezone.utc),
                )
            )
            await db.commit()

    async def finish_session(self, session_id: str) -> None:
        async with self.sessions() as db:
            await db.execute(
                update(GameSession)
                .where(GameSession.id == session_id)
                .values(status="finished", updated_at=dt.datetime.now(dt.timezone.utc))
            )
            await db.commit()

    # ------------------------------------------------------------------ results
    async def record_result(
        self,
        *,
        session_id: str,
        game: str,
        chat_id: int,
        players: list[dict[str, Any]],
        winner_seat: int | None,
    ) -> None:
        async with self.sessions() as db:
            db.add(
                MatchResult(
                    session_id=session_id,
                    game=game,
                    chat_id=chat_id,
                    players=players,
                    winner_seat=winner_seat,
                )
            )
            for entry in players:
                user = await db.get(User, entry["user_id"])
                if user is None:
                    user = User(id=entry["user_id"])
                    db.add(user)
                user.games_played = (user.games_played or 0) + 1
                if entry.get("won"):
                    user.wins = (user.wins or 0) + 1
                else:
                    user.losses = (user.losses or 0) + 1
                user.points = (user.points or 0) + int(entry.get("points", 0))
            await db.commit()

    # ------------------------------------------------------------------ maintenance
    async def list_active_sessions(self) -> list[GameSession]:
        async with self.sessions() as db:
            rows = await db.execute(
                select(GameSession).where(GameSession.status.in_(("lobby", "running")))
            )
            return list(rows.scalars().all())

    async def active_sessions_count(self) -> int:
        async with self.sessions() as db:
            rows = await db.execute(select(GameSession).where(GameSession.status == "running"))
            return len(rows.scalars().all())

    async def delete_session(self, session_id: str) -> None:
        """Remove a session and its results (used by tests / the doctor script)."""
        from sqlalchemy import delete, text

        async with self.sessions() as db:
            with contextlib.suppress(Exception):
                await db.execute(delete(MatchResult).where(MatchResult.session_id == session_id))
            await db.execute(text("delete from game_sessions where id = :sid"), {"sid": session_id})
            await db.commit()

    async def delete_user(self, user_id: int) -> None:
        from sqlalchemy import delete

        async with self.sessions() as db:
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()
