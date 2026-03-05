from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    BASE_URL: str = "http://localhost:3000"
    DOMAIN: str = ""

    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/redux_portal"
    REDIS_URL: str = "redis://localhost:6379/0"
    SECRET_KEY: str = "dev-change-me"
    SECRETS_ENCRYPTION_KEY: str = ""
    LOG_LEVEL: str = "INFO"
    ADMIN_SESSION_MAX_AGE_SECONDS: int = 60 * 60 * 12
    ADMIN_SESSION_COOKIE_SECURE: bool = False
    OTP_TTL_SECONDS: int = 60 * 10
    OTP_MAX_ATTEMPTS: int = 5
    ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 60
    ADMIN_LOGIN_RATE_LIMIT_PER_IP: int = 10
    ADMIN_LOGIN_RATE_LIMIT_PER_EMAIL: int = 8
    SETUP_BOOTSTRAP_RATE_LIMIT_WINDOW_SECONDS: int = 60
    SETUP_BOOTSTRAP_RATE_LIMIT_PER_IP: int = 5
    OTP_RATE_LIMIT_WINDOW_SECONDS: int = 60
    OTP_RATE_LIMIT_PER_IP: int = 5
    OTP_RATE_LIMIT_PER_MAC: int = 5
    OTP_VERIFY_RATE_LIMIT_PER_IP: int = 10
    OTP_VERIFY_RATE_LIMIT_PER_MAC: int = 10
    VOUCHER_RATE_LIMIT_WINDOW_SECONDS: int = 60
    VOUCHER_RATE_LIMIT_PER_IP: int = 10
    VOUCHER_RATE_LIMIT_PER_MAC: int = 10
    OIDC_STATE_TTL_SECONDS: int = 60 * 10
    CELERY_BROKER_URL: str | None = None
    CELERY_RESULT_BACKEND: str | None = None

    # SMTP
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "wifi@reduxtc.com"
    SMTP_FROM_NAME: str = "ReduxTC WiFi"

    # UniFi
    UNIFI_VERIFY_SSL: bool = True
    UNIFI_CLIENT_LOOKUP_ATTEMPTS: int = 6
    UNIFI_CLIENT_LOOKUP_BACKOFF_SECONDS: float = 0.6

    # CORS
    CORS_ALLOW_ORIGINS: str = "http://localhost:3000"
    TLS_CERTS_DIR: str = "/etc/letsencrypt"
    TLS_CERT_SOURCE_FILE: str = ".cert-source"

    # Setup wizard defaults
    SETUP_DEFAULT_ADMIN_EMAIL: str = ""
    SETUP_DEFAULT_TENANT_NAME: str = ""
    SETUP_DEFAULT_TENANT_SLUG: str = ""
    SETUP_DEFAULT_SITE_SLUG: str = ""
    SETUP_DEFAULT_SITE_DISPLAY_NAME: str = ""
    SETUP_DEFAULT_UNIFI_BASE_URL: str = ""
    SETUP_DEFAULT_UNIFI_PORT: int = 443

    def cors_allow_origins_list(self) -> list[str]:
        return [item.strip() for item in self.CORS_ALLOW_ORIGINS.split(",") if item.strip()]

    # Optional
    SENTRY_DSN: str | None = None

settings = Settings()
