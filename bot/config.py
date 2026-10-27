"""Runtime configuration (12-factor, loaded from environment / .env)."""

from __future__ import annotations

import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def platform_webhook_url() -> str:
    """Auto-detect the public URL on common hosting platforms."""
    render = os.getenv("RENDER_EXTERNAL_URL")
    if render:
        return render.rstrip("/") + "/webhook"
    koyeb = os.getenv("KOYEB_PUBLIC_DOMAIN")
    if koyeb:
        return "https://" + koyeb.strip("/") + "/webhook"
    railway = os.getenv("RAILWAY_PUBLIC_DOMAIN")
    if railway:
        return "https://" + railway.strip("/") + "/webhook"
    fly = os.getenv("FLY_APP_NAME")
    if fly:
        return f"https://{fly}.fly.dev/webhook"
    return ""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    bot_token: str = Field(default="", alias="BOT_TOKEN")
    database_url: str = Field(default="sqlite:///data/gamebot.db", alias="DATABASE_URL")

    # behaviour
    turn_timeout: int = Field(default=45, alias="TURN_TIMEOUT")
    lobby_timeout: int = Field(default=180, alias="LOBBY_TIMEOUT")

    # web server / webhook
    webhook_url: str = Field(default="", alias="WEBHOOK_URL")
    webhook_secret: str = Field(default="", alias="WEBHOOK_SECRET")
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=8080, alias="PORT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    def model_post_init(self, __context: object) -> None:  # noqa: D401
        if not self.webhook_url:
            detected = platform_webhook_url()
            if detected:
                object.__setattr__(self, "webhook_url", detected)


settings = Settings()  # type: ignore[call-arg]
