from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    """An error with a stable code for the frontend: {"detail": {"code", "message"}}."""

    def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None):
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers


def unauthenticated(message: str = "Sign in to continue.") -> ApiError:
    return ApiError(401, "unauthenticated", message)


def not_found() -> ApiError:
    return ApiError(404, "not_found", "We couldn’t find that.")


def reauthentication_required() -> ApiError:
    return ApiError(403, "reauthentication_required", "For your security, sign in again to make this change.")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            {"detail": {"code": error.code, "message": error.message}}, status_code=error.status, headers=error.headers
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, error: RequestValidationError) -> JSONResponse:
        first = error.errors()[0] if error.errors() else {}
        field = ".".join(str(part) for part in first.get("loc", [])[1:])
        message = "Enter a valid email address." if field == "email" else "Check the form and try again."
        return JSONResponse({"detail": {"code": "invalid_request", "message": message}}, status_code=422)
