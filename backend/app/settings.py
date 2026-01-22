from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    BASE_URL: str = "http://localhost:3000"

    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/redux_portal"
    REDIS_URL: str = "redis://localhost:6379/0"
    SECRET_KEY: str = "dev-change-me"
    OPENVPN_ENCRYPTION_KEY: str = ""
    OPENVPN_GENERATE_COMMAND_PREFIX: str = "docker compose exec -T openvpn"
    LOG_LEVEL: str = "INFO"
    ADMIN_SESSION_MAX_AGE_SECONDS: int = 60 * 60 * 12
    ADMIN_SESSION_COOKIE_SECURE: bool = False
    OTP_TTL_SECONDS: int = 60 * 10
    OTP_MAX_ATTEMPTS: int = 5
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

    # OpenVPN default template
    OPENVPN_DEFAULT_TEMPLATE: str = """client
dev tun
proto udp
remote {{REMOTE_HOST}} {{REMOTE_PORT}}
resolv-retry infinite
nobind
persist-key
persist-tun
cipher AES-256-GCM
auth SHA256
comp-lzo
verb 3
"""

    # CORS
    CORS_ALLOW_ORIGINS: str = "http://localhost:3000"

    def cors_allow_origins_list(self) -> list[str]:
        return [item.strip() for item in self.CORS_ALLOW_ORIGINS.split(",") if item.strip()]

    # Optional
    SENTRY_DSN: str | None = None

settings = Settings()
