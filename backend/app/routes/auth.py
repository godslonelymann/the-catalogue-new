"""Public authentication routes: email and password, sign-up, reset, Google, and two-factor."""

import secrets
from datetime import timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from .. import emails
from ..config import get_settings
from ..db import get_db
from ..emails import EmailSender, get_email_sender
from ..errors import ApiError, unauthenticated
from ..google import GoogleClient, get_google_client
from ..models import Account, AuthIdentity, AuthToken, OAuthState, RecoveryCode, TwoFactorChallenge, UserSession
from ..schemas import CodeIn, CompleteSignupIn, EmailIn, ResetPasswordIn, SignInIn, SignInOut
from ..security import (
    MAX_PASSWORD,
    MIN_PASSWORD,
    decrypt_secret,
    hash_password,
    looks_like_recovery_code,
    match_totp,
    new_token,
    token_hash,
    utcnow,
    verify_password,
    verify_recovery_code,
)
from ..sessions import (
    CHALLENGE_COOKIE,
    REFRESH_COOKIE,
    Auth,
    account_by_email,
    active_session,
    clear_challenge_cookie,
    clear_session_cookies,
    client_ip,
    optional_auth,
    rate_limit,
    revoke_all_sessions,
    set_challenge_cookie,
    set_session_cookies,
    start_session,
)
from .account import account_out

router = APIRouter(prefix="/api/auth", tags=["auth"])

INVALID_LINK = ApiError(400, "invalid_token", "This link has expired or was already used. Request a new link.")


def check_password(password: str) -> None:
    if not (MIN_PASSWORD <= len(password) <= MAX_PASSWORD):
        raise ApiError(422, "invalid_request", f"Use {MIN_PASSWORD} to {MAX_PASSWORD} characters.")


def safe_return_to(value: str | None, default: str = "/stores") -> str:
    """Only same-site paths. Rejects absolute URLs and protocol-relative paths."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return default
    return value[:512]


def finish_first_factor(db: Session, request: Request, response: Response, account: Account, return_to: str) -> bool:
    """After a correct password or Google sign-in. Returns True when a second factor is needed."""
    if account.totp_enabled:
        token = new_token()
        db.add(
            TwoFactorChallenge(
                token_hash=token_hash(token),
                account_id=account.id,
                return_to=return_to,
                expires_at=utcnow() + timedelta(minutes=get_settings().two_factor_challenge_minutes),
            )
        )
        set_challenge_cookie(response, token)
        return True
    start_session(db, request, response, account)
    return False


def consume_email_token(db: Session, token: str, purpose: str) -> AuthToken | None:
    """Uses a one-time token in a single UPDATE, so two requests can't both use it."""
    row = db.execute(
        text(
            """
            UPDATE auth_tokens SET used_at = now()
            WHERE token_hash = :hash AND purpose = :purpose AND used_at IS NULL AND expires_at > now()
            RETURNING id
            """
        ),
        {"hash": token_hash(token), "purpose": purpose},
    ).first()
    return db.get(AuthToken, row.id) if row else None


def issue_email_token(db: Session, purpose: str, email: str, account: Account | None) -> str:
    token = new_token()
    db.add(
        AuthToken(
            purpose=purpose,
            token_hash=token_hash(token),
            email=email,
            account_id=account.id if account else None,
            expires_at=utcnow() + timedelta(minutes=get_settings().email_token_minutes),
        )
    )
    return token


# --- Email and password -----------------------------------------------------


