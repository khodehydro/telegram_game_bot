"""End-to-end test of the Telegram layer with a fake Bot API session.

The real Telegram API is not reachable from CI/sandbox, so a fake session
records outgoing calls and returns plausible objects.  The dispatcher is fed
real ``Update`` objects, which exercises routers, callbacks, the service layer
and the database exactly like production would.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.enums import ParseMode
from aiogram.types import (
    CallbackQuery,
    Chat,
    Message,
    Update,
    User,
)

from bot.config import Settings
from bot.db.storage import Database
from bot.service import GameService

GROUP = Chat(id=-100123, type="chat" if False else "supergroup", title="Test Group")


def make_user(uid: int, name: str) -> User:
    return User(id=uid, is_bot=False, first_name=name, username=f"u{uid}")


def make_message(chat_id: int, user: User, text: str, message_id: int = 1) -> Message:
    return Message(
        message_id=message_id,
        date=dt.datetime.now(dt.UTC),
        chat=Chat(id=chat_id, type="private" if chat_id > 0 else "supergroup"),
        from_user=user,
        text=text,
    )


class FakeSession(BaseSession):
    def __init__(self) -> None:
        super().__init__()
        self.sent: list[dict[str, Any]] = []
        self._mid = 100

    async def close(self) -> None:  # pragma: no cover
        return None

    async def stream_content(self, *args, **kwargs):  # pragma: no cover
        yield b""

    async def make_request(self, bot: Bot, method, timeout: int | None = None):
        name = method.__api_method__
        params = {k: v for k, v in method.model_dump(exclude_none=True).items()}
        self.sent.append({"method": name, **params})
        if name == "getMe":
            return User(id=bot.id, is_bot=True, first_name="TestBot", username="test_bot")
        if name in ("sendMessage", "editMessageText"):
            self._mid += 1
            chat_id = params.get("chat_id")
            return Message(
                message_id=params.get("message_id", self._mid),
                date=dt.datetime.now(dt.UTC),
                chat=Chat(id=chat_id, type="private" if chat_id and chat_id > 0 else "supergroup"),
                text=params.get("text", ""),
            )
        return True

    # helpers -----------------------------------------------------------
    def last(self, method: str) -> dict[str, Any] | None:
        for row in reversed(self.sent):
            if row["method"] == method:
                return row
        return None

    def latest_keyboard(self, chat_id: int) -> Any:
        for row in reversed(self.sent):
            if row["method"] in ("sendMessage", "editMessageText") and row.get("chat_id") == chat_id:
                return row.get("reply_markup")
        return None

    def texts_for(self, chat_id: int) -> list[str]:
        return [
            r.get("text", "")
            for r in self.sent
            if r["method"] in ("sendMessage", "editMessageText") and r.get("chat_id") == chat_id
        ]


class Harness:
    def __init__(self, bot: Bot, dp: Dispatcher, db: Database, session: FakeSession, service: GameService):
        self.bot = bot
        self.dp = dp
        self.db = db
        self.session = session
        self.service = service
        self._update_id = 0

    async def send(self, message: Message) -> None:
        self._update_id += 1
        await self.dp.feed_update(self.bot, Update(update_id=self._update_id, message=message))

    async def click(self, user: User, chat_id: int, data: str, message: Message | None = None) -> None:
        self._update_id += 1
        msg = message or make_message(chat_id, user, "")
        cb = CallbackQuery(
            id=str(self._update_id),
            from_user=user,
            chat_instance="test",
            data=data,
            message=msg,
        )
        await self.dp.feed_update(self.bot, Update(update_id=self._update_id, callback_query=cb))

    @staticmethod
    def buttons(markup: Any) -> dict[str, str]:
        out: dict[str, str] = {}
        if not markup:
            return out
        for row in markup.get("inline_keyboard", []):
            for btn in row:
                out[btn["callback_data"]] = btn["text"]
        return out


@pytest.fixture
async def harness(tmp_path):
    db = Database(f"sqlite:///{tmp_path}/it.db")
    await db.start()
    fake = FakeSession()
    bot = Bot(
        token="123456:TEST",
        session=fake,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    settings = Settings(BOT_TOKEN="123456:TEST", DATABASE_URL=f"sqlite:///{tmp_path}/it.db")
    service = GameService(bot, db, settings)
    dp = Dispatcher()
    # routers are module level singletons and can be attached only once, so
    # reload the handler modules to get fresh routers for every test
    import importlib

    from bot.handlers import common, play, stats
    from bot.main import _inject

    common = importlib.reload(common)
    play = importlib.reload(play)
    stats = importlib.reload(stats)

    dp.include_router(common.router)
    dp.include_router(play.router)
    dp.include_router(stats.router)
    dp.message.middleware(_inject(service))
    dp.callback_query.middleware(_inject(service))
    await db.upsert_user(1, "u1", "Ali")

    yield Harness(bot, dp, db, fake, service)
    await bot.session.close()
    await db.close()


@pytest.mark.asyncio
async def test_start_command(harness):
    user = make_user(1, "Ali")
    await harness.send(make_message(1, user, "/start"))
    assert any("ربات بازی‌های کارتی" in t for t in harness.session.texts_for(1))


@pytest.mark.asyncio
async def test_full_pasur_game_in_group(harness):
    owner = make_user(1, "Ali")
    p2 = make_user(2, "Sara")
    await harness.send(make_message(GROUP.id, owner, "/new pasur"))
    session = await harness.db.get_active_session(GROUP.id)
    assert session is not None and session.status == "lobby"

    await harness.send(make_message(GROUP.id, p2, "/join"))
    session = await harness.db.get_session(session.id)
    assert len(session.state["players"]) == 2

    lobby_msg = make_message(GROUP.id, owner, "", message_id=session.message_id)
    await harness.click(owner, GROUP.id, f"l:s:{session.id}", lobby_msg)
    session = await harness.db.get_session(session.id)
    assert session.status == "running"
    assert session.state["phase"] == "playing"

    # each player got a private hand message; the player on turn has buttons
    for uid in (1, 2):
        assert any("برگ‌های شما" in t for t in harness.session.texts_for(uid))
    assert any(harness.session.latest_keyboard(uid) for uid in (1, 2))

    guard = 0
    while guard < 1500:
        guard += 1
        session = await harness.db.get_session(session.id)
        engine = harness.service.engine(session)
        if engine.finished:
            break
        seat = engine.current_seat()
        uid = session.state["players"][seat]
        kb = harness.session.latest_keyboard(uid)
        buttons = harness.buttons(kb)
        plays = [d for d in buttons if d.startswith("g:p:")]
        if not plays:  # a capture-choice screen is open
            plays = [d for d in buttons if d.startswith("g:c:")]
        assert plays, "current player has no card buttons"
        await harness.click(make_user(uid, f"P{uid}"), uid, plays[0])

    session = await harness.db.get_session(session.id)
    assert session.status == "finished"
    user = await harness.db.get_user(1)
    assert user.games_played == 1


@pytest.mark.asyncio
async def test_hokm_lobby_needs_four_players(harness):
    owner = make_user(1, "Ali")
    await harness.send(make_message(GROUP.id, owner, "/new hokm"))
    session = await harness.db.get_active_session(GROUP.id)
    assert session is not None
    await harness.click(owner, GROUP.id, f"l:s:{session.id}", make_message(GROUP.id, owner, ""))
    assert any("حداقل" in t for t in harness.session.texts_for(GROUP.id))


@pytest.mark.asyncio
async def test_non_owner_cannot_start(harness):
    owner = make_user(1, "Ali")
    other = make_user(7, "Reza")
    await harness.send(make_message(GROUP.id, owner, "/new pasur"))
    session = await harness.db.get_active_session(GROUP.id)
    await harness.click(other, GROUP.id, f"l:s:{session.id}", make_message(GROUP.id, other, ""))
    session = await harness.db.get_session(session.id)
    assert session.status == "lobby"


@pytest.mark.asyncio
async def test_deep_link_join(harness):
    user = make_user(1, "Ali")
    await harness.send(make_message(1, user, "/new pasur"))
    session = await harness.db.get_active_session(1)
    friend = make_user(5, "Nina")
    await harness.send(make_message(5, friend, f"/start join_{session.id}"))
    session = await harness.db.get_session(session.id)
    assert 5 in session.state["players"]
    assert any("نشستید" in t for t in harness.session.texts_for(5))


@pytest.mark.asyncio
async def test_second_game_in_same_chat_is_rejected(harness):
    owner = make_user(1, "Ali")
    await harness.send(make_message(GROUP.id, owner, "/new pasur"))
    await harness.send(make_message(GROUP.id, owner, "/new hokm"))
    assert any("در جریان است" in t for t in harness.session.texts_for(GROUP.id))


@pytest.mark.asyncio
async def test_stats_command(harness):
    user = make_user(1, "Ali")
    await harness.send(make_message(1, user, "/stats"))
    assert any("بازی" in t for t in harness.session.texts_for(1))
