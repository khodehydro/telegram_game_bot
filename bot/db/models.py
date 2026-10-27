"""SQLAlchemy models.

Works on SQLite (local development, tests) and PostgreSQL / Supabase
(production).  ``create_all`` runs at start-up, so no manual migration is
required; ``scripts/schema.sql`` mirrors the same schema for reference.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)  # telegram user id
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # aggregated stats
    games_played: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    points: Mapped[int] = mapped_column(Integer, default=0)


class GameSession(Base):
    """A lobby or a running/finished match inside a chat."""

    __tablename__ = "game_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, index=True)
    chat_type: Mapped[str] = mapped_column(String(16), default="group")
    game: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="lobby", index=True)
    owner_id: Mapped[int] = mapped_column(BigInteger)
    message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MatchResult(Base):
    __tablename__ = "match_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id", ondelete="CASCADE"))
    game: Mapped[str] = mapped_column(String(16), index=True)
    chat_id: Mapped[int] = mapped_column(BigInteger)
    # JSON: list of {"user_id": int, "seat": int, "won": bool, "points": int}
    players: Mapped[list] = mapped_column(JSON, default=list)
    winner_seat: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
