"""Shared game-engine contract.

Engines are pure Python: they never touch Telegram or the database.  A game
state is a plain ``dict`` (JSON-serialisable) that the storage layer persists
as-is, so a bot restart can resume a running match.
"""

from __future__ import annotations

import time
from typing import Any, Protocol


class GameError(Exception):
    """Raised for an action that is not allowed in the current state."""

    def __init__(self, message: str, *, fa: str | None = None) -> None:
        super().__init__(message)
        self.fa = fa or message


class BaseGame:
    """Base class for all games."""

    GAME: str = ""
    MIN_PLAYERS: int = 1
    MAX_PLAYERS: int = 1
    TURN_SECONDS: int = 60

    def __init__(self, state: dict[str, Any]) -> None:
        self.state = state

    # -- lifecycle -----------------------------------------------------
    @classmethod
    def new(cls, players: list[int], **options: Any) -> dict[str, Any]:
        raise NotImplementedError

    # -- queries -------------------------------------------------------
    @property
    def phase(self) -> str:
        return self.state["phase"]

    @property
    def finished(self) -> bool:
        return self.state["phase"] == "finished"

    def current_seat(self) -> int | None:
        """Seat expected to act, or ``None`` when nobody is expected."""
        raise NotImplementedError

    def is_player(self, user_id: int) -> bool:
        return user_id in self.state["players"]

    def seat_of(self, user_id: int) -> int | None:
        try:
            return self.state["players"].index(user_id)
        except ValueError:
            return None

    def legal_actions(self, seat: int) -> list[dict[str, Any]]:
        raise NotImplementedError

    def view(self, seat: int | None) -> dict[str, Any]:
        """Public (seat is None) or private view of the game."""
        raise NotImplementedError

    # -- mutation ------------------------------------------------------
    def apply(self, seat: int, action: dict[str, Any]) -> list[dict[str, Any]]:
        """Apply an action; returns a list of events for the transport layer."""
        raise NotImplementedError

    def auto_action(self, seat: int) -> dict[str, Any]:
        """Default action used when a player times out."""
        raise NotImplementedError

    # -- helpers -------------------------------------------------------
    def touch_deadline(self) -> None:
        self.state["deadline"] = int(time.time()) + self.TURN_SECONDS

    def clear_deadline(self) -> None:
        self.state["deadline"] = None

    def log(self, text: str) -> None:
        self.state.setdefault("log", []).append(text)
        # keep the persisted state small
        del self.state["log"][:-60]


class EngineProtocol(Protocol):  # pragma: no cover - typing helper
    GAME: str

    def __init__(self, state: dict[str, Any]) -> None: ...
    def is_player(self, user_id: int) -> bool: ...
    def current_seat(self) -> int | None: ...
