"""Runtime configuration (12-factor, loaded from environment / .env)."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    bot_token: str = Field(default="", alias="BOT_TOKEN")
    database_url: str = Field(default="sqlite:///data/gamebot.db", alias="DATABASE_URL")

    # behaviour
    turn_timeout: int = Field(default=45, alias="TURN_TIMEOUT")
    lobby_timeout: int = Field(default=180, alias="LOBBY_TIMEOUT")
    min_players: int = Field(default=2, alias="MIN_PLAYERS")
    max_players: int = Field(default=4, alias="MAX_PLAYERS")
    webhook_url: str = Field(default="", alias="WEBHOOK_URL")
    webhook_secret: str = Field(default="", alias="WEBHOOK_SECRET")
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=8080, alias="PORT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")


settings = Settings()  # type: ignore[call-arg]
