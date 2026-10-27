"""Profile and leaderboard commands."""

from __future__ import annotations

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

from ..service import GameService

router = Router(name="stats")


@router.message(Command("stats", "آمار"))
async def stats_cmd(message: Message, service: GameService) -> None:
    text = await service.stats(message.from_user.id)
    if text is None:
        await message.answer("هنوز بازی‌ای ثبت نشده. یک میز بساز و بازی کن! 🎴")
        return
    await message.answer(text)


@router.message(Command("top", "برترین"))
async def top_cmd(message: Message, service: GameService) -> None:
    await message.answer(await service.leaderboard())
