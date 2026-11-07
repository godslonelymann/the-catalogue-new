"""Signed-in account routes: profile, sessions, password, and two-factor authentication."""

import re
import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiError, not_found
from ..models import Account, AuthIdentity, RecoveryCode, UserSession
from ..schemas import AccountOut, ChangePasswordIn, CodeIn, RecoveryCodesOut, SessionOut, TwoFactorSetupOut
from ..security import (
    MAX_PASSWORD,
    MIN_PASSWORD,
    decrypt_secret,
    encrypt_secret,
    hash_password,
    hash_recovery_code,
    match_totp,
    new_recovery_code,
    new_totp_secret,
    provisioning_uri,
    utcnow,
    verify_password,
)
from ..sessions import Auth, clear_session_cookies, rate_limit, require_auth, revoke_all_sessions

router = APIRouter(prefix="/api", tags=["account"])

RECOVERY_CODE_COUNT = 10


def account_out(db: Session, account: Account) -> AccountOut:
    google = db.scalar(
        select(func.count())
        .select_from(AuthIdentity)
        .where(AuthIdentity.account_id == account.id, AuthIdentity.provider == "google")
    )
    codes = db.scalar(
        select(func.count())
        .select_from(RecoveryCode)
        .where(RecoveryCode.account_id == account.id, RecoveryCode.used_at.is_(None))
    )
    return AccountOut(
        id=str(account.id),
        email=account.email,
        name=account.name,
        email_verified=account.email_verified,
        has_password=account.password_hash is not None,
        google_linked=bool(google),
        two_factor_enabled=account.totp_enabled,
        recovery_codes_left=(codes or 0) if account.totp_enabled else 0,
    )


@router.get("/me", response_model=AccountOut)
def me(auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    return account_out(db, auth.account)


# --- Sessions ---------------------------------------------------------------


def describe_device(user_agent: str | None) -> str:
    ua = user_agent or ""
    browser = next(
        (
            name
            for pattern, name in [
                (r"Edg/", "Edge"),
                (r"OPR/", "Opera"),
                (r"Firefox/", "Firefox"),
                (r"Chrome/", "Chrome"),
                (r"Safari/", "Safari"),
            ]
            if re.search(pattern, ua)
        ),
        "Browser",
    )
    system = next(
        (
            name
            for pattern, name in [
                (r"iPhone", "iPhone"),
                (r"iPad", "iPad"),
                (r"Android", "Android"),
                (r"Mac OS X|Macintosh", "Mac"),
                (r"Windows", "Windows"),
                (r"Linux", "Linux"),
            ]
            if re.search(pattern, ua)
        ),
        "Unknown device",
    )
    return f"{system} · {browser}"


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(UserSession)
        .where(UserSession.account_id == auth.account.id, UserSession.revoked_at.is_(None), UserSession.expires_at > func.now())
        .order_by(UserSession.last_seen_at.desc())
    )
    return [
        SessionOut(
            id=str(row.id),
            device=describe_device(row.user_agent),
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            current=row.id == auth.session.id,
        )
        for row in rows
    ]


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(session_id: uuid.UUID, response: Response, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    session = db.get(UserSession, session_id)
    # 404 for another account's session, so the route doesn't reveal it exists.
    if session is None or session.account_id != auth.account.id or session.revoked_at is not None:
        raise not_found()
    session.revoked_at = utcnow()
    db.commit()
    if session.id == auth.session.id:
        clear_session_cookies(response)


@router.delete("/sessions", status_code=204)
def revoke_all(response: Response, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    revoke_all_sessions(db, auth.account.id)
    db.commit()
    clear_session_cookies(response)


# --- Password ---------------------------------------------------------------


@router.post("/account/password", status_code=204)
def change_password(
    body: ChangePasswordIn, response: Response, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)
):
    account = auth.account
    if account.password_hash:
        rate_limit(db, f"password-change:{account.id}", 10, 900)
        if not verify_password(account.password_hash, body.current):
            raise ApiError(401, "invalid_credentials", "Your current password is incorrect.")
    else:
        # A Google-only account adds a password after a recent sign-in.
        auth.require_recent()
    if not (MIN_PASSWORD <= len(body.next) <= MAX_PASSWORD):
        raise ApiError(422, "invalid_request", f"Use {MIN_PASSWORD} to {MAX_PASSWORD} characters.")
    account.password_hash = hash_password(body.next)
    # Every session ends after a password change, including this one.
    revoke_all_sessions(db, account.id)
    db.commit()
    clear_session_cookies(response)


# --- Two-factor authentication ----------------------------------------------


@router.post("/account/two-factor/setup", response_model=TwoFactorSetupOut)
def start_two_factor(auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    auth.require_recent()
    if auth.account.totp_enabled:
        raise ApiError(409, "conflict", "Two-factor authentication is already on.")
    secret = new_totp_secret()
    auth.account.totp_pending_encrypted = encrypt_secret(secret)
    db.commit()
    return TwoFactorSetupOut(secret=secret, otpauth_url=provisioning_uri(secret, auth.account.email))


@router.post("/account/two-factor/confirm", response_model=RecoveryCodesOut)
def confirm_two_factor(body: CodeIn, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    auth.require_recent()
    account = auth.account
    rate_limit(db, f"two-factor-setup:{account.id}", 10, 900)
    if not account.totp_pending_encrypted:
        raise ApiError(409, "conflict", "Start the setup again.")
    secret = decrypt_secret(account.totp_pending_encrypted)
    step = match_totp(secret, body.code, None)
    if step is None:
        raise ApiError(401, "invalid_code", "Enter the 6-digit code from your app.")
    codes = [new_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]
    db.execute(delete(RecoveryCode).where(RecoveryCode.account_id == account.id))
    db.add_all(RecoveryCode(account_id=account.id, code_hash=hash_recovery_code(code)) for code in codes)
    account.totp_secret_encrypted = account.totp_pending_encrypted
    account.totp_pending_encrypted = None
    account.totp_enabled = True
    account.totp_last_step = step
    db.commit()
    # Shown once. Only hashes are stored.
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/account/two-factor/disable", status_code=204)
def disable_two_factor(body: CodeIn, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    from .auth import verify_second_factor

    account = auth.account
    rate_limit(db, f"two-factor-disable:{account.id}", 10, 900)
    if not account.totp_enabled:
        raise ApiError(409, "conflict", "Two-factor authentication is already off.")
    if not verify_second_factor(db, account, body.code):
        db.commit()
        raise ApiError(401, "invalid_code", "That code didn’t work. Try again.")
    account.totp_enabled = False
    account.totp_secret_encrypted = None
    account.totp_last_step = None
    db.execute(delete(RecoveryCode).where(RecoveryCode.account_id == account.id))
    db.commit()
