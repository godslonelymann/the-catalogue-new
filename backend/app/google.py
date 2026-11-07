"""Google OpenID Connect with Authlib (PKCE, state, nonce) and ID-token checks with PyJWT."""

from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

import httpx
import jwt
from authlib.integrations.httpx_client import OAuth2Client

from .config import get_settings
from .errors import ApiError

DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")


@dataclass
class GoogleUser:
    subject: str
    email: str | None
    email_verified: bool
    name: str | None


class GoogleClient(Protocol):
    def authorization_url(self, state: str, nonce: str, code_verifier: str) -> str: ...
    def exchange(self, code: str, code_verifier: str, nonce: str) -> GoogleUser: ...


class AuthlibGoogleClient:
    def __init__(self) -> None:
        self._metadata: dict | None = None
        self._jwks: jwt.PyJWKClient | None = None

    def _settings(self):
        settings = get_settings()
        if not settings.google_client_id or not settings.google_client_secret:
            raise ApiError(503, "unknown", "Google sign-in isn’t set up on this server.")
        return settings

    def _client(self) -> OAuth2Client:
        settings = self._settings()
        return OAuth2Client(
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
            scope="openid email profile",
            redirect_uri=settings.google_redirect_uri,
            code_challenge_method="S256",
            timeout=10,
        )

    def metadata(self) -> dict:
        if self._metadata is None:
            response = httpx.get(DISCOVERY_URL, timeout=10)
            response.raise_for_status()
            self._metadata = response.json()
        return self._metadata

    def authorization_url(self, state: str, nonce: str, code_verifier: str) -> str:
        with self._client() as client:
            url, _ = client.create_authorization_url(
                self.metadata()["authorization_endpoint"],
                state=state,
                nonce=nonce,
                code_verifier=code_verifier,
                prompt="select_account",
            )
        return url

    def exchange(self, code: str, code_verifier: str, nonce: str) -> GoogleUser:
        settings = self._settings()
        with self._client() as client:
            token = client.fetch_token(self.metadata()["token_endpoint"], code=code, code_verifier=code_verifier)
        id_token = token.get("id_token")
        if not id_token:
            raise ApiError(502, "unknown", "Google didn’t return an ID token.")
        if self._jwks is None:
            self._jwks = jwt.PyJWKClient(self.metadata()["jwks_uri"], cache_keys=True)
        key = self._jwks.get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            key.key,
            algorithms=["RS256"],
            audience=settings.google_client_id,
            issuer=list(ISSUERS),
            leeway=60,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
        if claims.get("nonce") != nonce:
            raise ApiError(400, "invalid_token", "The Google sign-in response didn’t match. Try again.")
        return GoogleUser(
            subject=str(claims["sub"]),
            email=(claims.get("email") or "").lower() or None,
            email_verified=bool(claims.get("email_verified")),
            name=claims.get("name"),
        )


@lru_cache
def _default_client() -> AuthlibGoogleClient:
    return AuthlibGoogleClient()


def get_google_client() -> GoogleClient:
    return _default_client()
