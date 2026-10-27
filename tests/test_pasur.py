from __future__ import annotations

import random

import pytest

from bot.cards import Card, Suit, full_deck
from bot.games.base import GameError
from bot.games.pasur import PasurGame


def test_deck_is_complete():
    assert len(full_deck()) == 52
    assert len(set(c.code for c in full_deck())) == 52


def test_new_game_deals_correctly():
    state = PasurGame.new([1, 2], seed=1)
    game = PasurGame(state)
    assert game.phase == "playing"
    assert [len(h) for h in state["hands"]] == [4, 4]
    assert len(state["table"]) == 4
    assert len(state["deck"]) == 52 - 4 * 2 - 4
    # table never starts with more than one jack
    assert sum(1 for c in state["table"] if Card.from_code(c).rank == 11) <= 1
    # no card is ever lost
    total = len(state["table"]) + len(state["deck"]) + sum(len(h) for h in state["hands"])
    assert total == 52


def test_four_player_game_is_a_team_game():
    state = PasurGame.new([1, 2, 3, 4], seed=3)
    game = PasurGame(state)
    assert game._is_team_game()
    assert game._side(0) == game._side(2)
    assert game._side(1) == game._side(3)


def test_capture_options_for_king_and_queen():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["table"] = ["SK", "S5", "HQ"]
    opts = game._capture_options(Card(Suit.HEARTS, 13))
    assert opts == [["SK"]]
    opts_q = game._capture_options(Card(Suit.DIAMONDS, 12))
    assert opts_q == [["HQ"]]


def test_jack_takes_numerals_and_jacks_but_not_court_cards():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["table"] = ["SK", "HQ", "S5", "C9", "DJ"]
    opts = game._capture_options(Card(Suit.HEARTS, 11))
    assert opts == [["S5", "C9", "DJ"]]
    assert set(opts[0]) == {"S5", "C9", "DJ"}


def test_numeral_sums_to_eleven():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["table"] = ["S6", "H3", "D2", "C10"]
    opts = game._capture_options(Card(Suit.HEARTS, 5))
    # 5 + 6 = 11 and 5 + 3 + 2 = 10 -> only the six works
    assert opts == [["S6"]]
    opts = game._capture_options(Card(Suit.HEARTS, 6))
    assert ["H3", "D2"] in opts  # 6 + 3 + 2 = 11


def test_ace_counts_as_one():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["table"] = ["S10"]
    assert game._capture_options(Card(Suit.HEARTS, 14)) == [["S10"]]


def test_illegal_capture_is_rejected():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["table"] = ["S6", "H2"]
    game.state["hands"][0] = ["D5", "C7"]
    game.state["turn"] = 0
    with pytest.raises(GameError):
        game.apply(0, {"type": "play", "card": "D5", "capture": ["H2"]})


def test_sur_scores_when_table_is_cleared():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["table"] = ["S6"]
    game.state["hands"][0] = ["D5", "C7"]
    game.state["deck"] = ["H2"] * 3
    game.state["turn"] = 0
    events = game.apply(0, {"type": "play", "card": "D5"})
    assert events[0]["sur"] is True
    assert game.state["surs"][0] == 1


def test_no_sur_on_last_deal():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["table"] = ["S6"]
    game.state["hands"] = [["D5"], ["C7"]]
    game.state["deck"] = []
    game.state["turn"] = 0
    events = game.apply(0, {"type": "play", "card": "D5"})
    assert events[0]["sur"] is False


def test_sur_cancels_opponent_sur():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["surs"] = [1, 0]
    game.state["table"] = ["S6"]
    game.state["hands"][1] = ["D5", "C7"]
    game.state["hands"][0] = ["H8"]
    game.state["deck"] = ["H2"] * 3
    game.state["turn"] = 1
    events = game.apply(1, {"type": "play", "card": "D5"})
    assert events[0]["sur"] is False
    assert game.state["surs"] == [0, 0]


def test_scoring_counts_aces_jacks_twos_tens_and_clubs():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["piles"] = [
        ["SA", "HA", "C2", "D10", "C3", "C4", "C5", "C6", "C7", "C8", "C9"],
        ["SJ", "HJ", "H2", "S3"],
    ]
    game.state["hands"] = [[], []]
    game.state["deck"] = []
    events = game._end_round()
    gains = events[0]["gains"]
    # seat 0: 2 aces + 2 (C2) + 3 (D10) + 7 clubs = 14
    assert gains[0] == 14
    # seat 1: 2 jacks = 2
    assert gains[1] == 2


def test_last_capturer_sweeps_the_table():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    game.state["table"] = ["HK", "SQ"]
    game.state["hands"] = [["D3"], ["C4"]]
    game.state["piles"] = [["SA"], []]
    game.state["deck"] = []
    game.state["last_capturer"] = 0
    game.state["surs"] = [0, 0]
    game.state["turn"] = 0
    game.apply(0, {"type": "play", "card": "D3"})
    events = game.apply(1, {"type": "play", "card": "C4"})
    assert any(e["type"] == "sweep" and e["seat"] == 0 for e in events)


def _play_and_collect(players: int, seed: int) -> tuple[PasurGame, list]:
    rng = random.Random(seed)
    state = PasurGame.new(list(range(1, players + 1)), seed=seed)
    game = PasurGame(state)
    guard = 0
    while game.state["round"] == 0:
        guard += 1
        assert guard < 5000
        seat = game.current_seat()
        actions = game.legal_actions(seat)
        game.apply(seat, rng.choice(actions))
    return game, []


def test_full_round_two_players_terminates():
    game, _ = _play_and_collect(2, seed=7)
    assert game.state["round"] == 1
    # a fresh round was dealt, so all 52 cards are back in play
    total = len(game.state["table"]) + len(game.state["deck"]) + sum(len(h) for h in game.state["hands"])
    assert total == 8 + 4 + len(game.state["deck"])
    assert sum(len(p) for p in game.state["piles"]) == 0


def test_round_end_reports_gains():
    rng = random.Random(3)
    state = PasurGame.new([1, 2, 3, 4], seed=3)
    game = PasurGame(state)
    gains = None
    while game.state["round"] == 0:
        seat = game.current_seat()
        for event in game.apply(seat, rng.choice(game.legal_actions(seat))):
            if event["type"] == "round_end":
                gains = event["gains"]
    assert gains is not None and len(gains) == 4
    assert sum(gains) >= 10  # aces + jacks alone are worth 8


def test_game_finishes_at_62():
    state = PasurGame.new([1, 2], seed=5)
    game = PasurGame(state)
    game.state["scores"] = [57, 10]
    game.state["piles"] = [["SA", "HA", "DA", "SJ", "HJ"], []]
    game.state["hands"] = [[], []]
    game.state["deck"] = []
    events = game._end_round()
    assert game.finished
    assert any(e["type"] == "game_end" and e["winner"] == 0 for e in events)


def test_tie_above_62_keeps_playing():
    state = PasurGame.new([1, 2], seed=5)
    game = PasurGame(state)
    game.state["scores"] = [62, 62]
    game.state["piles"] = [[], []]
    game.state["hands"] = [[], []]
    game.state["deck"] = []
    game._end_round()
    assert not game.finished


def test_wrong_turn_rejected():
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    other = (game.state["turn"] + 1) % 2
    with pytest.raises(GameError):
        game.apply(other, {"type": "play", "card": game.state["hands"][other][0]})
