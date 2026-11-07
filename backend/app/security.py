"""Password hashing, one-time tokens, access tokens, and authenticator codes."""

import hashlib
import hmac
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet

from .config import get_settings

_hasher = PasswordHasher()  # Argon2id with the library's recommended parameters.
# Verifying against this hash keeps the timing the same when no account exists.
_DUMMY_HASH = _hasher.hash("timing-equaliser-password")


def utcnow() -> datetime:
    return datetime.now(UTC)


# --- Passwords --------------------------------------------------------------

MIN_PASSWORD = 8
MAX_PASSWORD = 128


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# --- Random tokens ----------------------------------------------------------


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """Tokens are high-entropy, so SHA-256 is enough. Only the hash is stored."""
    return hashlib.sha256(token.encode()).hexdigest()


# --- Access tokens (PyJWT) --------------------------------------------------


def create_access_token(account_id: uuid.UUID, session_id: uuid.UUID) -> str:
    settings = get_settings()
    now = utcnow()
    claims = {
        "sub": str(account_id),
        "sid": str(session_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
        "typ": "access",
    }
    return jwt.encode(claims, settings.jwt_signing_key, algorithm="HS256")


def decode_access_token(token: str) -> dict | None:
    try:
        claims = jwt.decode(
            token, get_settings().jwt_signing_key, algorithms=["HS256"], options={"require": ["exp", "sub", "sid"]}
        )
    except jwt.PyJWTError:
        return None
    return claims if claims.get("typ") == "access" else None


# --- Authenticator apps (PyOTP + Fernet) ------------------------------------


def _fernet() -> Fernet:
    return Fernet(get_settings().totp_encryption_key.encode())


def new_totp_secret() -> str:
    return pyotp.random_base32(length=32)


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode()).decode()


def provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="The Catalogue")


def match_totp(secret: str, code: str, last_step: int | None, now: float | None = None) -> int | None:
    """
    Returns the 30-second step that the code matches, or None.
    Accepts one step of clock drift. Rejects a step at or before `last_step`, so an
    accepted code can't be used again.
    """
    code = code.strip().replace(" ", "")
    if not (len(code) == 6 and code.isdigit()):
        return None
    totp = pyotp.TOTP(secret)
    current = int((now if now is not None else time.time()) // totp.interval)
    for step in (current - 1, current, current + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(totp.generate_otp(step), code):
            return step
    return None


# --- Recovery codes ---------------------------------------------------------

_RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def new_recovery_code() -> str:
    raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


def normalise_recovery_code(code: str) -> str:
    return code.strip().lower().replace(" ", "")


def hash_recovery_code(code: str) -> str:
    return _hasher.hash(normalise_recovery_code(code))


def verify_recovery_code(code_hash: str, code: str) -> bool:
    try:
        return _hasher.verify(code_hash, normalise_recovery_code(code))
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def looks_like_recovery_code(code: str) -> bool:
    value = normalise_recovery_code(code)
    return len(value) == 11 and value[5] == "-"