@router.post("/sign-in", response_model=SignInOut, response_model_exclude_none=True)
def sign_in(body: SignInIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.lower()
    ip = client_ip(request)
    rate_limit(db, f"sign-in:ip:{ip}", 30, 900)
    rate_limit(db, f"sign-in:email:{email}", 10, 900)
    account = account_by_email(db, email)
    # verify_password runs even without an account, so timing doesn't reveal which emails exist.
    if not verify_password(account.password_hash if account else None, body.password) or account is None:
        raise ApiError(401, "invalid_credentials", "The email or password is incorrect.")
    needs_code = finish_first_factor(db, request, response, account, "/stores")
    db.commit()
    if needs_code:
        return SignInOut(status="two_factor_required")
    return SignInOut(status="signed_in", account=account_out(db, account))


@router.post("/two-factor")
def two_factor(body: CodeIn, request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get(CHALLENGE_COOKIE)
    challenge = (
        db.scalar(select(TwoFactorChallenge).where(TwoFactorChallenge.token_hash == token_hash(raw)).with_for_update())
        if raw
        else None
    )
    if challenge is None or challenge.expires_at <= utcnow() or challenge.attempts >= 5:
        clear_challenge_cookie(response)
        raise unauthenticated("Your sign-in expired. Sign in again.")
    challenge.attempts += 1
    db.commit()
    account = db.get(Account, challenge.account_id)
    if account is None or not verify_second_factor(db, account, body.code):
        db.commit()
        raise ApiError(401, "invalid_code", "That code didn’t work. Try again.")
    db.delete(challenge)
    start_session(db, request, response, account)
    db.commit()
    clear_challenge_cookie(response)
    return account_out(db, account)


def verify_second_factor(db: Session, account: Account, code: str) -> bool:
    """An authenticator code, or an unused recovery code. Each code works once."""
    if looks_like_recovery_code(code):
        for row in db.scalars(
            select(RecoveryCode).where(RecoveryCode.account_id == account.id, RecoveryCode.used_at.is_(None)).with_for_update()
        ):
            if verify_recovery_code(row.code_hash, code):
                row.used_at = utcnow()
                return True
        return False
    if not account.totp_enabled or not account.totp_secret_encrypted:
        return False
    step = match_totp(decrypt_secret(account.totp_secret_encrypted), code, account.totp_last_step)
    if step is None:
        return False
    account.totp_last_step = step
    return True


@router.post("/signup", status_code=204)
def request_signup(
    body: EmailIn,
    request: Request,
    tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    sender: EmailSender = Depends(get_email_sender),
):
    email = body.email.lower()
    rate_limit(db, f"email:ip:{client_ip(request)}", 20, 3600)
    rate_limit(db, f"email:to:{email}", 3, 3600)
    settings = get_settings()
    account = account_by_email(db, email)
    # Same response either way, so the form doesn't reveal which emails have accounts.
    if account:
        message = emails.account_exists(email, f"{settings.app_base_url}/login", f"{settings.app_base_url}/forgot-password")
    else:
        token = issue_email_token(db, "verify_email", email, None)
        message = emails.verify_email(email, f"{settings.app_base_url}/verify-email?token={token}", settings.email_token_minutes)
    db.commit()
    tasks.add_task(emails.deliver_in_background, sender, message)


@router.post("/signup/complete")
def complete_signup(body: CompleteSignupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    check_password(body.password)
    token = consume_email_token(db, body.token, "verify_email")
    if token is None:
        raise INVALID_LINK
    if account_by_email(db, token.email):
        db.commit()
        raise ApiError(409, "conflict", "An account already uses this email. Sign in instead.")
    account = Account(
        email=token.email,
        name=body.name.strip() or None,
        email_verified=True,
        password_hash=hash_password(body.password),
    )
    db.add(account)
    db.flush()
    start_session(db, request, response, account)
    db.commit()
    return account_out(db, account)


@router.post("/password-reset", status_code=204)
def request_password_reset(
    body: EmailIn,
    request: Request,
    tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    sender: EmailSender = Depends(get_email_sender),
):
    email = body.email.lower()
    rate_limit(db, f"email:ip:{client_ip(request)}", 20, 3600)
    rate_limit(db, f"email:to:{email}", 3, 3600)
    account = account_by_email(db, email)
    if account:
        settings = get_settings()
        token = issue_email_token(db, "reset_password", email, account)
        tasks.add_task(
            emails.deliver_in_background,
            sender,
            emails.reset_password(email, f"{settings.app_base_url}/reset-password?token={token}", settings.email_token_minutes),
        )
    db.commit()


@router.post("/password-reset/complete", status_code=204)
def complete_password_reset(body: ResetPasswordIn, response: Response, db: Session = Depends(get_db)):
    check_password(body.password)
    token = consume_email_token(db, body.token, "reset_password")
    account = db.get(Account, token.account_id) if token and token.account_id else None
    if account is None:
        db.commit()
        raise INVALID_LINK
    account.password_hash = hash_password(body.password)
    account.email_verified = True
    # A reset signs out every device. Two-factor authentication stays on.
    revoke_all_sessions(db, account.id)
    db.commit()
    clear_session_cookies(response)


@router.post("/sign-out", status_code=204)
def sign_out(request: Request, response: Response, auth: Auth | None = Depends(optional_auth), db: Session = Depends(get_db)):
    session = auth.session if auth else None
    if session is None and request.cookies.get(REFRESH_COOKIE):
        session = db.scalar(select(UserSession).where(UserSession.refresh_hash == token_hash(request.cookies[REFRESH_COOKIE])))
    if session is not None and session.revoked_at is None:
        session.revoked_at = utcnow()
    db.commit()
    clear_session_cookies(response)


@router.post("/refresh", status_code=204)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    """Rotates the renewal token. A replayed old token revokes the session."""
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise unauthenticated()
    presented = token_hash(raw)
    session = db.scalar(select(UserSession).where(UserSession.refresh_hash == presented).with_for_update())
    if session is not None:
        if active_session(db, session.id) is None:
            clear_session_cookies(response)
            raise unauthenticated()
        fresh = new_token()
        session.previous_refresh_hash = presented
        session.refresh_hash = token_hash(fresh)
        session.rotated_at = utcnow()
        session.expires_at = utcnow() + timedelta(days=get_settings().session_days)
        db.commit()
        set_session_cookies(response, session.account_id, session.id, fresh)
        return
    old = db.scalar(select(UserSession).where(UserSession.previous_refresh_hash == presented).with_for_update())
    if old is not None and old.revoked_at is None:
        grace = timedelta(seconds=get_settings().refresh_grace_seconds)
        if old.rotated_at and utcnow() - old.rotated_at <= grace and active_session(db, old.id):
            # Another tab renewed a moment ago. The browser already holds the new renewal
            # token, so only a new access token is needed here.
            set_session_cookies(response, old.account_id, old.id, None)
            return
        old.revoked_at = utcnow()  # Replay of a used renewal token.
        db.commit()
    clear_session_cookies(response)
    raise unauthenticated()


# --- Google -----------------------------------------------------------------


def _redirect(path: str, **params: str) -> RedirectResponse:
    query = f"?{urlencode(params)}" if params else ""
    return RedirectResponse(f"{get_settings().app_base_url}{path}{query}", status_code=303)


@router.get("/google/start")
def google_start(
    intent: str = "sign_in",
    return_to: str | None = None,
    auth: Auth | None = Depends(optional_auth),
    db: Session = Depends(get_db),
    google: GoogleClient = Depends(get_google_client),
):
    if intent not in ("sign_in", "link"):
        intent = "sign_in"
    if intent == "link":
        # Linking needs a signed-in account with a recent sign-in.
        if auth is None:
            return _redirect("/login", notice="sign_in_to_link")
        if utcnow() - auth.session.authenticated_at > timedelta(minutes=get_settings().recent_auth_minutes):
            return _redirect("/account", google="reauthentication_required")
    state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    db.execute(delete(OAuthState).where(OAuthState.expires_at < func.now()))
    db.add(
        OAuthState(
            state_hash=token_hash(state),
            nonce=nonce,
            code_verifier=verifier,
            intent=intent,
            return_to=safe_return_to(return_to, "/account" if intent == "link" else "/stores"),
            account_id=auth.account.id if intent == "link" and auth else None,
            session_id=auth.session.id if intent == "link" and auth else None,
            expires_at=utcnow() + timedelta(minutes=get_settings().oauth_state_minutes),
        )
    )
    url = google.authorization_url(state, nonce, verifier)
    db.commit()
    return RedirectResponse(url, status_code=303)


@router.get("/google/callback")
def google_callback(
    request: Request,
    state: str = "",
    code: str = "",
    error: str = "",
    db: Session = Depends(get_db),
    google: GoogleClient = Depends(get_google_client),
):
    row = (
        db.execute(
            text("DELETE FROM oauth_states WHERE state_hash = :hash AND expires_at > now() RETURNING *"),
            {"hash": token_hash(state)},
        ).first()
        if state
        else None
    )
    db.commit()
    if row is None:
        return _redirect("/login", notice="google_failed")
    linking = row.intent == "link"
    if error or not code:
        return _redirect("/account", google="cancelled") if linking else _redirect("/login", notice="google_cancelled")
    try:
        user = google.exchange(code, row.code_verifier, row.nonce)
    except Exception:
        return _redirect("/account", google="failed") if linking else _redirect("/login", notice="google_failed")

    identity = db.scalar(select(AuthIdentity).where(AuthIdentity.provider == "google", AuthIdentity.subject == user.subject))

    if linking:
        session = active_session(db, row.session_id) if row.session_id else None
        if session is None or session.account_id != row.account_id:
            return _redirect("/login", notice="sign_in_to_link")
        if identity is not None:
            if identity.account_id != row.account_id:
                return _redirect(row.return_to, google="already_linked")
            return _redirect(row.return_to, google="linked")
        db.add(AuthIdentity(account_id=row.account_id, provider="google", subject=user.subject, email=user.email))
        db.commit()
        return _redirect(row.return_to, google="linked")

    if identity is not None:
        account = db.get(Account, identity.account_id)
    else:
        if not user.email or not user.email_verified:
            return _redirect("/login", notice="google_email_unverified")
        existing = account_by_email(db, user.email)
        if existing is not None:
            # The email already has an account. Linking needs proof of ownership:
            # sign in to that account first, then link Google from Settings.
            return _redirect("/login", notice="google_account_exists")
        account = Account(email=user.email, name=user.name, email_verified=True)
        db.add(account)
        db.flush()
        db.add(AuthIdentity(account_id=account.id, provider="google", subject=user.subject, email=user.email))
    assert account is not None
    response = _redirect("/two-factor") if account.totp_enabled else _redirect(row.return_to)
    finish_first_factor(db, request, response, account, row.return_to)
    db.commit()
    return response
