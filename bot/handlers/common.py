"""Shared handlers: /start, /help, /rules and the deep-link join flow."""

from __future__ import annotations

import html
import logging

from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from ..games.base import GameError
from ..games.registry import name_fa
from ..service import GameService

log = logging.getLogger(__name__)
router = Router(name="common")

WELCOME = """🎴 <b>ربات بازی‌های کارتی ایرانی</b>

اینجا می‌توانید با دوستانتان <b>پاسور</b> و <b>حکم</b> بازی کنید — هم داخل گروه، هم در میز خصوصی.

<b>در گروه:</b>
/new pasur — میز پاسور بساز
/new hokm — میز حکم بساز
/join — نشستن سر میز
/cancel — لغو میز

<b>در چت خصوصی:</b>
/new pasur — ساخت میز خصوصی و گرفتن لینک دعوت

/stats — آمار شما
/top — برترین بازیکنان
/rules — قوانین بازی‌ها

⚠️ برای دیدن برگ‌هایتان، هر بازیکن باید یک بار ربات را در چت خصوصی استارت کند."""

RULES_PASUR = """🎣 <b>قوانین پاسور</b>

با ۵۲ برگ و ۲ تا ۴ نفر (۴ نفره: دو تیم دو نفره، یارها روبه‌روی هم).

<b>پخش:</b> به هر نفر ۴ برگ و ۴ برگ رو به زمین. اگر بیش از یک سرباز روی زمین بیاید دوباره پخش می‌شود.

<b>برداشتن برگ‌ها:</b>
• شاه، شاه را و بی‌بی، بی‌بی را برمی‌دارد.
• سرباز همهٔ برگ‌های عددی و سربازهای روی زمین را برمی‌دارد (نه شاه و بی‌بی).
• برگ‌های عددی (آس=۱ … ۱۰=۱۰) هر ترکیبی را که با آن‌ها جمعش ۱۱ شود برمی‌دارند.

<b>سور:</b> اگر با برگی غیر از سرباز زمین را کامل خالی کنی، ۵ امتیاز می‌گیری (در پخش آخر و بعد از ۵۰ امتیاز حساب نمی‌شود).

<b>امتیازها:</b> هر آس ۱، هر سرباز ۱، ۲♣ ۲، ۱۰♦ ۳، هفت برگ یا بیشتر گشنیز ۷، هر سور ۵. اولین نفری/تیمی که به ۶۲ برسد برنده است."""

RULES_HOKM = """👑 <b>قوانین حکم</b>

دقیقاً ۴ نفر، دو تیم دو نفره (یارها روبه‌روی هم). ۵۲ برگ و ۱۳ برگ برای هر نفر.

<b>شروع:</b> حاکم ۵ برگ می‌گیرد و خال حکم را انتخاب می‌کند، بعد بقیهٔ برگ‌ها پخش می‌شود. حاکم اولین دست را شروع می‌کند.

<b>بازی:</b> باید از خال زمینه بازی کنی، اگر نداشتی هر برگی می‌توانی بیندازی. حکم از همه بالاتر است.

<b>امتیاز:</b> هر تیمی که زودتر ۷ دست ببرد، آن دست را می‌برد:
• برد عادی: ۱ امتیاز
• کوت (۷ بر ۰): ۲ امتیاز
• حاکم‌کوت (تیم حاکم ۷ بر ۰ ببازد): ۳ امتیاز

اولین تیمی که ۷ امتیاز بیاورد برندهٔ بازی است."""


def main_menu_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🎣 پاسور", callback_data="menu:new:pasur"),
                InlineKeyboardButton(text="👑 حکم", callback_data="menu:new:hokm"),
            ],
            [
                InlineKeyboardButton(text="📊 آمار من", callback_data="menu:stats"),
                InlineKeyboardButton(text="🏆 برترین‌ها", callback_data="menu:top"),
            ],
            [InlineKeyboardButton(text="📖 قوانین", callback_data="menu:rules")],
        ]
    )


async def create_lobby_message(
    message: Message, service: GameService, user_name: str, game_key: str
) -> None:
    chat = message.chat
    try:
        session = await service.create_lobby(
            chat_id=chat.id,
            chat_type=chat.type,
            owner_id=message.from_user.id,
            owner_name=user_name,
            game_key=game_key,
        )
    except GameError as exc:
        await message.answer(exc.fa)
        return

    await service.render_lobby(session)
    if chat.type == "private":
        link = await service.bot_link(f"join_{session.id}")
        await message.answer(
            "🔗 لینک دعوت میز شما:\n"
            f"<code>{html.escape(link)}</code>\n\n"
            "این لینک را برای دوستتان بفرستید. هر کس باز کند، سر میز می‌نشیند.",
            disable_web_page_preview=True,
        )


