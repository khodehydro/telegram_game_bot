"""Hokm (حکم) engine — the classic Iranian 4-player partnership trick game.

Two teams of two (partners sit opposite: seats 0+2 vs 1+3).  Each player gets
13 cards from a 52-card pack.  The *hakem* (حاکم) receives five cards, names the
trump suit (*hokm*), then the remaining eight cards are dealt.  The hakem leads
the first trick, followers must follow suit when able, and the highest card of
the led suit — unless a trump is played — takes the trick and leads the next.

A team wins the round at seven tricks:

* normal win ............ 1 point
* ``kot``  (7–0) ........ 2 points
* ``hakem kot`` ......... 3 points (the hakem's own team lost 7–0)

First team to seven points wins the match.
"""

from __future__ import annotations

import random
from typing import Any

from ..cards import Card, Suit, shuffled_deck, sort_cards
from .base import BaseGame, GameError

TARGET_POINTS = 7
TRICKS_TO_WIN = 7


class HokmGame(BaseGame):
    GAME = "hokm"
    MIN_PLAYERS = 4
    MAX_PLAYERS = 4
    TURN_SECONDS = 60

    @classmethod
    def new(cls, players: list[int], **options: Any) -> dict[str, Any]:
        if len(players) != 4:
            raise GameError("hokm needs exactly 4 players", fa="حکم دقیقاً ۴ بازیکن می‌خواهد.")
        rng = random.Random(options.get("seed"))
        state: dict[str, Any] = {
            "game": cls.GAME,
            "players": list(players),
            "phase": "trump",
            "hands": [[] for _ in players],
            "trump": None,
            "hakem": rng.randrange(4),
            "turn": 0,
            "trick": [],
            "history": [],
            "tricks_won": [0, 0, 0, 0],
            "scores": [0, 0, 0, 0],
            "round": 0,
            "leader": 0,
            "winner": None,
            "deck": [],
            "log": [],
            "deadline": None,
        }
        game = cls(state)
        game._start_round(rng)
        return state

    # ------------------------------------------------------------------ teams
    def team(self, seat: int) -> int:
        return seat % 2

    def team_pool(self, team: int) -> list[int]:
        return [team, team + 2]

    def team_score(self, team: int) -> int:
        return self.state["scores"][team]

    # ------------------------------------------------------------------ dealing
    def _start_round(self, rng: random.Random) -> None:
        st = self.state
        st["round"] += 1
        deck = shuffled_deck(rng)
        st["hands"] = [[c.code for c in deck[s * 5 : (s + 1) * 5]] for s in range(4)]
        st["deck"] = [c.code for c in deck[20:]]
        st["trump"] = None
        st["trick"] = []
        st["tricks_won"] = [0, 0, 0, 0]
        st["leader"] = st["hakem"]
        st["turn"] = st["hakem"]
        st["phase"] = "trump"
        st["deadline"] = None
        self.touch_deadline()

    def _deal_rest(self) -> None:
        st = self.state
        deck = [Card.from_code(c) for c in st["deck"]]
        start = (st["hakem"] + 1) % 4
        for _ in range(8):
            for j in range(4):
                seat = (start + j) % 4
                st["hands"][seat].append(deck.pop(0).code)
        st["deck"] = []

    # ------------------------------------------------------------------ queries
    def current_seat(self) -> int | None:
        if self.finished:
            return None
        return int(self.state["turn"])

    def _legal_cards(self, seat: int) -> list[str]:
        hand = list(self.state["hands"][seat])
        trick = self.state["trick"]
        if not trick:
            return hand
        led = Card.from_code(trick[0]["card"]).suit.value
        follow = [c for c in hand if Card.from_code(c).suit.value == led]
        return follow or hand

    def legal_actions(self, seat: int) -> list[dict[str, Any]]:
        if self.finished:
            return []
        if self.state["phase"] == "trump":
            if seat != self.state["hakem"]:
                return []
            return [{"type": "trump", "suit": s.value} for s in Suit]
        if seat != self.state["turn"]:
            return []
        return [{"type": "play", "card": c} for c in self._legal_cards(seat)]

    def view(self, seat: int | None) -> dict[str, Any]:
        st = self.state
        return {
            "game": self.GAME,
            "players": st["players"],
            "phase": st["phase"],
            "turn": st["turn"],
            "hakem": st["hakem"],
            "trump": st["trump"],
            "trick": list(st["trick"]),
            "hand": sort_cards(st["hands"][seat], trump=st["trump"]) if seat is not None else [],
            "counts": [len(h) for h in st["hands"]],
            "tricks_won": list(st["tricks_won"]),
            "scores": list(st["scores"]),
            "round": st["round"],
            "winner": st.get("winner"),
            "finished": self.finished,
        }

    # ------------------------------------------------------------------ actions
    def apply(self, seat: int, action: dict[str, Any]) -> list[dict[str, Any]]:
        if self.finished:
            raise GameError("game is over", fa="این بازی تمام شده است.")
        kind = action.get("type")
        if kind == "trump":
            return self._choose_trump(seat, action.get("suit"))
        if kind == "play":
            return self._play(seat, action.get("card"))
        raise GameError("unknown action", fa="حرکت نامعتبر است.")

    def _choose_trump(self, seat: int, suit: str | None) -> list[dict[str, Any]]:
        st = self.state
        if st["phase"] != "trump":
            raise GameError("trump already chosen", fa="حکم قبلاً انتخاب شده است.")
        if seat != st["hakem"]:
            raise GameError("only the hakem picks trump", fa="فقط حاکم می‌تواند حکم را انتخاب کند.")
        try:
            trump = Suit(suit).value
        except (ValueError, TypeError):
            raise GameError("bad suit", fa="خال نامعتبر است.") from None
        st["trump"] = trump
        self._deal_rest()
        st["phase"] = "playing"
        st["turn"] = st["hakem"]
        self.touch_deadline()
        return [{"type": "trump", "seat": seat, "suit": trump}]

    def _play(self, seat: int, code: str | None) -> list[dict[str, Any]]:
        st = self.state
        if st["phase"] != "playing":
            raise GameError("trump not chosen yet", fa="اول باید خال حکم انتخاب شود.")
        if seat != st["turn"]:
            raise GameError("not your turn", fa="الان نوبت شما نیست.")
        if not code or code not in st["hands"][seat]:
            raise GameError("card not in hand", fa="این برگ در دست شما نیست.")
        if code not in self._legal_cards(seat):
            raise GameError("must follow suit", fa="باید از خال زمینه بازی کنی.")

        st["hands"][seat].remove(code)
        st["trick"].append({"seat": seat, "card": code})
        self.log(f"{seat}:{code}")

        events: list[dict[str, Any]] = [{"type": "play", "seat": seat, "card": code}]

        if len(st["trick"]) < 4:
            st["turn"] = (seat + 1) % 4
            self.touch_deadline()
            return events

        winner = self._trick_winner()
        st["tricks_won"][winner] += 1
        st["history"].append(
            {"cards": list(st["trick"]), "winner": winner, "n": st["round"]}
        )
        events.append(
            {
                "type": "trick_end",
                "winner": winner,
                "cards": list(st["trick"]),
                "tricks_won": list(st["tricks_won"]),
            }
        )
        st["trick"] = []
        st["leader"] = winner
        st["turn"] = winner

        team = self.team(winner)
        team_tricks = st["tricks_won"][team] + st["tricks_won"][team + 2]
        if team_tricks >= TRICKS_TO_WIN:
            events.extend(self._end_round(team))
            return events

        self.touch_deadline()
        return events

    def _trick_winner(self) -> int:
        st = self.state
        trump = st["trump"]
        led = Card.from_code(st["trick"][0]["card"]).suit.value

        def strength(entry: dict[str, Any]) -> tuple[int, int]:
            card = Card.from_code(entry["card"])
            if card.suit.value == trump:
                tier = 2  # a trump beats every plain card
            elif card.suit.value == led:
                tier = 1
            else:
                tier = 0  # discard: cannot win
            return (tier, card.rank)

        best = st["trick"][0]
        for entry in st["trick"][1:]:
            if strength(entry) > strength(best):
                best = entry
        return int(best["seat"])

    # ------------------------------------------------------------------ scoring
    def _end_round(self, winning_team: int) -> list[dict[str, Any]]:
        st = self.state
        losing_team = 1 - winning_team
        lose_tricks = st["tricks_won"][losing_team] + st["tricks_won"][losing_team + 2]
        hakem_team = self.team(st["hakem"])

        if lose_tricks == 0:
            points = 3 if winning_team != hakem_team else 2
            kind = "hakem_kot" if winning_team != hakem_team else "kot"
        else:
            points = 1
            kind = "normal"

        # both seats of a team share the team score (easier to display)
        for seat in self.team_pool(winning_team):
            st["scores"][seat] += points

        events: list[dict[str, Any]] = [
            {
                "type": "round_end",
                "team": winning_team,
                "kind": kind,
                "points": points,
                "scores": list(st["scores"]),
                "tricks_won": list(st["tricks_won"]),
            }
        ]

        score = st["scores"][winning_team]
        if score >= TARGET_POINTS:
            st["winner"] = winning_team
            st["phase"] = "finished"
            st["turn"] = None
            self.clear_deadline()
            events.append(
                {"type": "game_end", "winner": winning_team, "scores": list(st["scores"])}
            )
            return events

        # the winning team keeps the hakem seat
        hakem = st["hakem"]
        if self.team(hakem) != winning_team:
            hakem = (hakem + 1) % 4  # the next seat belongs to the winning team
        st["hakem"] = hakem
        self._start_round(random.Random())
        events.append({"type": "new_round", "round": st["round"], "hakem": hakem})
        return events

    # ------------------------------------------------------------------ timeout
    def auto_action(self, seat: int) -> dict[str, Any]:
        if self.state["phase"] == "trump":
            hand = [Card.from_code(c) for c in self.state["hands"][seat]]
            counts: dict[str, int] = {}
            for card in hand:
                counts[card.suit.value] = counts.get(card.suit.value, 0) + 1
            suit = max(counts, key=counts.get)
            return {"type": "trump", "suit": suit}

        legal = self._legal_cards(seat)
        cards = [Card.from_code(c) for c in legal]
        # prefer the lowest card that cannot win, else the lowest
        lowest = min(cards, key=lambda c: c.rank)
        return {"type": "play", "card": lowest.code}
