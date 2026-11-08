import os
import re
from dataclasses import dataclass, field

import pytest

# Tests use their own database and never send email or call Google.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://anurag.@localhost:5432/the_catalogue_test")
os.environ["MIGRATION_DATABASE_URL"] = os.environ["DATABASE_URL"]
os.environ["APP_BASE_URL"] = "http://localhost:5173"
os.environ["SMTP_PASSWORD"] = ""
os.environ["GOOGLE_CLIENT_ID"] = "test-client"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-secret"

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_engine  # noqa: E402
from app.emails import Email, get_email_sender  # noqa: E402
from app.google import GoogleUser, get_google_client  # noqa: E402
from app.main import create_app  # noqa: E402

ORIGIN = "http://localhost:5173"
TABLES = (
    "wishlist_items, restock_alerts, store_checks, catalogue_updates, price_points, variants, products, "
    "account_stores, store_hosts, stores, brands, "
    "store_check_failures, "
    "recovery_codes, two_factor_challenges, oauth_states, auth_tokens, sessions, auth_identities, accounts, rate_limits"
)


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    get_settings.cache_clear()
    config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    config.attributes["database_url"] = os.environ["DATABASE_URL"]
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    with get_engine().begin() as connection:
        connection.execute(text(f"TRUNCATE {TABLES} CASCADE"))
    yield


@dataclass
class FakeSender:
    sent: list[Email] = field(default_factory=list)

    def send(self, email: Email) -> None:
        self.sent.append(email)

    def last_link(self, path: str) -> str:
        for email in reversed(self.sent):
            match = re.search(rf"http://localhost:5173{path}\?token=([\w-]+)", email.text)
            if match:
                return match.group(1)
        raise AssertionError(f"No email with a {path} link")


@dataclass
class FakeGoogle:
    user: GoogleUser = field(default_factory=lambda: GoogleUser("google-sub-1", "g.user@example.com", True, "G User"))
    started: list[dict] = field(default_factory=list)

    def authorization_url(self, state: str, nonce: str, code_verifier: str) -> str:
        self.started.append({"state": state, "nonce": nonce, "verifier": code_verifier})
        return f"https://accounts.google.com/o/oauth2/v2/auth?state={state}"

    def exchange(self, code: str, code_verifier: str, nonce: str) -> GoogleUser:
        last = self.started[-1]
        assert code_verifier == last["verifier"] and nonce == last["nonce"], "PKCE verifier and nonce must round-trip"
        return self.user


@pytest.fixture
def sender() -> FakeSender:
    return FakeSender()


@pytest.fixture
def google() -> FakeGoogle:
    return FakeGoogle()


@pytest.fixture
def app(sender, google):
    application = create_app()
    application.dependency_overrides[get_email_sender] = lambda: sender
    application.dependency_overrides[get_google_client] = lambda: google
    return application


def make_client(app) -> TestClient:
    client = TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}, follow_redirects=False)
    client.get("/api/health")  # Sets the CSRF cookie.
    client.headers["X-CSRF-Token"] = client.cookies["csrf_token"]
    return client


@pytest.fixture
def client(app) -> TestClient:
    return make_client(app)


@pytest.fixture
def new_client(app):
    return lambda: make_client(app)


def signup(client: TestClient, sender: FakeSender, email: str = "a@example.com", password: str = "correct-horse-1") -> dict:
    assert client.post("/api/auth/signup", json={"email": email}).status_code == 204
    token = sender.last_link("/verify-email")
    response = client.post("/api/auth/signup/complete", json={"token": token, "name": "A", "password": password})
    assert response.status_code == 200, response.text
    return response.json()


# Store fixtures (`checker`, `user`) for the store, product, update, and alert tests.
from .store_fixtures import checker, user  # noqa: E402, F401
