"""Pâsur (پاسور / Basra) engine — Persian fishing card game.

Rules implemented (Pagat / Wikipedia consensus):

* 52 cards, 2–4 players (4 players play in two partnerships).
* Deal: 4 cards to each player and 4 face-up to the table.  If the table shows
  more than one jack, more than two queens or more than two kings, redeal.
  A lone jack on the table is buried and replaced.
* Capture:
    - King captures the king(s) on the table; queen captures the queen(s).
    - Jack captures every *numeral* card and every jack, never kings/queens.
    - Numeral cards (A=1 … 10=10) capture a set of table cards whose pip values
      sum to 11 together with the played card.
* ``Sur`` (5 points): emptying the table with a non-jack card.  Not scored on
  the last deal, not scored when the side already has 50+ points, and a sur
  cancels an opponent's outstanding sur instead of adding a new one.
* The last player who captured takes the remaining table cards at the end.
* Scoring: each ace 1, each jack 1, 2♣ 2, 10♦ 3, 7+ clubs 7, each sur 5.
  First side to 62 wins; a tie on top keeps the game going.
"""

from __future__ import annotations

import itertools
import random
from collections.abc import Iterable
from typing import Any

from ..cards import ACE, JACK, KING, QUEEN, Card, Suit, shuffled_deck
from .base import BaseGame, GameError

MAX_SCORE = 62
SUR_POINTS = 5
SUR_BLOCK_SCORE = 50


def _pip(card: Card) -> int:
    """Pip value used for the "sum to 11" captures (A=1 … 10=10)."""
    if card.rank == ACE:
        return 1
    if card.rank <= 10:
        return card.rank
    return 0  # face cards never take part in sums