def parse_game(arg: str | None) -> str:
    if not arg:
        return "pasur"
    key = arg.strip().lower()
    aliases = {
        "pasur": "pasur",
        "پاسور": "pasur",
        "basra": "pasur",
        "hokm": "hokm",
        "حکم": "hokm",
    }
    if key not in aliases:
        raise GameError("unknown game", fa="بازی‌های موجود: pasur (پاسور) و hokm (حکم).")
    return aliases[key]


@router.message(CommandStart(deep_link=True))
async def start_deep_link(message: Message, command: CommandObject, service: GameService) -> None:
    payload = command.args or ""
    if payload.startswith("join_"):
        session_id = payload[5:]
        session = await service.db.get_session(session_id)
        if session is None:
            await message.answer("این میز پیدا نشد یا بسته شده است.")
            return
        name = html.escape(message.from_user.full_name)
        try:
            await service.join(session, message.from_user.id, name)
        except GameError as exc:
            if "قبلاً" in exc.fa:
                await message.answer("شما قبلاً سر این میز نشسته‌اید 🙂")
                return
            await message.answer(exc.fa)
            return
        await message.answer(
            f"✅ سر میز {name_fa(session.game)} نشستید!\n"
            "وقتی بازی شروع شود، برگ‌هایتان همین‌جا می‌آید.",
            reply_markup=main_menu_kb(),
        )
        return
    await message.answer(WELCOME, reply_markup=main_menu_kb())


@router.message(CommandStart())
async def start(message: Message, service: GameService) -> None:
    await service.db.upsert_user(
        message.from_user.id, message.from_user.username, message.from_user.first_name
    )
    await message.answer(WELCOME, reply_markup=main_menu_kb())


@router.message(Command("help"))
async def help_cmd(message: Message) -> None:
    await message.answer(WELCOME, reply_markup=main_menu_kb())


@router.message(Command("rules"))
async def rules_cmd(message: Message, command: CommandObject) -> None:
    arg = (command.args or "").strip().lower()
    if arg in ("pasur", "پاسور"):
        await message.answer(RULES_PASUR)
    elif arg in ("hokm", "حکم"):
        await message.answer(RULES_HOKM)
    else:
        await message.answer(RULES_PASUR)
        await message.answer(RULES_HOKM)


@router.message(Command("new", "game", "بازی", "میز"))
async def new_game(message: Message, command: CommandObject, service: GameService) -> None:
    await service.db.upsert_user(
        message.from_user.id, message.from_user.username, message.from_user.first_name
    )
    try:
        game_key = parse_game(command.args)
    except GameError as exc:
        await message.answer(exc.fa)
        return
    await create_lobby_message(message, service, html.escape(message.from_user.full_name), game_key)


@router.callback_query(F.data.startswith("menu:"))
async def menu_cb(call: CallbackQuery, service: GameService) -> None:
    action = call.data.split(":", 2)[1]
    if action == "new":
        game_key = call.data.split(":", 2)[2]
        if call.message.chat.type != "private":
            await call.answer("برای ساخت میز در گروه از دستور /new استفاده کنید.", show_alert=True)
            return
        await create_lobby_message(
            call.message, service, html.escape(call.from_user.full_name), game_key
        )
        await call.answer()
        return
    if action == "stats":
        text = await service.stats(call.from_user.id)
        await call.answer()
        await call.message.answer(text or "هنوز آماری برای شما ثبت نشده است.")
        return
    if action == "top":
        text = await service.leaderboard()
        await call.answer()
        await call.message.answer(text)
        return
    if action == "rules":
        await call.answer()
        await call.message.answer(RULES_PASUR)
        await call.message.answer(RULES_HOKM)
        return
    await call.answer()


@router.callback_query(F.data.startswith("menu_nogroup"))
async def _unused(call: CallbackQuery) -> None:  # pragma: no cover
    await call.answer()


@router.message(Command("join", "نشستن"))
async def join_cmd(message: Message, service: GameService) -> None:
    session = await service.db.get_active_session(message.chat.id)
    if not session or session.status != "lobby":
        await message.answer("میز بازی در این چت باز نیست. با /new بسازید.")
        return
    try:
        await service.join(session, message.from_user.id, html.escape(message.from_user.full_name))
    except GameError as exc:
        await message.answer(exc.fa)
        return
    await message.answer(f"✅ {html.escape(message.from_user.full_name)} سر میز نشست.")


@router.message(Command("cancel"))
async def cancel_cmd(message: Message, service: GameService) -> None:
    session = await service.db.get_active_session(message.chat.id)
    if not session:
        await message.answer("میز فعالی در این چت نیست.")
        return
    if message.from_user.id not in (session.owner_id, *session.state.get("players", [])):
        await message.answer("فقط سازنده یا بازیکنان میز می‌توانند لغو کنند.")
        return
    await service.cancel(session)
