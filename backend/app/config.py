from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Local development reads the .env file at the repository root.
# Production reads real environment variables on the EC2 host.
ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_ENV, env_file_encoding="utf-8", extra="ignore")

    app_base_url: str = "http://localhost:5173"
    app_env: str = "development"
    cookie_secure: bool = False

    database_url: str
    migration_database_url: str | None = None

    jwt_signing_key: str = Field(min_length=32)
    totp_encryption_key: str

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:5173/api/auth/google/callback"

    # Gmail SMTP. SMTP_PASSWORD is a 16-character Google app password.
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_timeout_seconds: int = 15
    email_from: str = ""
    email_reply_to: str = ""

    # Lifetimes
    access_token_minutes: int = 15
    session_days: int = 30
    recent_auth_minutes: int = 10
    email_token_minutes: int = 30
    oauth_state_minutes: int = 10
    two_factor_challenge_minutes: int = 10
    refresh_grace_seconds: int = 60

    @property
    def allowed_origin(self) -> str:
        parts = urlsplit(self.app_base_url)
        return f"{parts.scheme}://{parts.netloc}"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
