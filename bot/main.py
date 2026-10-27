"""Entry point.

``python -m bot.main`` starts the bot in polling mode, or in webhook mode when
``WEBHOOK_URL`` is configured (recommended for production / serverless hosts).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, BotCommandScopeDefault
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiohttp import web

from .config import Settings, settings
from .db.storage import Database
from .handlers import common, play, stats
from .service import GameService

log = logging.getLogger(__name__)


async def ticker(service: GameService) -> None:
    """Background loop that enforces turn / lobby deadlines."""
    while True:
        try:
            await asyncio.sleep(3)
            await service.process_timeouts()
        except asyncio.CancelledError:  # pragma: no cover
            raise
        except Exception:  # pragma: no cover - keep the loop alive
            log.exception("timeout ticker failed")


async def set_commands(bot: Bot) -> None:
    commands = [
        BotCommand(command="new", description="ساخت میز بازی (پاسور / حکم)"),
        BotCommand(command="join", description="نشستن سر میز"),
        BotCommand(command="cancel", description="لغو میز"),
        BotCommand(command="rules", description="قوانین بازی‌ها"),
        BotCommand(command="stats", description="آمار من"),
        BotCommand(command="top", description="برترین بازیکنان"),
        BotCommand(command="help", description="راهنما"),
    ]
    await bot.set_my_commands(commands, scope=BotCommandScopeDefault())


def build_dispatcher(service: GameService) -> Dispatcher:
    dp = Dispatcher()
    dp.include_router(common.router)
    dp.include_router(play.router)
    dp.include_router(stats.router)
    dp.message.middleware(_inject(service))
    dp.callback_query.middleware(_inject(service))
    return dp


def _inject(service: GameService):
    from collections.abc import Awaitable, Callable
    from typing import Any

    from aiogram import BaseMiddleware
    from aiogram.types import TelegramObject

    class ServiceMiddleware(BaseMiddleware):
        async def __call__(
            self,
            handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
            event: TelegramObject,
            data: dict[str, Any],
        ) -> Any:
            data["service"] = service
            return await handler(event, data)

    return ServiceMiddleware()


async def run_polling(bot: Bot, dp: Dispatcher, service: GameService) -> None:
    task = asyncio.create_task(ticker(service))
    try:
        await set_commands(bot)
        log.info("bot started in polling mode")
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


async def run_webhook(bot: Bot, dp: Dispatcher, service: GameService, cfg: Settings) -> None:
    path = "/webhook"
    await set_commands(bot)
    await bot.set_webhook(
        cfg.webhook_url,
        secret_token=cfg.webhook_secret or None,
        drop_pending_updates=True,
        allowed_updates=dp.resolve_used_update_types(),
    )

    app = web.Application()
    handler = SimpleRequestHandler(
        dispatcher=dp, bot=bot, secret_token=cfg.webhook_secret or None
    )
    handler.register(app, path=path)
    setup_application(app, dp, bot=bot)

    async def health(_: web.Request) -> web.Response:
        return web.json_response({"ok": True, "service": "telegram-card-games"})

    app.router.add_get("/", health)
    app.router.add_get("/health", health)

    task = asyncio.create_task(ticker(service))
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, cfg.host, cfg.port)
    await site.start()
    log.info("webhook server listening on %s:%s", cfg.host, cfg.port)
    try:
        await asyncio.Event().wait()
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await runner.cleanup()


async def main() -> None:
    cfg = settings
    logging.basicConfig(
        level=getattr(logging, cfg.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if not cfg.bot_token:
        raise SystemExit("BOT_TOKEN is not set (put it in .env)")

    db = Database(cfg.database_url)
    await db.start()

    bot = Bot(
        token=cfg.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML, link_preview_is_disabled=True),
    )
    service = GameService(bot, db, cfg)
    dp = build_dispatcher(service)

    try:
        if cfg.webhook_url:
            await run_webhook(bot, dp, service, cfg)
        else:
            await run_polling(bot, dp, service)
    finally:
        await bot.session.close()
        await db.close()


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt, SystemExit):
        asyncio.run(main())
