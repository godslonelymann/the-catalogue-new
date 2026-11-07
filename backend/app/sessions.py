"""Sessions, cookies, CSRF, rate limits, and the signed-in account dependency."""

import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, Request, Response
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .errors import ApiError, reauthentication_required, unauthenticated
from .models import Account, UserSession
from .security import create_access_token, decode_access_token, new_token, token_hash, utcnow

ACCESS_COOKIE = "cat_access"
REFRESH_COOKIE = "cat_refresh"
CHALLENGE_COOKIE = "cat_2fa"
CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "x-csrf-token"


# --- Cookies ----------------------------------------------------------------


def _cookie(response: Response, name: str, value: str, max_age: int, path: str, http_only: bool = True) -> None:
    response.set_cookie(
        name, value, max_age=max_age, path=path, httponly=http_only, secure=get_settings().cookie_secure, samesite="lax"
    )


def set_session_cookies(response: Response, account_id: uuid.UUID, session_id: uuid.UUID, refresh_token: str | None) -> None:
    settings = get_settings()
    _cookie(response, ACCESS_COOKIE, create_access_token(account_id, session_id), settings.access_token_minutes * 60, "/api")
    if refresh_token is not None:
        _cookie(response, REFRESH_COOKIE, refresh_token, settings.session_days * 86400, "/api/auth")


def clear_session_cookies(response: Response) -> None:
    secure = get_settings().cookie_secure
    response.delete_cookie(ACCESS_COOKIE, path="/api", secure=secure, httponly=True, samesite="lax")
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth", secure=secure, httponly=True, samesite="lax")


def set_challenge_cookie(response: Response, token: str) -> None:
    _cookie(response, CHALLENGE_COOKIE, token, get_settings().two_factor_challenge_minutes * 60, "/api/auth")


def clear_challenge_cookie(response: Response) -> None:
    response.delete_cookie(CHALLENGE_COOKIE, path="/api/auth", secure=get_settings().cookie_secure, httponly=True, samesite="lax")


def new_csrf_token() -> str:
    return secrets.token_urlsafe(24)


def set_csrf_cookie(response: Response, value: str) -> None:
    # Readable by the page, which echoes it in the X-CSRF-Token header.
    _cookie(response, CSRF_COOKIE, value, 30 * 86400, "/", http_only=False)


# --- Sessions ---------------------------------------------------------------


def client_ip(request: Request) -> str:
    # Caddy sets X-Forwarded-For in production. Uvicorn only binds to 127.0.0.1.
    forwarded = request.headers.get("x-forwarded-for", "")
    return (forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else ""))[:64]


def start_session(db: Session, request: Request, response: Response, account: Account) -> UserSession:
    """Creates a session after a successful sign-in (all factors done) and sets the cookies."""
    now = utcnow()
    refresh = new_token()
    session = UserSession(
        account_id=account.id,
        refresh_hash=token_hash(refresh),
        authenticated_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=get_settings().session_days),
        user_agent=(request.headers.get("user-agent") or "")[:512] or None,
        ip_address=client_ip(request) or None,
    )
    db.add(session)
    db.flush()
    set_session_cookies(response, account.id, session.id, refresh)
    return session


def revoke_all_sessions(db: Session, account_id: uuid.UUID) -> None:
    db.execute(
        update(UserSession)
        .where(UserSession.account_id == account_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


def active_session(db: Session, session_id: uuid.UUID) -> UserSession | None:
    session = db.get(UserSession, session_id)
    if session is None or session.revoked_at is not None or session.expires_at <= utcnow():
        return None
    return session


@dataclass
class Auth:
    account: Account
    session: UserSession

    def require_recent(self) -> None:
        window = timedelta(minutes=get_settings().recent_auth_minutes)
        if utcnow() - self.session.authenticated_at > window:
            raise reauthentication_required()


def optional_auth(request: Request, db: Session = Depends(get_db)) -> Auth | None:
    claims = decode_access_token(request.cookies.get(ACCESS_COOKIE, ""))
    if not claims:
        return None
    try:
        session_id = uuid.UUID(claims["sid"])
    except ValueError:
        return None
    session = active_session(db, session_id)
    if session is None or str(session.account_id) != claims["sub"]:
        return None
    account = db.get(Account, session.account_id)
    if account is None:
        return None
    now = utcnow()
    if now - session.last_seen_at > timedelta(minutes=5):
        session.last_seen_at = now
        db.commit()
    return Auth(account, session)


def require_auth(auth: Auth | None = Depends(optional_auth)) -> Auth:
    """Every private route depends on this. No valid session returns 401."""
    if auth is None:
        raise unauthenticated()
    return auth


# --- Rate limits ------------------------------------------------------------


def rate_limit(db: Session, key: str, limit: int, window_seconds: int) -> None:
    """Fixed-window counter in PostgreSQL. Raises 429 when the window is full."""
    count = db.execute(
        text(
            """
            INSERT INTO rate_limits (key, window_start, count) VALUES (:key, now(), 1)
            ON CONFLICT (key) DO UPDATE SET
              count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => :window)
                           THEN 1 ELSE rate_limits.count + 1 END,
              window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => :window)
                                  THEN now() ELSE rate_limits.window_start END
            RETURNING count
            """
        ),
        {"key": key[:255], "window": window_seconds},
    ).scalar_one()
    db.commit()
    if count > limit:
        raise ApiError(429, "rate_limited", "Too many attempts. Wait a few minutes and try again.", {"Retry-After": "300"})


def account_by_email(db: Session, email: str) -> Account | None:
    return db.scalar(select(Account).where(Account.email == email.strip().lower()))
