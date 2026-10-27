"""Persian UI: rendering of tables, hands and inline keyboards."""

from __future__ import annotations

from typing import Any

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .cards import ACE, JACK, KING, QUEEN, SUITS, Card, fa_number
from .games.base import BaseGame
from .games.registry import emoji, name_fa

CARD_LABEL: dict[int, str] = {JACK: "J", QUEEN: "Q", KING: "K", ACE: "A"}

SUIT_NAME_FA = {"S": "پیک", "H": "دل", "D": "خشت", "C": "گشنیز"}


def card_label(code: str) -> str:
    card = Card.from_code(code)
    rank = CARD_LABEL.get(card.rank, fa_number(card.rank))
    return f"{rank}{card.suit.emoji}"


def card_label_fa(code: str) -> str:
    card = Card.from_code(code)
    rank = CARD_LABEL.get(card.rank, fa_number(card.rank))
    return f"{rank} {SUIT_NAME_FA[card.suit.value]}"


def cards_line(codes: list[str], sep: str = " ") -> str:
    return sep.join(card_label(c) for c in codes) if codes else "—"


def display_names(view: dict[str, Any]) -> list[str]:
    names = view.get("names") or []
    return [n or f"بازیکن {fa_number(i + 1)}" for i, n in enumerate(names)]


# --------------------------------------------------------------------- lobby
def lobby_text(game_key: str, players: list[str], min_p: int, max_p: int, room: bool, sid: str) -> str:
    title = f"{emoji(game_key)} <b>{name_fa(game_key)}</b>"
    lines = [f"{title} — میز جدید", ""]
    if players:
        lines.append("بازیکنان:")
        for i, name in enumerate(players, 1):
            lines.append(f"{fa_number(i)}. {name}")
    else:
        lines.append("هنوز کسی ننشسته!")
    lines += [
        "",
        f"حداقل {fa_number(min_p)} و حداکثر {fa_number(max_p)} نفر.",
    ]
    if room:
        lines.append("این میز خصوصی است؛ هرکس با لینک دعوت بتواند بپیوندد.")
    lines += ["", "برای نشستن روی «می‌نشینم» بزنید."]
    return "\n".join(lines)


