import time
from datetime import timedelta

import pyotp
from sqlalchemy import select, update

from app.db import get_sessionmaker
from app.models import Account, AuthIdentity, UserSession
from app.security import decrypt_secret, utcnow

from .conftest import signup

PASSWORD = "correct-horse-1"


def age_sessions(minutes: int) -> None:
    with get_sessionmaker()() as db:
        db.execute(update(UserSession).values(authenticated_at=utcnow() - timedelta(minutes=minutes)))
        db.commit()


def enable_two_factor(client) -> tuple[str, list[str]]:
    setup = client.post("/api/account/two-factor/setup")
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    confirm = client.post("/api/account/two-factor/confirm", json={"code": pyotp.TOTP(secret).now()})
    assert confirm.status_code == 200, confirm.text
    return secret, confirm.json()["recoveryCodes"]


# --- Private access, CSRF, caching ------------------------------------------


def test_private_routes_need_a_session(client):
    for path in ("/api/me", "/api/sessions", "/api/stores", "/api/updates", "/api/alerts"):
        response = client.get(path)
        assert response.status_code == 401, path
        assert response.json()["detail"]["code"] == "unauthenticated"


def test_responses_are_not_cached(client):
    assert client.get("/api/me").headers["cache-control"] == "no-store"
    assert client.get("/api/health").headers["cache-control"] == "no-store"


def test_writes_need_same_origin_and_csrf_token(client):
    no_token = client.post(
        "/api/auth/sign-in", json={"email": "a@example.com", "password": PASSWORD}, headers={"X-CSRF-Token": ""}
    )
    assert no_token.status_code == 403
    assert no_token.json()["detail"]["code"] == "csrf_failed"
    other_origin = client.post(
        "/api/auth/sign-in", json={"email": "a@example.com", "password": PASSWORD}, headers={"Origin": "https://evil.example"}
    )
    assert other_origin.status_code == 403


# --- Email sign-up ----------------------------------------------------------


def test_signup_verifies_email_before_password(client, sender):
    account = signup(client, sender)
    assert account["email"] == "a@example.com"
    assert account["emailVerified"] is True
    assert account["hasPassword"] is True
    assert client.get("/api/me").json()["email"] == "a@example.com"
    assert sender.sent[0].to == "a@example.com"


def test_signup_link_works_once(client, sender):
    client.post("/api/auth/signup", json={"email": "b@example.com"})
    token = sender.last_link("/verify-email")
    first = client.post("/api/auth/signup/complete", json={"token": token, "password": PASSWORD})
    again = client.post("/api/auth/signup/complete", json={"token": token, "password": PASSWORD})
    assert first.status_code == 200
    assert again.status_code == 400
    assert again.json()["detail"]["code"] == "invalid_token"


def test_signup_does_not_reveal_existing_accounts(client, new_client, sender):
    signup(client, sender)
    other = new_client()
    response = other.post("/api/auth/signup", json={"email": "A@example.com"})
    assert response.status_code == 204
    assert sender.sent[-1].subject == "You already have an account on The Catalogue"


def test_short_password_is_rejected(client, sender):
    client.post("/api/auth/signup", json={"email": "c@example.com"})
    token = sender.last_link("/verify-email")
    response = client.post("/api/auth/signup/complete", json={"token": token, "password": "short"})
    assert response.status_code == 422


# --- Password sign-in -------------------------------------------------------


def test_sign_in_and_wrong_password(client, new_client, sender):
    signup(client, sender)
    other = new_client()
    wrong = other.post("/api/auth/sign-in", json={"email": "a@example.com", "password": "wrong-password"})
    assert wrong.status_code == 401
    assert wrong.json()["detail"]["code"] == "invalid_credentials"
    unknown = other.post("/api/auth/sign-in", json={"email": "nobody@example.com", "password": PASSWORD})
    assert unknown.json()["detail"] == wrong.json()["detail"]
    ok = other.post("/api/auth/sign-in", json={"email": "A@Example.com", "password": PASSWORD})
    assert ok.status_code == 200
    assert ok.json()["status"] == "signed_in"
    assert other.get("/api/me").status_code == 200


def test_sign_in_is_rate_limited(client):
    statuses = [
        client.post("/api/auth/sign-in", json={"email": "a@example.com", "password": "wrong-password"}).status_code
        for _ in range(11)
    ]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


# --- Sessions and renewal ---------------------------------------------------


