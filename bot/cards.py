"""Primitives for a standard 52-card deck with Persian rendering.

Cards are persisted as compact codes such as ``"SA"`` (ace of spades) or
``"H10"`` (ten of hearts) so that game state stays JSON-serialisable.
"""

from __future__ import annotations

import random
from collections.abc import Iterable
from dataclasses import dataclass
from enum import Enum


class Suit(str, Enum):
    SPADES = "S"
    HEARTS = "H"
    DIAMONDS = "D"
    CLUBS = "C"

    @property
    def fa(self) -> str:
        return SUIT_FA[self]

    @property
    def emoji(self) -> str:
        return SUIT_EMOJI[self]

    @property
    def red(self) -> bool:
        return self in (Suit.HEARTS, Suit.DIAMONDS)


SUITS: tuple[Suit, ...] = (Suit.SPADES, Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS)

SUIT_FA: dict[Suit, str] = {
    Suit.SPADES: "پیک",
    Suit.HEARTS: "دل",
    Suit.DIAMONDS: "خشت",
    Suit.CLUBS: "گشنیز",
}

SUIT_EMOJI: dict[Suit, str] = {
    Suit.SPADES: "♠️",
    Suit.HEARTS: "♥️",
    Suit.DIAMONDS: "♦️",
    Suit.CLUBS: "♣️",
}

# 11 = J, 12 = Q, 13 = K, 14 = A
RANKS: tuple[int, ...] = tuple(range(2, 15))
JACK, QUEEN, KING, ACE = 11, 12, 13, 14

_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def fa_number(value: int | str) -> str:
    """Convert latin digits to Persian digits."""
    return str(value).translate(_FA_DIGITS)


_CODE_LABEL: dict[int, str] = {JACK: "J", QUEEN: "Q", KING: "K", ACE: "A"}
_CODE_RANK: dict[str, int] = {v: k for k, v in _CODE_LABEL.items()}

RANK_FA: dict[int, str] = {
    2: "۲",
    3: "۳",
    4: "۴",
    5: "۵",
    6: "۶",
    7: "۷",
    8: "۸",
    9: "۹",
    10: "۱۰",
    JACK: "سرباز",
    QUEEN: "بی‌بی",
    KING: "شاه",
    ACE: "آس",
}


@dataclass(frozen=True, order=False)
class Card:
    suit: Suit
    rank: int

    def __post_init__(self) -> None:  # pragma: no cover - defensive
        if self.rank not in RANKS:
            raise ValueError(f"invalid rank: {self.rank}")

    # -- serialisation -------------------------------------------------
    @property
    def code(self) -> str:
        return f"{self.suit.value}{_CODE_LABEL.get(self.rank, self.rank)}"

    @classmethod
    def from_code(cls, code: str) -> Card:
        raw = str(code).strip().upper()
        if len(raw) < 2:
            raise ValueError(f"invalid card code: {code!r}")
        suit = Suit(raw[0])
        rank_part = raw[1:]
        rank = _CODE_RANK.get(rank_part)
        if rank is None:
            rank = int(rank_part)
        return cls(suit, rank)

    # -- rendering -----------------------------------------------------
    @property
    def label(self) -> str:
        return f"{RANK_FA[self.rank]} {self.suit.emoji}"

    @property
    def short(self) -> str:
        return f"{RANK_FA[self.rank]} {self.suit.emoji}"

    def __str__(self) -> str:  # pragma: no cover - convenience
        return self.label


def full_deck() -> list[Card]:
    return [Card(suit, rank) for suit in SUITS for rank in RANKS]


def shuffled_deck(rng: random.Random | None = None) -> list[Card]:
    deck = full_deck()
    (rng or random).shuffle(deck)
    return deck


def cards_from_codes(codes: Iterable[str]) -> list[Card]:
    return [Card.from_code(c) for c in codes]


def codes(cards: Iterable[Card]) -> list[str]:
    return [c.code for c in cards]


def sort_cards(codes_in: Iterable[str], *, trump: str | None = None) -> list[str]:
    """Sort card codes by suit then descending rank (trump suit first)."""
    cards = cards_from_codes(codes_in)

    def key(card: Card) -> tuple[int, int, int]:
        trump_first = 0 if trump and card.suit.value == trump else 1
        return (trump_first, SUITS.index(card.suit), -card.rank)

    return [c.code for c in sorted(cards, key=key)]


def render_cards(codes_in: Iterable[str]) -> str:
    return "، ".join(Card.from_code(c).label for c in codes_in)


def team_of(seat: int, players_count: int = 4) -> int:
    """Team index for a seat (0 vs 1, alternating seats)."""
    return seat % 2
