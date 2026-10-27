"""Lobby and in-game inline button handlers."""

from __future__ import annotations

import html

from aiogram import F, Router
from aiogram.types import CallbackQuery

from ..games.base import GameError
from ..service import GameService, mention

router = Router(name="games")


async def fetch(call: CallbackQuery, service: GameService):
    parts = (call.data or "").split(":")
    if len(parts) < 3:
        await call.answer()
        return None, None
    session = await service.db.get_session(parts[2])
    if session is None:
        await call.answer("این میز پیدا نشد یا بسته شده است.", show_alert=True)
        return None, None
    return session, parts


@router.callback_query(F.data.startswith("l:j:"))
async def join_cb(call: CallbackQuery, service: GameService) -> None:
    session, _ = await fetch(call, service)
    if session is None:
        return
    try:
        await service.join(session, call.from_user.id, html.escape(call.from_user.full_name))
    except GameError as exc:
        await call.answer(exc.fa, show_alert=True)
        return
    await call.answer("نشستید! ✅")


@router.callback_query(F.data.startswith("l:l:"))
async def leave_cb(call: CallbackQuery, service: GameService) -> None:
    session, _ = await fetch(call, service)
    if session is None:
        return
    try:
        await service.leave(session, call.from_user.id)
    except GameError as exc:
        await call.answer(exc.fa, show_alert=True)
        return
    await call.answer("از میز بلند شدید.")


@router.callback_query(F.data.startswith("l:s:"))
async def start_cb(call: CallbackQuery, service: GameService) -> None:
    session, _ = await fetch(call, service)
    if session is None:
        return
    if call.from_user.id != session.owner_id:
        await call.answer("فقط سازندهٔ میز می‌تواند بازی را شروع کند.", show_alert=True)
        return
    try:
        await service.start(session)
    except GameError as exc:
        await call.answer(exc.fa, show_alert=True)
        return
    await call.answer("بازی شروع شد! 🎉")
    blocked = session.state.get("_ui", {}).get("blocked") or []
    if blocked:
        players = session.state.get("players") or []
        names = session.state.get("names") or []
        who = "، ".join(
            mention(int(players[i]), names[i]) for i, _ in enumerate(players) if str(players[i]) in blocked
        )
        if who:
            await call.message.answer(
                f"⚠️ {who} هنوز ربات را در چت خصوصی استارت نکرده‌اید؛ "
                "بدون آن نمی‌توانید برگ‌هایتان را ببینید."
            )


@router.callback_query(F.data.startswith("l:c:"))
async def cancel_cb(call: CallbackQuery, service: GameService) -> None:
    session, _ = await fetch(call, service)
    if session is None:
        return
    if call.from_user.id not in (session.owner_id, *session.state.get("players", [])):
        await call.answer("فقط بازیکنان میز می‌توانند لغو کنند.", show_alert=True)
        return
    await service.cancel(session)
    await call.answer("میز لغو شد.")


@router.callback_query(F.data.startswith("l:n:"))
async def new_game_cb(call: CallbackQuery, service: GameService) -> None:
    game_key = call.data.split(":", 2)[2]
    try:
        session = await service.create_lobby(
            chat_id=call.message.chat.id,
            chat_type=call.message.chat.type,
            owner_id=call.from_user.id,
            owner_name=html.escape(call.from_user.full_name),
            game_key=game_key,
        )
    except GameError as exc:
        await call.answer(exc.fa, show_alert=True)
        return
    await service.render_lobby(session)
    await call.answer("میز جدید ساخته شد.")


@router.callback_query(F.data.startswith("g:p:"))
async def play_card_cb(call: CallbackQuery, service: GameService) -> None:
    parts = call.data.split(":")
    if len(parts) < 4:
        await call.answer()
        return
    session = await service.db.get_session(parts[2])
    if session is None:
        await call.answer("این بازی پیدا نشد.", show_alert=True)
        return
    try:
        await service.play_card(session, call.from_user.id, parts[3])
    except GameError as exc:
        await call.answer(exc.fa, show_alert=True)
        return
    await call.answer("انجام شد ✅")


@router.callback_query(F.data.startswith("g:c:"))
async def capture_cb(call: CallbackQuery, service: GameService) -> None:
    parts = call.data.split(":")
    if len(parts) < 4:
        await call.answer()
        return
    session = await service.db.get_session(parts[2])
    if session is None:
        await call.answer("این بازی پیدا نشد.", show_alert=True)
        return
    try:
        await service.choose_capture(session, call.from_user.id, int(parts[3]))
    except GameError as exc:
        await call.answer(exc.fa, show_alert=True)
        return
    await call.answer("برداشته شد ✅")


@router.callback_query(F.data.startswith("g:b:"))
async def back_cb(call: CallbackQuery, service: GameService) -> None:
    parts = call.data.split(":")
    session = await service.db.get_session(parts[2]) if len(parts) > 2 else None
    if session is None:
        await call.answer()
        return
    service._pending.pop((session.id, call.from_user.id), None)
    await service.refresh(session)
    await call.answer("برگشت.")


@router.callback_query(F.data.startswith("g:t:"))
async def trump_cb(call: CallbackQuery, service: GameService) -> None:
    parts = call.data.split(":")
    if len(parts) < 4:
        await call.answer()
        return
    session = await service.db.get_session(parts[2])
    if session is None:
        await call.answer("این بازی پیدا نشد.", show_alert=True)
        return
    try:
        await service.choose_trump(session, call.from_user.id, parts[3])
    except GameError as exc:
        await call.answer(exc.fa, show_alert=True)
        return
    await call.answer("حکم انتخاب شد 🃏")
