"""پیش‌پرواز: توکن ربات و اتصال دیتابیس را قبل از اجرا بررسی می‌کند.

    python -m scripts.doctor

اگر همه‌چیز ✅ بود، با `python -m bot.main` ربات را اجرا کنید.
"""

from __future__ import annotations

import asyncio
import sys

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from bot.config import settings
from bot.db.storage import Database


async def check_telegram() -> bool:
    print("• بررسی توکن تلگرام ...")
    if not settings.bot_token or ":" not in settings.bot_token:
        print("  ❌ BOT_TOKEN تنظیم نشده یا نامعتبر است (باید شکل 123456:AA... داشته باشد).")
        return False
    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    try:
        me = await bot.get_me()
    except Exception as exc:  # noqa: BLE001 - report anything to the user
        print(f"  ❌ اتصال به تلگرام برقرار نشد: {type(exc).__name__}: {exc}")
        print("     (اگر داخل ایران هستید، سرور/هاست باید به api.telegram.org دسترسی داشته باشد.)")
        return False
    finally:
        await bot.session.close()
    print(f"  ✅ توکن معتبر است: @{me.username}  (id: {me.id})")
    print(f"  🔗 آدرس ربات: https://t.me/{me.username}")
    return True


async def check_database() -> bool:
    print("• بررسی دیتابیس ...")
    dsn = settings.database_url
    backend = "SQLite" if dsn.startswith("sqlite") else "PostgreSQL"
    print(f"  ({backend}) {dsn.split('@')[-1] if '@' in dsn else dsn}")
    db = Database(dsn)
    try:
        await db.start()
        user = await db.upsert_user(999_999_999, "doctor", "Doctor")
        session = await db.create_session(
            chat_id=0, chat_type="private", game="pasur", owner_id=user.id, players=[user.id]
        )
        loaded = await db.get_session(session.id)
        assert loaded is not None and loaded.game == "pasur"
        await db.delete_session(session.id)
        await db.delete_user(user.id)
        print("  ✅ اتصال برقرار است و جدول‌ها آماده‌اند (users / game_sessions / match_results).")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ❌ اتصال به دیتابیس برقرار نشد: {type(exc).__name__}: {exc}")
        print("     نکته: پسورد را در DATABASE_URL بگذارید و اگر کاراکتر خاص دارد، URL-encode کنید.")
        return False
    finally:
        await db.close()


async def check_webhook_config() -> bool:
    url = settings.webhook_url
    if not url:
        print("• حالت اجرا: polling (WEBHOOK_URL خالی است) — نیازی به دامنه نیست.")
        return True
    print(f"• حالت اجرا: webhook → {url}")
    if not url.startswith("https://"):
        print("  ❌ آدرس وبهوک باید با https باشد.")
        return False
    if not settings.webhook_secret:
        print("  ⚠️ WEBHOOK_SECRET خالی است؛ تنظیم یک رشته تصادفی امن‌تر است.")
    return True


async def main() -> int:
    print("🩺 بررسی سلامت ربات بازی‌های کارتی\n")
    results = [
        await check_telegram(),
        await check_database(),
        await check_webhook_config(),
    ]
    print()
    if all(results):
        print("🎉 همه‌چیز آماده است. اجرا کنید:  python -m bot.main")
        return 0
    print("⚠️ بعضی بررسی‌ها ناموفق بود؛ پیام‌های بالا را ببینید.")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
