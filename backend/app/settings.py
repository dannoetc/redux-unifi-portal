from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    BASE_URL: str = "http://localhost:3000"

    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/redux_portal"
    REDIS_URL: str = "redis://localhost:6379/0"
    SECRET_KEY: str = "dev-change-me"
    LOG_LEVEL: str = "INFO"

    # SMTP
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "wifi@reduxtc.com"
    SMTP_FROM_NAME: str = "ReduxTC WiFi"

    # CORS
    CORS_ALLOW_ORIGINS: list[str] = ["http://localhost:3000"]

    # Optional
    SENTRY_DSN: str | None = None

settings = Settings()