def lobby_keyboard(session_id: str, is_owner: bool, players: int, max_p: int) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="🪑 می‌نشینم", callback_data=f"l:j:{session_id}")],
    ]
    if is_owner:
        rows.append(
            [
                InlineKeyboardButton(text="▶️ شروع بازی", callback_data=f"l:s:{session_id}"),
                InlineKeyboardButton(text="🗑 لغو", callback_data=f"l:c:{session_id}"),
            ]
        )
    else:
        rows.append([InlineKeyboardButton(text="🚪 خروج", callback_data=f"l:l:{session_id}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


# --------------------------------------------------------------------- table
def table_text(game: BaseGame, view: dict[str, Any], names: list[str], note: str = "") -> str:
    key = view["game"]
    if key == "pasur":
        return _pasur_table_text(view, names, note)
    return _hokm_table_text(view, names, note)


def _pasur_table_text(view: dict[str, Any], names: list[str], note: str) -> str:
    lines = [f"🎣 <b>پاسور</b> — دور {fa_number(view.get('round', 0) + 1)}", ""]
    lines.append(f"🃏 <b>روی زمین:</b> {cards_line(view['table'])}")

    turn = view.get("turn")
    if view.get("finished"):
        pass
    elif turn is not None and turn < len(names):
        lines.append(f"🎯 <b>نوبت:</b> {names[turn]}")

    if view["teams"]:
        a = view["scores"][0]
        b = view["scores"][1]
        lines += [
            "",
            f"👥 تیم {names[0]} و {names[2]} — {fa_number(a)} امتیاز",
            f"👥 تیم {names[1]} و {names[3]} — {fa_number(b)} امتیاز",
        ]
    else:
        parts = [f"{names[i]}: {fa_number(s)}" for i, s in enumerate(view["scores"])]
        lines += ["", "📊 " + " • ".join(parts)]

    surs = view["surs"]
    if any(surs):
        lines.append("⭐ سور: " + "، ".join(f"{names[i]} ×{fa_number(n)}" for i, n in enumerate(surs) if n))

    hand_sizes = " • ".join(f"{names[i]}: {fa_number(c)}" for i, c in enumerate(view["counts"]))
    lines += ["", f"🖐 برگ‌ها: {hand_sizes}"]
    lines.append(f"🎴 باقی مانده در پاکت: {fa_number(view['deck_left'])}")
    if note:
        lines += ["", note]
    return "\n".join(lines)


def _hokm_table_text(view: dict[str, Any], names: list[str], note: str) -> str:
    lines = [f"👑 <b>حکم</b> — دست {fa_number(view.get('round', 1))}", ""]
    if view.get("trump"):
        t = view["trump"]
        lines.append(f"🃏 <b>حکم:</b> {Card.from_code(t + '2').suit.emoji} {SUIT_NAME_FA[t]}")
    else:
        lines.append("🃏 <b>حکم:</b> هنوز انتخاب نشده")
    lines.append(f"👑 <b>حاکم:</b> {names[view['hakem']]}")

    trick = view.get("trick") or []
    if trick:
        played = "، ".join(f"{names[p['seat']]}: {card_label(p['card'])}" for p in trick)
        lines.append(f"🎯 <b>دست کنونی:</b> {played}")
    else:
        lines.append("🎯 <b>دست کنونی:</b> —")

    if view["phase"] == "playing":
        turn = view.get("turn")
        if turn is not None and turn < len(names):
            lines.append(f"⏳ <b>نوبت:</b> {names[turn]}")

    tw = view["tricks_won"]
    lines += [
        "",
        f"🏆 دست‌های برده — تیم {names[0]} و {names[2]}: {fa_number(tw[0] + tw[2])}",
        f"🏆 دست‌های برده — تیم {names[1]} و {names[3]}: {fa_number(tw[1] + tw[3])}",
    ]

    sc = view["scores"]
    lines += [
        "",
        f"📊 امتیاز تیم {names[0]}: {fa_number(sc[0])}   |   امتیاز تیم {fa_number(1)}: {fa_number(sc[1])}",
    ]
    if note:
        lines += ["", note]
    return "\n".join(lines)


# --------------------------------------------------------------------- hands
def hand_text(game: BaseGame, view: dict[str, Any], names: list[str], seat: int) -> str:
    key = view["game"]
    hand = view["hand"]
    my_turn = (view.get("turn") == seat) and not view.get("finished")
    header = "🟢 نوبت شماست!" if my_turn else "⏳ منتظر حرکت بقیه..."

    if key == "pasur":
        body = [
            "🎣 <b>پاسور</b> — برگ‌های شما",
            f"🃏 روی زمین: {cards_line(view['table'])}",
            "",
            cards_line(hand, sep="   "),
            "",
            header,
            f"📊 امتیاز: {fa_number(view['scores'][seat])}",
        ]
        return "\n".join(body)

    body = [
        "👑 <b>حکم</b> — برگ‌های شما",
    ]
    if view.get("trump"):
        body.append(f"🃏 حکم: {Card.from_code(view['trump'] + '2').suit.emoji} {SUIT_NAME_FA[view['trump']]}")
    if view.get("trick"):
        body.append(
            "🎯 روی میز: "
            + "، ".join(f"{names[p['seat']]}: {card_label(p['card'])}" for p in view["trick"])
        )
    body += ["", cards_line(hand, sep="   "), "", header]
    return "\n".join(body)


def hand_keyboard(game: BaseGame, view: dict[str, Any], session_id: str, seat: int) -> InlineKeyboardMarkup | None:
    if view.get("finished"):
        return None
    if game.GAME == "hokm" and view["phase"] == "trump":
        if seat != view["hakem"]:
            return None
        row = [
            InlineKeyboardButton(
                text=f"{Card.from_code(s.value + '2').suit.emoji} {SUIT_NAME_FA[s.value]}",
                callback_data=f"g:t:{session_id}:{s.value}",
            )
            for s in SUITS
        ]
        return InlineKeyboardMarkup(inline_keyboard=[row])

    if view.get("turn") != seat:
        return None

    cards = view["hand"]
    if not cards:
        return None

    # one row per suit, highest cards first
    rows: list[list[InlineKeyboardButton]] = []
    for suit in SUITS:
        row = [
            InlineKeyboardButton(
                text=card_label(c),
                callback_data=f"g:p:{session_id}:{c}",
            )
            for c in cards
            if Card.from_code(c).suit == suit
        ]
        if row:
            rows.append(row)
    return InlineKeyboardMarkup(inline_keyboard=rows)


def capture_keyboard(
    options: list[list[str]], session_id: str, card: str
) -> InlineKeyboardMarkup:
    rows = []
    for idx, opt in enumerate(options):
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"بگیر {cards_line(opt, sep=' + ')}",
                    callback_data=f"g:c:{session_id}:{idx}",
                )
            ]
        )
    rows.append([InlineKeyboardButton(text="↩️ بازگشت", callback_data=f"g:b:{session_id}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)