def test_sessions_list_and_sign_out_one_device(client, new_client, sender):
    signup(client, sender)
    phone = new_client()
    phone.post("/api/auth/sign-in", json={"email": "a@example.com", "password": PASSWORD})
    sessions = client.get("/api/sessions").json()
    assert len(sessions) == 2
    other = next(item for item in sessions if not item["current"])
    assert client.delete(f"/api/sessions/{other['id']}").status_code == 204
    assert phone.get("/api/me").status_code == 401
    assert client.get("/api/me").status_code == 200


def test_cannot_revoke_another_accounts_session(client, new_client, sender):
    signup(client, sender)
    other = new_client()
    signup(other, sender, email="z@example.com")
    target = other.get("/api/sessions").json()[0]["id"]
    assert client.delete(f"/api/sessions/{target}").status_code == 404
    assert other.get("/api/me").status_code == 200


def test_sign_out_everywhere(client, new_client, sender):
    signup(client, sender)
    phone = new_client()
    phone.post("/api/auth/sign-in", json={"email": "a@example.com", "password": PASSWORD})
    assert client.delete("/api/sessions").status_code == 204
    assert client.get("/api/me").status_code == 401
    assert phone.get("/api/me").status_code == 401


def test_refresh_rotates_and_detects_replay(client, new_client, sender):
    signup(client, sender)
    old_refresh = client.cookies.get("cat_refresh", path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 204
    new_refresh = client.cookies.get("cat_refresh", path="/api/auth")
    assert new_refresh and new_refresh != old_refresh

    # A second tab still holding the old token, sent as a raw Cookie header.
    other_tab = new_client()
    raw = {"Cookie": f"cat_refresh={old_refresh}; csrf_token={other_tab.headers['X-CSRF-Token']}"}
    # Within the grace period, the old token still works once more.
    assert other_tab.post("/api/auth/refresh", headers=raw).status_code == 204
    # After the grace period, a replayed old token revokes the session.
    with get_sessionmaker()() as db:
        db.execute(update(UserSession).values(rotated_at=utcnow() - timedelta(minutes=5)))
        db.commit()
    assert other_tab.post("/api/auth/refresh", headers=raw).status_code == 401
    with get_sessionmaker()() as db:
        assert db.scalar(select(UserSession.revoked_at)) is not None
    assert client.get("/api/me").status_code == 401


# --- Two-factor authentication ----------------------------------------------


def test_two_factor_after_password_and_recovery_codes(client, new_client, sender):
    signup(client, sender)
    secret, codes = enable_two_factor(client)
    assert len(codes) == 10
    assert client.get("/api/me").json()["recoveryCodesLeft"] == 10

    other = new_client()
    first = other.post("/api/auth/sign-in", json={"email": "a@example.com", "password": PASSWORD})
    assert first.json() == {"status": "two_factor_required"}
    assert other.get("/api/me").status_code == 401

    # The code accepted at setup can't be used again.
    reused = other.post("/api/auth/two-factor", json={"code": pyotp.TOTP(secret).now()})
    assert reused.status_code == 401
    ok = other.post("/api/auth/two-factor", json={"code": codes[0]})
    assert ok.status_code == 200
    assert ok.json()["recoveryCodesLeft"] == 9

    third = new_client()
    third.post("/api/auth/sign-in", json={"email": "a@example.com", "password": PASSWORD})
    assert third.post("/api/auth/two-factor", json={"code": codes[0]}).status_code == 401
    next_code = pyotp.TOTP(secret).at(time.time() + 30)
    assert third.post("/api/auth/two-factor", json={"code": next_code}).status_code == 200


def test_two_factor_secret_is_encrypted(client, sender):
    signup(client, sender)
    secret, _ = enable_two_factor(client)
    with get_sessionmaker()() as db:
        stored = db.scalar(select(Account.totp_secret_encrypted))
    assert secret not in stored
    assert decrypt_secret(stored) == secret


def test_sensitive_changes_need_a_recent_sign_in(client, sender):
    signup(client, sender)
    age_sessions(30)
    response = client.post("/api/account/two-factor/setup")
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "reauthentication_required"


def test_disable_two_factor(client, sender):
    signup(client, sender)
    _, codes = enable_two_factor(client)
    assert client.post("/api/account/two-factor/disable", json={"code": codes[1]}).status_code == 204
    me = client.get("/api/me").json()
    assert me["twoFactorEnabled"] is False
    assert me["recoveryCodesLeft"] == 0


# --- Passwords --------------------------------------------------------------


def test_password_change_revokes_every_session(client, new_client, sender):
    signup(client, sender)
    phone = new_client()
    phone.post("/api/auth/sign-in", json={"email": "a@example.com", "password": PASSWORD})
    wrong = client.post("/api/account/password", json={"current": "nope-nope", "next": "new-password-2"})
    assert wrong.status_code == 401
    assert client.post("/api/account/password", json={"current": PASSWORD, "next": "new-password-2"}).status_code == 204
    assert client.get("/api/me").status_code == 401
    assert phone.get("/api/me").status_code == 401
    again = new_client().post("/api/auth/sign-in", json={"email": "a@example.com", "password": "new-password-2"})
    assert again.json()["status"] == "signed_in"


def test_password_reset_revokes_sessions_and_keeps_two_factor(client, new_client, sender):
    signup(client, sender)
    enable_two_factor(client)
    anonymous = new_client()
    assert anonymous.post("/api/auth/password-reset", json={"email": "nobody@example.com"}).status_code == 204
    assert anonymous.post("/api/auth/password-reset", json={"email": "a@example.com"}).status_code == 204
    token = sender.last_link("/reset-password")
    done = anonymous.post("/api/auth/password-reset/complete", json={"token": token, "password": "after-reset-3"})
    assert done.status_code == 204
    assert client.get("/api/me").status_code == 401
    result = new_client().post("/api/auth/sign-in", json={"email": "a@example.com", "password": "after-reset-3"})
    assert result.json() == {"status": "two_factor_required"}
    reused = anonymous.post("/api/auth/password-reset/complete", json={"token": token, "password": "again-again-4"})
    assert reused.status_code == 400


# --- Google -----------------------------------------------------------------


def google_round_trip(client, google, **params):
    start = client.get("/api/auth/google/start", params=params)
    assert start.status_code == 303
    assert start.headers["location"].startswith("https://accounts.google.com/")
    state = google.started[-1]["state"]
    return client.get("/api/auth/google/callback", params={"state": state, "code": "auth-code"})


def test_google_sign_in_creates_and_recognises_the_account(client, new_client, google):
    callback = google_round_trip(client, google)
    assert callback.headers["location"] == "http://localhost:5173/stores"
    me = client.get("/api/me").json()
    assert me["email"] == "g.user@example.com"
    assert me["googleLinked"] is True
    assert me["hasPassword"] is False

    # A returning user is recognised by `sub`, even if the Google email changed.
    google.user.email = "renamed@example.com"
    other = new_client()
    google_round_trip(other, google)
    assert other.get("/api/me").json()["id"] == me["id"]


def test_google_state_works_once(client, google):
    google_round_trip(client, google)
    state = google.started[-1]["state"]
    again = client.get("/api/auth/google/callback", params={"state": state, "code": "auth-code"})
    assert again.headers["location"] == "http://localhost:5173/login?notice=google_failed"


def test_google_does_not_take_over_an_existing_email(client, new_client, sender, google):
    signup(client, sender, email="g.user@example.com")
    visitor = new_client()
    callback = google_round_trip(visitor, google)
    assert callback.headers["location"] == "http://localhost:5173/login?notice=google_account_exists"
    assert visitor.get("/api/me").status_code == 401
    with get_sessionmaker()() as db:
        assert db.scalar(select(AuthIdentity)) is None


def test_link_google_after_proving_ownership(client, sender, google):
    signup(client, sender, email="g.user@example.com")
    callback = google_round_trip(client, google, intent="link", return_to="/account")
    assert callback.headers["location"] == "http://localhost:5173/account?google=linked"
    assert client.get("/api/me").json()["googleLinked"] is True


def test_link_google_needs_a_recent_sign_in(client, sender, google):
    signup(client, sender)
    age_sessions(30)
    start = client.get("/api/auth/google/start", params={"intent": "link", "return_to": "/account"})
    assert start.headers["location"] == "http://localhost:5173/account?google=reauthentication_required"


def test_google_then_two_factor(client, new_client, google):
    google_round_trip(client, google)
    age_sessions(0)
    secret, _ = enable_two_factor(client)
    other = new_client()
    callback = google_round_trip(other, google)
    assert callback.headers["location"] == "http://localhost:5173/two-factor"
    assert other.get("/api/me").status_code == 401
    next_code = pyotp.TOTP(secret).at(time.time() + 30)
    assert other.post("/api/auth/two-factor", json={"code": next_code}).status_code == 200


def test_return_to_must_be_a_local_path(client, google):
    callback = google_round_trip(client, google, return_to="https://evil.example/steal")
    assert callback.headers["location"] == "http://localhost:5173/stores"
