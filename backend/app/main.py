"""The Catalogue API. Run: uv run uvicorn app.main:app --host 127.0.0.1 --port 8000"""

import hmac
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import get_settings
from .errors import install_error_handlers
from .routes import account, alerts, auth, checks, products, stores, updates, wishlist
from .sessions import CSRF_COOKIE, CSRF_HEADER, new_csrf_token, set_csrf_cookie

logging.basicConfig(level=logging.INFO)

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="The Catalogue API",
        docs_url="/api/docs" if settings.app_env == "development" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.app_env == "development" else None,
    )
    install_error_handlers(app)

    @app.middleware("http")
    async def protect(request: Request, call_next):
        """
        Requests that change data must come from the app's own origin and echo the
        CSRF cookie in the X-CSRF-Token header. Private responses are never cached.
        """
        if request.method in UNSAFE and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin") or ""
            referer = request.headers.get("referer") or ""
            same_origin = origin == settings.allowed_origin or (not origin and referer.startswith(settings.allowed_origin + "/"))
            cookie = request.cookies.get(CSRF_COOKIE, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not same_origin or not cookie or not hmac.compare_digest(cookie, header):
                response = JSONResponse(
                    {"detail": {"code": "csrf_failed", "message": "Refresh the page and try again."}}, status_code=403
                )
                response.headers["Cache-Control"] = "no-store"
                if not cookie:
                    set_csrf_cookie(response, new_csrf_token())
                return response
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            if not request.cookies.get(CSRF_COOKIE):
                set_csrf_cookie(response, new_csrf_token())
        return response

    @app.get("/api/health", include_in_schema=False)
    def health():
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(account.router)
    app.include_router(stores.router)
    app.include_router(products.router)
    app.include_router(checks.router)
    app.include_router(updates.router)
    app.include_router(alerts.router)
    app.include_router(wishlist.router)
    return app


app = create_app()