class PasurGame(BaseGame):
    GAME = "pasur"
    MIN_PLAYERS = 2
    MAX_PLAYERS = 4
    TURN_SECONDS = 45

    # ------------------------------------------------------------------ setup
    @classmethod
    def new(cls, players: list[int], **options: Any) -> dict[str, Any]:
        n = len(players)
        if not cls.MIN_PLAYERS <= n <= cls.MAX_PLAYERS:
            raise GameError("pasur needs 2-4 players", fa="پاسور بین ۲ تا ۴ بازیکن نیاز دارد.")
        rng = random.Random(options.get("seed"))
        state: dict[str, Any] = {
            "game": cls.GAME,
            "players": list(players),
            "phase": "playing",
            "hands": [[] for _ in players],
            "piles": [[] for _ in players],
            "surs": [0 for _ in players],
            "scores": [0 for _ in players],
            "table": [],
            "deck": [],
            "dealer": n - 1,
            "turn": 0,
            "deal_no": 0,
            "last_capturer": None,
            "batch": 0,
            "round": 0,
            "log": [],
            "deadline": None,
        }
        game = cls(state)
        game._start_round(rng)
        return state

    # ------------------------------------------------------------------ teams
    def _is_team_game(self) -> bool:
        return len(self.state["players"]) == 4

    def _side(self, seat: int) -> frozenset[int]:
        if not self._is_team_game():
            return frozenset({seat})
        return frozenset({0, 2}) if seat % 2 == 0 else frozenset({1, 3})

    def _opponents(self, seat: int) -> list[int]:
        side = self._side(seat)
        return [s for s in range(len(self.state["players"])) if s not in side]

    def _add_score(self, seat: int, points: int) -> None:
        for s in self._side(seat):
            self.state["scores"][s] += points

    # ------------------------------------------------------------------ dealing
    def _new_deck(self, rng: random.Random) -> list[Card]:
        while True:
            deck = shuffled_deck(rng)
            table = deck[:4]
            rest = deck[4:]
            jacks = sum(1 for c in table if c.rank == JACK)
            queens = sum(1 for c in table if c.rank == QUEEN)
            kings = sum(1 for c in table if c.rank == KING)
            if jacks > 1 or queens > 2 or kings > 2:
                continue
            if jacks == 1:
                jack = next(c for c in table if c.rank == JACK)
                table.remove(jack)
                replacement = rest.pop(0)
                table.append(replacement)
                if replacement.rank == JACK or sum(1 for c in table if c.rank == QUEEN) > 2:
                    continue
                # the buried jack goes to the bottom of the undealt pack
                rest.append(jack)
            self.state["table"] = [c.code for c in table]
            return rest

    def _hands_per_batch(self) -> int:
        return 4

    def _start_round(self, rng: random.Random) -> None:
        st = self.state
        n = len(st["players"])
        st["hands"] = [[] for _ in range(n)]
        st["piles"] = [[] for _ in range(n)]
        st["surs"] = [0 for _ in range(n)]
        st["last_capturer"] = None
        st["batch"] = 0
        st["deck"] = [c.code for c in self._new_deck(rng)]
        st["dealer"] = (st["dealer"] + 1) % n
        st["turn"] = (st["dealer"] + 1) % n
        self._deal_batch()
        st["phase"] = "playing"
        self.touch_deadline()

    def _deal_batch(self) -> None:
        st = self.state
        n = len(st["players"])
        size = self._hands_per_batch()
        deck = [Card.from_code(c) for c in st["deck"]]
        if len(deck) < size * n:
            size = len(deck) // n if n else 0
        for _ in range(size):
            for seat in range(n):
                if deck:
                    st["hands"][seat].append(deck.pop(0).code)
        st["deck"] = [c.code for c in deck]
        st["batch"] += 1

    # ------------------------------------------------------------------ queries
    def current_seat(self) -> int | None:
        if self.finished:
            return None
        return int(self.state["turn"])

    def hand(self, seat: int) -> list[str]:
        return list(self.state["hands"][seat])

    def _cards_on_table(self) -> list[Card]:
        return [Card.from_code(c) for c in self.state["table"]]

    def _capture_options(self, card: Card) -> list[list[str]]:
        """All legal capture sets for ``card`` (empty list → card trails)."""
        table = self._cards_on_table()
        if card.rank == KING:
            outs = [[c.code for c in table if c.rank == KING]]
        elif card.rank == QUEEN:
            outs = [[c.code for c in table if c.rank == QUEEN]]
        elif card.rank == JACK:
            outs = [[c.code for c in table if c.rank == JACK or c.rank <= 10]]
        else:
            target = 11 - _pip(card)
            picks: list[list[str]] = []
            numerals = [c for c in table if c.rank <= 10]
            for r in range(1, len(numerals) + 1):
                for combo in itertools.combinations(numerals, r):
                    if sum(_pip(c) for c in combo) == target:
                        picks.append([c.code for c in combo])
            outs = picks
        return [o for o in outs if o]

    def legal_actions(self, seat: int) -> list[dict[str, Any]]:
        if self.finished or seat != self.state["turn"]:
            return []
        actions: list[dict[str, Any]] = []
        for code in self.state["hands"][seat]:
            card = Card.from_code(code)
            opts = self._capture_options(card)
            if not opts:
                actions.append({"type": "play", "card": code})
            else:
                for opt in opts:
                    actions.append({"type": "play", "card": code, "capture": opt})
        return actions

    def view(self, seat: int | None) -> dict[str, Any]:
        st = self.state
        n = len(st["players"])
        return {
            "game": self.GAME,
            "players": st["players"],
            "phase": st["phase"],
            "turn": st["turn"],
            "table": list(st["table"]),
            "counts": [len(h) for h in st["hands"]],
            "hand": list(st["hands"][seat]) if seat is not None else [],
            "scores": list(st["scores"]),
            "surs": list(st["surs"]),
            "deck_left": len(st["deck"]),
            "round": st["round"],
            "finished": self.finished,
            "winner": st.get("winner"),
            "teams": self._is_team_game(),
            "n": n,
        }

    # ------------------------------------------------------------------ actions
    def apply(self, seat: int, action: dict[str, Any]) -> list[dict[str, Any]]:
        st = self.state
        if self.finished:
            raise GameError("game is over", fa="این بازی تمام شده است.")
        if seat != st["turn"]:
            raise GameError("not your turn", fa="الان نوبت شما نیست.")
        if action.get("type") != "play":
            raise GameError("unknown action", fa="حرکت نامعتبر است.")

        code = action["card"]
        if code not in st["hands"][seat]:
            raise GameError("card not in hand", fa="این برگ در دست شما نیست.")

        card = Card.from_code(code)
        options = self._capture_options(card)
        if options:
            chosen = action.get("capture")
            if chosen is None:
                chosen = max(options, key=self._capture_value)
            else:
                chosen = list(chosen)
                if chosen not in options:
                    raise GameError("invalid capture", fa="این ترکیب قابل برداشتن نیست.")
        else:
            chosen = []

        st["hands"][seat].remove(code)
        events: list[dict[str, Any]] = []
        sur = False
        if chosen:
            st["table"] = [c for c in st["table"] if c not in chosen]
            st["piles"][seat].extend(chosen)
            st["piles"][seat].append(code)
            st["last_capturer"] = seat
            if card.rank != JACK and not st["table"] and self._sur_allowed(seat):
                sur = self._register_sur(seat)
        else:
            st["table"].append(code)

        events.append(
            {
                "type": "play",
                "seat": seat,
                "card": code,
                "captured": chosen,
                "sur": sur,
            }
        )
        self.log(f"seat {seat} played {code}")

        st["turn"] = (seat + 1) % len(st["players"])
        events.extend(self._after_play(seat))

        if not self.finished:
            # broadcast-view bookkeeping
            pass
        return events

    def _capture_value(self, cards: Iterable[str]) -> int:
        total = 0
        for code in cards:
            c = Card.from_code(code)
            if c.rank == ACE or c.rank == JACK:
                total += 1
            if c == Card(Suit.CLUBS, 2):
                total += 2
            if c == Card(Suit.DIAMONDS, 10):
                total += 3
        return total

    def _sur_allowed(self, seat: int) -> bool:
        st = self.state
        if not st["deck"]:
            return False  # no surs in the last deal
        return max(st["scores"][s] for s in self._side(seat)) < SUR_BLOCK_SCORE

    def _register_sur(self, seat: int) -> bool:
        st = self.state
        # A new sur cancels an outstanding one of the opponents.
        for opp in self._opponents(seat):
            if st["surs"][opp] > 0:
                st["surs"][opp] -= 1
                return False
        for s in self._side(seat):
            st["surs"][s] += 1
        return True

    def _after_play(self, played_by: int) -> list[dict[str, Any]]:
        st = self.state
        events: list[dict[str, Any]] = []
        if all(not h for h in st["hands"]):
            if st["deck"]:
                self._deal_batch()
                st["turn"] = (st["dealer"] + 1) % len(st["players"])
                self.touch_deadline()
            else:
                # last capturer sweeps the table
                if st["table"] and st["last_capturer"] is not None:
                    winner_seat = st["last_capturer"]
                    st["piles"][winner_seat].extend(st["table"])
                    events.append(
                        {"type": "sweep", "seat": winner_seat, "cards": list(st["table"])}
                    )
                    st["table"] = []
                events.extend(self._end_round())
                return events
        self.touch_deadline()
        return events

    # ------------------------------------------------------------------ scoring
    def _side_score(self, seat: int) -> int:
        return max(self.state["scores"][s] for s in self._side(seat))

    def _end_round(self) -> list[dict[str, Any]]:
        st = self.state
        n = len(st["players"])
        st["round"] += 1

        clubs = [0] * n
        gains = [0] * n
        for seat in range(n):
            for code in st["piles"][seat]:
                card = Card.from_code(code)
                if card.rank == ACE or card.rank == JACK:
                    gains[seat] += 1
                elif card == Card(Suit.CLUBS, 2):
                    gains[seat] += 2
                elif card == Card(Suit.DIAMONDS, 10):
                    gains[seat] += 3
                if card.suit == Suit.CLUBS:
                    clubs[seat] += 1

        # haft khâj (7+ clubs) → 7 points to the single side holding them
        best = max(clubs)
        if best >= 7 and clubs.count(best) == 1:
            gains[clubs.index(best)] += 7

        # surs (already netted by cancellation)
        for seat in range(n):
            gains[seat] += st["surs"][seat] * SUR_POINTS

        for seat in range(n):
            self._add_score(seat, gains[seat])

        st["surs"] = [0] * n
        st["last_capturer"] = None

        events: list[dict[str, Any]] = [
            {
                "type": "round_end",
                "gains": gains,
                "scores": list(st["scores"]),
                "clubs": clubs,
            }
        ]

        # winner detection: the leading *side* must be alone at 62+
        # (teammates share the same score, so compare side representatives)
        side_a, side_b = self._side_score(0), self._side_score(1 if n > 1 else 0)
        top = max(side_a, side_b)
        tie = side_a == side_b
        if top >= MAX_SCORE and not tie:
            winner = 0 if side_a > side_b else 1
            st["winner"] = winner
            st["phase"] = "finished"
            st["turn"] = None
            self.clear_deadline()
            events.append({"type": "game_end", "winner": winner, "scores": list(st["scores"])})
            return events

        self._start_round(random.Random())
        events.append({"type": "new_round", "round": st["round"], "dealer": st["dealer"]})
        return events

    # ------------------------------------------------------------------ timeout
    def auto_action(self, seat: int) -> dict[str, Any]:
        actions = self.legal_actions(seat)
        if not actions:
            raise GameError("no legal action")
        # prefer a capture, otherwise dump the highest card that trails
        captures = [a for a in actions if a.get("capture")]
        if captures:
            return max(captures, key=lambda a: self._capture_value(a["capture"]))
        return random.choice(actions)
