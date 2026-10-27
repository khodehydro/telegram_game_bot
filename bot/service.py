"""Glue between the Telegram API, the game engines and the database."""

from __future__ import annotations

import asyncio
import contextlib
import html
import logging
import time
from typing import Any

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .cards import Card, fa_number
from .config import Settings
from .db.models import GameSession
from .db.storage import Database
from .games.base import BaseGame, GameError
from .games.registry import emoji, get_engine_class, name_fa
from .render import (
    capture_keyboard,
    card_label,
    hand_keyboard,
    hand_text,
    lobby_keyboard,
    lobby_text,
    table_text,
)

log = logging.getLogger(__name__)


def mention(user_id: int, name: str) -> str:
    return f'<a href="tg://user?id={user_id}">{name}</a>'


class GameService:
    def __init__(self, bot: Bot, db: Database, settings: Settings) -> None:
        self.bot = bot
        self.db = db
        self.settings = settings
        self.bot_username = ""
        self._locks: dict[str, asyncio.Lock] = {}
        # (session_id, user_id) -> card waiting for a capture choice
        self._pending: dict[tuple[str, int], str] = {}

    # ------------------------------------------------------------------ helpers
    def lock(self, session_id: str) -> asyncio.Lock:
        return self._locks.setdefault(session_id, asyncio.Lock())

    async def bot_link(self, payload: str) -> str:
        if not self.bot_username:
            me = await self.bot.get_me()
            self.bot_username = me.username or ""
        return f"https://t.me/{self.bot_username}?start={payload}"

    @staticmethod
    def engine(session: GameSession) -> BaseGame:
        return get_engine_class(session.game)(session.state)

    def names(self, session: GameSession) -> list[str]:
        return list(session.state.get("names") or [])

    def _view(self, session: GameSession, seat: int | None) -> dict[str, Any]:
        engine = self.engine(session)
        view = engine.view(seat)
        view["names"] = self.names(session)
        return view

    # ------------------------------------------------------------------ lobby
    async def create_lobby(
        self, chat_id: int, chat_type: str, owner_id: int, owner_name: str, game_key: str
    ) -> GameSession:
        existing = await self.db.get_active_session(chat_id)
        if existing:
            raise GameError(
                "a game is already active in this chat",
                fa="در این چت یک بازی در جریان است. اول آن را تمام کنید.",
            )
        get_engine_class(game_key)  # validate the key early
        session = await self.db.create_session(
            chat_id=chat_id,
            chat_type=chat_type,
            game=game_key,
            owner_id=owner_id,
            players=[owner_id],
        )
        session.state = {
            "phase": "lobby",
            "players": [owner_id],
            "names": [owner_name],
            "lobby_deadline": int(time.time()) + self.settings.lobby_timeout,
            "_ui": {},
        }
        await self.db.save_session(session)
        return session

    def _lobby_players(self, session: GameSession) -> int:
        return len(session.state.get("players") or [])

    async def render_lobby(self, session: GameSession) -> None:
        cls = get_engine_class(session.game)
        names = self.names(session)
        text = lobby_text(
            session.game, names, cls.MIN_PLAYERS, cls.MAX_PLAYERS, session.chat_type == "private", session.id
        )
        kb = lobby_keyboard(session.id, True, len(names), cls.MAX_PLAYERS)
        if session.message_id:
            try:
                await self.bot.edit_message_text(
                    text=text,
                    chat_id=session.chat_id,
                    message_id=session.message_id,
                    reply_markup=kb,
                )
                return
            except TelegramBadRequest as exc:  # message too old / not modified
                log.debug("lobby edit failed: %s", exc)
        msg = await self.bot.send_message(session.chat_id, text, reply_markup=kb)
        session.message_id = msg.message_id
        await self.db.save_session(session)

    async def join(self, session: GameSession, user_id: int, user_name: str) -> None:
        async with self.lock(session.id):
            if session.status != "lobby":
                raise GameError("game already started", fa="این بازی شروع شده است.")
            cls = get_engine_class(session.game)
            players = session.state.setdefault("players", [])
            names = session.state.setdefault("names", [])
            if user_id in players:
                raise GameError("already joined", fa="شما قبلاً نشسته‌اید.")
            if len(players) >= cls.MAX_PLAYERS:
                raise GameError("table is full", fa="میز پر است!")
            players.append(user_id)
            names.append(user_name)
            await self.db.save_session(session)
            await self.render_lobby(session)

    async def leave(self, session: GameSession, user_id: int) -> None:
        async with self.lock(session.id):
            if session.status != "lobby":
                raise GameError("game already started", fa="بازی شروع شده؛ نمی‌شود بلند شد.")
            players = session.state.get("players") or []
            names = session.state.get("names") or []
            if user_id not in players:
                raise GameError("not in lobby", fa="شما در این میز نیستید.")
            idx = players.index(user_id)
            players.pop(idx)
            names.pop(idx)
            await self.db.save_session(session)
            await self.render_lobby(session)

    async def cancel(self, session: GameSession) -> None:
        async with self.lock(session.id):
            await self.db.finish_session(session.id)
            if session.message_id:
                with contextlib.suppress(TelegramBadRequest):
                    await self.bot.edit_message_text(
                        text=f"🗑 میز {name_fa(session.game)} لغو شد.",
                        chat_id=session.chat_id,
                        message_id=session.message_id,
                    )

    # ------------------------------------------------------------------ start
    async def start(self, session: GameSession) -> None:
        async with self.lock(session.id):
            if session.status != "lobby":
                raise GameError("already started", fa="این بازی قبلاً شروع شده است.")
            cls = get_engine_class(session.game)
            players = list(session.state.get("players") or [])
            if len(players) < cls.MIN_PLAYERS:
                raise GameError(
                    "not enough players",
                    fa=f"{name_fa(session.game)} حداقل {fa_number(cls.MIN_PLAYERS)} بازیکن می‌خواهد.",
                )
            names = list(session.state.get("names") or [])
            session.state = cls.new(players)
            session.state["names"] = names
            session.state["_ui"] = {}
            session.status = "running"
            await self.db.save_session(session)
            await self.refresh(session, intro=True)

    # ------------------------------------------------------------------ actions
    async def act(self, session: GameSession, user_id: int, action: dict[str, Any]) -> list[dict[str, Any]]:
        async with self.lock(session.id):
            if session.status != "running":
                raise GameError("game is not running", fa="این بازی در جریان نیست.")
            engine = self.engine(session)
            seat = engine.seat_of(user_id)
            if seat is None:
                raise GameError("you are not playing", fa="شما در این بازی نیستید.")
            events = engine.apply(seat, action)
            await self.db.save_session(session)
            await self.refresh(session, events=events)
            return events

    # ------------------------------------------------------------------ render loop
    async def refresh(self, session: GameSession, events: list[dict[str, Any]] | None = None, intro: bool = False) -> None:
        engine = self.engine(session)
        names = self.names(session)
        note = self._note(engine, names, events or [], intro)

        # public table
        public = self._view(session, None)
        text = table_text(engine, public, names, note)
        kb = None
        if engine.finished:
            kb = InlineKeyboardMarkup(
                inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text=f"🔁 بازی جدید ({name_fa(session.game)})",
                            callback_data=f"l:n:{session.game}",
                        )
                    ]
                ]
            )
        await self._update_table(session, text, kb)

        # private hands (one message per player, updated in place)
        for seat, uid in enumerate(session.state.get("players") or []):
            await self._update_hand(session, seat, uid, note)

        if engine.finished:
            await self._finalise(session, engine)

    async def _update_table(self, session: GameSession, text: str, kb: InlineKeyboardMarkup | None) -> None:
        if session.chat_type == "private":
            # no group: every player gets their own copy of the table
            ui = session.state.setdefault("_ui", {})
            tables: dict[str, int] = ui.setdefault("tables", {})
            for uid in session.state.get("players", []):
                key = str(uid)
                mid = tables.get(key)
                if mid:
                    try:
                        await self.bot.edit_message_text(
                            text=text, chat_id=uid, message_id=mid, reply_markup=kb
                        )
                        continue
                    except (TelegramBadRequest, TelegramForbiddenError):
                        pass
                try:
                    msg = await self.bot.send_message(uid, text, reply_markup=kb)
                    tables[key] = msg.message_id
                except TelegramForbiddenError:
                    log.info("user %s blocked the bot", uid)
            await self.db.save_session(session)
            return

        if session.message_id:
            try:
                await self.bot.edit_message_text(
                    text=text,
                    chat_id=session.chat_id,
                    message_id=session.message_id,
                    reply_markup=kb,
                )
                return
            except TelegramBadRequest as exc:
                log.debug("table edit failed: %s", exc)
        try:
            msg = await self.bot.send_message(session.chat_id, text, reply_markup=kb)
            session.message_id = msg.message_id
            await self.db.save_session(session)
        except TelegramForbiddenError:
            log.warning("cannot post in chat %s", session.chat_id)

    async def _update_hand(self, session: GameSession, seat: int, uid: str | int, note: str) -> None:
        engine = self.engine(session)
        view = self._view(session, seat)
        text = hand_text(engine, view, self.names(session), seat)
        kb = hand_keyboard(engine, view, session.id, seat)
        if kb is None and not engine.finished and view.get("turn") != seat:
            text += "\n\n<i>تا نوبتتان صبر کنید.</i>"

        ui = session.state.setdefault("_ui", {})
        hands: dict[str, int] = ui.setdefault("hands", {})
        blocked = ui.setdefault("blocked", [])
        key = str(uid)
        if key in blocked:
            return
        mid = hands.get(key)
        if mid:
            try:
                await self.bot.edit_message_text(text=text, chat_id=int(uid), message_id=mid, reply_markup=kb)
                return
            except TelegramBadRequest:
                pass
            except TelegramForbiddenError:
                blocked.append(key)
                return
        try:
            msg = await self.bot.send_message(int(uid), text, reply_markup=kb)
            hands[key] = msg.message_id
        except TelegramForbiddenError:
            blocked.append(key)
            log.info("hand DM blocked for %s", uid)

    # ------------------------------------------------------------------ notes
    def _note(self, engine: BaseGame, names: list[str], events: list[dict[str, Any]], intro: bool) -> str:
        if intro:
            key = engine.GAME
            if key == "pasur":
                return "🎴 شروع شد! آس و سرباز ۱، ۲♣ ۲، ۱۰♦ ۳، هفت‌خاج ۷ و هر سور ۵ امتیاز دارد. تا ۶۲ امتیاز."
            if key == "hokm":
                return "🎴 شروع شد! حاکم خال حکم را انتخاب می‌کند. هر تیم با ۷ دست، دست را می‌برد."
            return "🎴 بازی شروع شد!"

        lines: list[str] = []
        for event in events:
            kind = event["type"]
            if kind == "play":
                seat = event["seat"]
                who = names[seat] if seat < len(names) else "?"
                line = f"🃏 {who}: {card_label(event['card'])}"
                if event.get("captured"):
                    line += " و برداشت " + " ".join(card_label(c) for c in event["captured"])
                if event.get("sur"):
                    line += " ⭐ سور!"
                lines.append(line)
            elif kind == "trick_end":
                seat = event["winner"]
                who = names[seat] if seat < len(names) else "?"
                lines.append(f"✅ دست را {who} برد.")
            elif kind == "sweep":
                seat = event["seat"]
                who = names[seat] if seat < len(names) else "?"
                lines.append(f"🧹 {who} برگ‌های باقی‌مانده روی زمین را برداشت.")
            elif kind == "round_end":
                gains = event.get("gains")
                if gains is not None:
                    parts = " • ".join(
                        f"{names[i]}: {fa_number(g)}" for i, g in enumerate(gains) if i < len(names)
                    )
                    lines.append(f"📊 پایان دور — امتیاز این دور: {parts}")
                else:
                    label = {"normal": "برد عادی", "kot": "کوت!", "hakem_kot": "حاکم‌کوت!"}.get(
                        event.get("kind", ""), "برد"
                    )
                    lines.append(f"📊 پایان دست — {label} (+{fa_number(event.get('points', 0))} امتیاز)")
            elif kind == "game_end":
                winner = event["winner"]
                if winner < len(names):
                    lines.append(f"🏁 <b>برنده: {names[winner]}</b>")
            elif kind == "new_round":
                lines.append("🔁 دست جدید شروع شد.")
            elif kind == "trump":
                lines.append("🃏 حکم انتخاب شد.")
        text = "\n".join(lines[-6:])
        if engine.finished:
            text += "\n\n🎉 بازی تمام شد!"
        return text

    # ------------------------------------------------------------------ finish
    async def _finalise(self, session: GameSession, engine: BaseGame) -> None:
        if session.status == "finished":
            return
        view = engine.view(None)
        names = self.names(session)
        winner = view.get("winner")
        players = session.state.get("players") or []
        scores = view.get("scores") or [0] * len(players)
        rows = []
        for seat, uid in enumerate(players):
            won = (
                seat % 2 == winner % 2
                if view.get("teams") and winner is not None
                else seat == winner
            )
            rows.append(
                {
                    "user_id": int(uid),
                    "seat": seat,
                    "won": won,
                    "points": int(scores[seat]) if seat < len(scores) else 0,
                }
            )
        try:
            await self.db.record_result(
                session_id=session.id,
                game=session.game,
                chat_id=session.chat_id,
                players=rows,
                winner_seat=winner,
            )
        except Exception:  # pragma: no cover - stats must never break a game
            log.exception("could not record the result")
        session.status = "finished"
        await self.db.save_session(session)

        if session.chat_type != "private" and winner is not None and winner < len(names):
            with contextlib.suppress(TelegramBadRequest):
                await self.bot.send_message(
                    session.chat_id,
                    f"{emoji(session.game)} بازی {name_fa(session.game)} تمام شد — برنده: <b>{names[winner]}</b>",
                )

    # ------------------------------------------------------------------ timeouts
    async def process_timeouts(self) -> None:
        rows = await self.db.list_active_sessions()
        now = int(time.time())
        for session in rows:
            try:
                if session.status == "lobby":
                    deadline = session.state.get("lobby_deadline")
                    if deadline and now > deadline:
                        await self.cancel(session)
                    continue
                if session.status != "running":
                    continue
                engine = self.engine(session)
                deadline = session.state.get("deadline")
                if not deadline or now < deadline:
                    continue
                seat = engine.current_seat()
                if seat is None:
                    continue
                action = engine.auto_action(seat)
                async with self.lock(session.id):
                    engine = self.engine(session)
                    if self.engine(session).current_seat() != seat:
                        continue
                    events = engine.apply(seat, action)
                    await self.db.save_session(session)
                await self.refresh(session, events=events)
            except GameError:
                continue
            except Exception:  # pragma: no cover
                log.exception("timeout handling failed for %s", session.id)

    # ------------------------------------------------------------------ callbacks
    async def play_card(self, session: GameSession, user_id: int, card: str) -> None:
        engine = self.engine(session)
        seat = engine.seat_of(user_id)
        if seat is None:
            raise GameError("not a player", fa="شما در این بازی نیستید.")
        if seat != engine.current_seat():
            raise GameError("not your turn", fa="الان نوبت شما نیست.")
        if session.game == "hokm":
            await self.act(session, user_id, {"type": "play", "card": card})
            return

        options = engine._capture_options(Card.from_code(card))  # type: ignore[attr-defined]
        if len(options) <= 1:
            self._pending.pop((session.id, user_id), None)
            await self.act(session, user_id, {"type": "play", "card": card})
            return

        # several possible captures: ask which cards to take
        self._pending[(session.id, user_id)] = card
        ui = session.state.setdefault("_ui", {})
        hands = ui.setdefault("hands", {})
        mid = hands.get(str(user_id))
        kb = capture_keyboard(options, session.id, card)
        text = f"🎴 با {card_label(card)} می‌توانی یکی از این مجموعه‌ها را برداری:"
        if mid:
            try:
                await self.bot.edit_message_text(text=text, chat_id=user_id, message_id=mid, reply_markup=kb)
                return
            except TelegramBadRequest:
                pass
        msg = await self.bot.send_message(user_id, text, reply_markup=kb)
        hands[str(user_id)] = msg.message_id
        await self.db.save_session(session)

    async def choose_capture(self, session: GameSession, user_id: int, index: int) -> None:
        card = self._pending.pop((session.id, user_id), None)
        if card is None:
            raise GameError("nothing to choose", fa="انتخاب منقضی شده؛ دوباره برگ را بزنید.")
        engine = self.engine(session)
        options = engine._capture_options(Card.from_code(card))  # type: ignore[attr-defined]
        if not 0 <= index < len(options):
            raise GameError("invalid choice", fa="گزینه نامعتبر است.")
        await self.act(session, user_id, {"type": "play", "card": card, "capture": options[index]})

    async def choose_trump(self, session: GameSession, user_id: int, suit: str) -> None:
        await self.act(session, user_id, {"type": "trump", "suit": suit})

    # ------------------------------------------------------------------ misc
    async def stats(self, user_id: int) -> str | None:
        user = await self.db.get_user(user_id)
        if not user:
            return None
        name = html.escape(user.first_name or "بازیکن")
        win_rate = (user.wins / user.games_played * 100) if user.games_played else 0
        return (
            f"📊 <b>آمار {name}</b>\n\n"
            f"بازی‌ها: {fa_number(user.games_played)}\n"
            f"برد: {fa_number(user.wins)} — باخت: {fa_number(user.losses)}\n"
            f"نرخ برد: {fa_number(round(win_rate))}٪\n"
            f"امتیاز کل: {fa_number(user.points)}"
        )

    async def leaderboard(self) -> str:
        rows = await self.db.leaderboard()
        if not rows:
            return "هنوز هیچ بازی‌ای ثبت نشده است."
        lines = ["🏆 <b>برترین بازیکنان</b>", ""]
        medals = ["🥇", "🥈", "🥉"]
        for i, user in enumerate(rows):
            medal = medals[i] if i < 3 else f"{fa_number(i + 1)}."
            name = html.escape(user.first_name or user.username or "بازیکن")
            lines.append(f"{medal} {name} — {fa_number(user.wins)} برد از {fa_number(user.games_played)} بازی")
        return "\n".join(lines)
