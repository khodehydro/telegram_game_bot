"""Game registry — maps a game key to its engine class."""

from __future__ import annotations

from .base import BaseGame, GameError
from .hokm import HokmGame
from .pasur import PasurGame

GAMES: dict[str, type[BaseGame]] = {
    PasurGame.GAME: PasurGame,
    HokmGame.GAME: HokmGame,
}

FA_NAMES: dict[str, str] = {
    "pasur": "پاسور",
    "hokm": "حکم",
}

EMOJI: dict[str, str] = {
    "pasur": "🎣",
    "hokm": "👑",
}


def get_engine_class(key: str) -> type[BaseGame]:
    try:
        return GAMES[key]
    except KeyError:
        raise GameError(f"unknown game: {key}", fa="این بازی وجود ندارد.") from None


def name_fa(key: str) -> str:
    return FA_NAMES.get(key, key)


def emoji(key: str) -> str:
    return EMOJI.get(key, "🎴")
