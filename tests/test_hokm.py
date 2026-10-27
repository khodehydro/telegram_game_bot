from __future__ import annotations

import random

import pytest

from bot.games.base import GameError
from bot.games.hokm import HokmGame


def make_game(seed: int = 1) -> HokmGame:
    return HokmGame(HokmGame.new([10, 20, 30, 40], seed=seed))


def test_new_game_starts_with_five_cards_each():
    game = make_game()
    assert game.phase == "trump"
    assert [len(h) for h in game.state["hands"]] == [5, 5, 5, 5]
    assert game.state["trump"] is None
    assert len(game.state["deck"]) == 52 - 20
    assert game.current_seat() == game.state["hakem"]


def test_only_hakem_can_choose_trump():
    game = make_game()
    hakem = game.state["hakem"]
    other = (hakem + 1) % 4
    with pytest.raises(GameError):
        game.apply(other, {"type": "trump", "suit": "H"})
    assert game.legal_actions(other) == []
    assert len(game.legal_actions(hakem)) == 4


def test_trump_deal_completes_thirteen_cards():
    game = make_game()
    game.apply(game.state["hakem"], {"type": "trump", "suit": "S"})
    assert game.phase == "playing"
    assert [len(h) for h in game.state["hands"]] == [13, 13, 13, 13]
    assert game.state["deck"] == []
    assert game.current_seat() == game.state["hakem"]


def test_must_follow_suit():
    game = make_game()
    game.state["hakem"] = 0
    game.apply(0, {"type": "trump", "suit": "H"})
    seat = 0
    game.state["hands"] = [["S5", "S2"], ["S3", "C3"], ["D4", "D5"], ["C6", "C7"]]
    game.apply(seat, {"type": "play", "card": "S5"})
    follower = (seat + 1) % 4
    with pytest.raises(GameError):
        game.apply(follower, {"type": "play", "card": "C3"})
    # following the led suit is allowed
    game.apply(follower, {"type": "play", "card": "S3"})


def test_trump_wins_the_trick():
    game = make_game()
    game.state["hakem"] = 0
    game.apply(0, {"type": "trump", "suit": "H"})
    seat = 0
    game.state["hands"] = [["S5", "S2"], ["S9", "S3"], ["H2", "H4"], ["S7", "S6"]]
    game.state["turn"] = seat
    game.apply(seat, {"type": "play", "card": "S5"})
    game.apply((seat + 1) % 4, {"type": "play", "card": "S9"})
    game.apply((seat + 2) % 4, {"type": "play", "card": "H2"})
    events = game.apply((seat + 3) % 4, {"type": "play", "card": "S7"})
    trick = next(e for e in events if e["type"] == "trick_end")
    assert trick["winner"] == (seat + 2) % 4
    assert game.state["turn"] == (seat + 2) % 4


def test_off_suit_card_cannot_win():
    game = make_game()
    game.state["hakem"] = 0
    game.apply(0, {"type": "trump", "suit": "H"})
    seat = 0
    game.state["hands"] = [["S5", "S2"], ["S9", "S3"], ["D10", "D5"], ["S7", "S6"]]
    game.apply(seat, {"type": "play", "card": "S5"})
    game.apply((seat + 1) % 4, {"type": "play", "card": "S9"})
    game.apply((seat + 2) % 4, {"type": "play", "card": "D10"})
    events = game.apply((seat + 3) % 4, {"type": "play", "card": "S7"})
    trick = next(e for e in events if e["type"] == "trick_end")
    assert trick["winner"] == (seat + 1) % 4


def _finish_round(game: HokmGame, rng: random.Random) -> list:
    game.apply(game.state["hakem"], {"type": "trump", "suit": "S"})
    events: list = []
    guard = 0
    while game.state["phase"] == "playing" and not game.finished:
        guard += 1
        assert guard < 200
        seat = game.current_seat()
        actions = game.legal_actions(seat)
        events.extend(game.apply(seat, rng.choice(actions)))
    return events


def test_random_round_terminates_with_seven_tricks():
    game = make_game(seed=4)
    rng = random.Random(4)
    events = _finish_round(game, rng)
    round_end = [e for e in events if e["type"] == "round_end"]
    assert len(round_end) == 1
    team = round_end[0]["team"]
    won = round_end[0]["tricks_won"][team] + round_end[0]["tricks_won"][team + 2]
    assert won >= 7
    assert round_end[0]["points"] in (1, 2, 3)


def test_kot_scores_two_points():
    game = make_game(seed=2)
    game.state["scores"] = [3, 1, 3, 1]
    game.state["tricks_won"] = [7, 0, 0, 0]
    game.state["hakem"] = 0
    events = game._end_round(0)
    round_end = events[0]
    assert round_end["kind"] == "kot"
    assert round_end["points"] == 2
    assert game.state["scores"][0] == 5


def test_hakem_kot_scores_three_points():
    game = make_game(seed=2)
    game.state["scores"] = [2, 2, 2, 2]
    game.state["tricks_won"] = [0, 7, 0, 0]
    game.state["hakem"] = 0  # hakem's team (0,2) got kot
    events = game._end_round(1)
    assert events[0]["kind"] == "hakem_kot"
    assert events[0]["points"] == 3


def test_match_ends_at_seven_points():
    game = make_game(seed=2)
    game.state["scores"] = [6, 2, 6, 2]
    game.state["tricks_won"] = [7, 0, 0, 0]
    game.state["hakem"] = 0
    events = game._end_round(0)
    assert game.finished
    end = next(e for e in events if e["type"] == "game_end")
    assert end["winner"] == 0
    assert game.state["winner"] == 0


def test_hakem_passes_to_winning_team():
    game = make_game(seed=2)
    game.state["scores"] = [0, 0, 0, 0]
    game.state["tricks_won"] = [0, 7, 0, 0]
    game.state["hakem"] = 0
    game._end_round(1)
    assert game.team(game.state["hakem"]) == 1


def test_full_match_terminates():
    rng = random.Random(9)
    game = HokmGame(HokmGame.new([10, 20, 30, 40], seed=9))
    guard = 0
    while not game.finished and guard < 5000:
        guard += 1
        seat = game.current_seat()
        if game.state["phase"] == "trump":
            game.apply(seat, rng.choice(game.legal_actions(seat)))
            continue
        game.apply(seat, rng.choice(game.legal_actions(seat)))
    assert game.finished
    assert max(game.state["scores"]) >= 7


def test_view_hides_other_hands():
    game = make_game()
    view = game.view(1)
    assert len(view["hand"]) == 5
    assert view["counts"] == [5, 5, 5, 5]
    public = game.view(None)
    assert public["hand"] == []


def test_sorted_hand_puts_trump_first():
    game = make_game()
    game.state["trump"] = "H"
    game.state["hands"][0] = ["S2", "HK", "H3", "CA", "D10"]
    view = game.view(0)
    assert view["hand"][0].startswith("H")
    assert view["hand"].count("H3") == 1
