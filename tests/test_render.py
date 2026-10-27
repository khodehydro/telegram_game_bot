from __future__ import annotations

import random

from aiogram.types import InlineKeyboardMarkup

from bot.games.hokm import HokmGame
from bot.games.pasur import PasurGame
from bot.render import (
    card_label,
    hand_keyboard,
    hand_text,
    lobby_keyboard,
    lobby_text,
    table_text,
)


def names(n: int) -> list[str]:
    return [f"بازیکن{i}" for i in range(1, n + 1)]


def test_card_labels():
    assert card_label("SA") == "A♠️"
    assert card_label("D10") == "۱۰♦️"
    assert card_label("HJ") == "J♥️"


def test_lobby_text_and_keyboard():
    text = lobby_text("pasur", ["علی"], 2, 4, False, "abc")
    assert "پاسور" in text
    kb = lobby_keyboard("abc", True, 1, 4)
    assert isinstance(kb, InlineKeyboardMarkup)
    datas = [b.callback_data for row in kb.inline_keyboard for b in row]
    assert all(len(d.encode()) <= 64 for d in datas)


def test_pasur_table_renders():
    state = PasurGame.new([1, 2], seed=1)
    game = PasurGame(state)
    view = game.view(0)
    view["names"] = names(2)
    text = table_text(game, game.view(None) | {"names": names(2)}, names(2), "note")
    assert "پاسور" in text and "زمین" in text


def test_pasur_hand_keyboard_fits_callback_limit():
    state = PasurGame.new([1, 2], seed=1)
    game = PasurGame(state)
    view = game.view(0)
    kb = hand_keyboard(game, view, "abcd1234", 0)
    if kb is not None:
        for row in kb.inline_keyboard:
            for btn in row:
                assert len(btn.callback_data.encode()) <= 64


def test_hokm_trump_keyboard_only_for_hakem():
    state = HokmGame.new([1, 2, 3, 4], seed=1)
    game = HokmGame(state)
    hakem = game.state["hakem"]
    other = (hakem + 1) % 4
    assert hand_keyboard(game, game.view(hakem), "s1", hakem) is not None
    assert hand_keyboard(game, game.view(other), "s1", other) is None


def test_hokm_hand_text_shows_trump():
    state = HokmGame.new([1, 2, 3, 4], seed=2)
    game = HokmGame(state)
    hakem = game.state["hakem"]
    game.apply(hakem, {"type": "trump", "suit": "H"})
    view = game.view(hakem)
    text = hand_text(game, view, names(4), hakem)
    assert "حکم" in text
    assert "♥️" in text or "دل" in text


def test_random_pasur_game_renders_every_turn():
    rng = random.Random(11)
    state = PasurGame.new([1, 2, 3, 4], seed=11)
    game = PasurGame(state)
    nm = names(4)
    guard = 0
    while not game.finished and guard < 3000:
        guard += 1
        seat = game.current_seat()
        actions = game.legal_actions(seat)
        assert actions
        for view_seat in (None, seat):
            view = game.view(view_seat) | {"names": nm}
            table_text(game, view, nm, "")
        hand_text(game, game.view(seat) | {"names": nm}, nm, seat)
        hand_keyboard(game, game.view(seat), "sid", seat)
        game.apply(seat, rng.choice(actions))
    assert game.finished


def test_random_hokm_match_renders_every_turn():
    rng = random.Random(5)
    state = HokmGame.new([1, 2, 3, 4], seed=5)
    game = HokmGame(state)
    nm = names(4)
    guard = 0
    while not game.finished and guard < 5000:
        guard += 1
        seat = game.current_seat()
        for view_seat in (None, seat):
            view = game.view(view_seat) | {"names": nm}
            table_text(game, view, nm, "")
        hand_text(game, game.view(seat) | {"names": nm}, nm, seat)
        kb = hand_keyboard(game, game.view(seat), "sid", seat)
        if kb:
            for row in kb.inline_keyboard:
                for btn in row:
                    assert len(btn.callback_data.encode()) <= 64
        game.apply(seat, rng.choice(game.legal_actions(seat)))
    assert game.finished


def test_note_is_generated_for_plays():
    rng = random.Random(2)
    state = PasurGame.new([1, 2], seed=2)
    game = PasurGame(state)
    nm = names(2)
    from bot.service import GameService

    service = GameService.__new__(GameService)  # no bot needed for the note formatter
    seat = game.current_seat()
    events = game.apply(seat, rng.choice(game.legal_actions(seat)))
    note = service._note(game, nm, events, False)
    assert note
