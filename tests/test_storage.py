from __future__ import annotations

import pytest

from bot.db.storage import Database, normalise_dsn


def test_normalise_dsn():
    assert normalise_dsn("postgres://u:p@h:5432/db").startswith("postgresql+asyncpg://")
    assert normalise_dsn("postgresql://u:p@h/db").startswith("postgresql+asyncpg://")
    assert normalise_dsn("sqlite:///tmp/x.db").startswith("sqlite+aiosqlite://")


@pytest.mark.asyncio
async def test_user_and_session_lifecycle(tmp_path):
    db = Database(f"sqlite:///{tmp_path}/test.db")
    await db.start()

    user = await db.upsert_user(42, "ali", "Ali")
    assert user.id == 42

    session = await db.create_session(
        chat_id=-100, chat_type="supergroup", game="pasur", owner_id=42, players=[42]
    )
    assert session.status == "lobby"

    found = await db.get_active_session(-100)
    assert found is not None and found.id == session.id

    session.status = "running"
    session.state = {"phase": "playing", "names": ["Ali"]}
    await db.save_session(session)

    reloaded = await db.get_session(session.id)
    assert reloaded is not None
    assert reloaded.status == "running"
    assert reloaded.state["names"] == ["Ali"]

    await db.record_result(
        session_id=session.id,
        game="pasur",
        chat_id=-100,
        players=[{"user_id": 42, "seat": 0, "won": True, "points": 62}],
        winner_seat=0,
    )
    stats = await db.get_user(42)
    assert stats is not None
    assert stats.wins == 1 and stats.games_played == 1 and stats.points == 62

    board = await db.leaderboard()
    assert board and board[0].id == 42

    await db.finish_session(session.id)
    assert await db.get_active_session(-100) is None
    await db.close()


@pytest.mark.asyncio
async def test_active_sessions_listing(tmp_path):
    db = Database(f"sqlite:///{tmp_path}/x.db")
    await db.start()
    await db.create_session(chat_id=1, chat_type="group", game="pasur", owner_id=1, players=[1])
    rows = await db.list_active_sessions()
    assert len(rows) == 1
    await db.close()


def test_supabase_ssl_is_translated_to_connect_args():
    from bot.db.storage import split_ssl_options

    url, args = split_ssl_options(
        "postgresql+asyncpg://bot.app:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    assert "sslmode" not in url
    assert "ssl" in args and args["ssl"] is not None


def test_supabase_defaults_to_tls_without_sslmode():
    from bot.db.storage import split_ssl_options

    _, args = split_ssl_options("postgresql+asyncpg://u:p@db.abcdefgh.supabase.co:5432/postgres")
    assert "ssl" in args


def test_plain_postgres_gets_no_forced_tls():
    from bot.db.storage import split_ssl_options

    url, args = split_ssl_options("postgresql+asyncpg://u:p@localhost:5432/postgres")
    assert args == {}
    assert "localhost" in url


def test_sqlite_untouched():
    from bot.db.storage import split_ssl_options

    url, args = split_ssl_options("sqlite+aiosqlite:///data/x.db")
    assert args == {} and "data/x.db" in url
