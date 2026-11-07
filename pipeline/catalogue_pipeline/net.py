"""
Safe HTTPS requests to storefronts.

Safety limits (keep these):
- Only public IP addresses. The checked address is the one we connect to, so DNS can't switch it.
- A time limit on the DNS lookup, on each request, and on the whole check.
- A size limit on every response, and a limit on redirects.

Politeness:
- A minimum wait between two requests to the same host.
- A "slow down" (429) reply pauses that host for the time the store asks, up to a limit.
"""

import http.client
import ipaddress
import socket
import ssl
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Protocol
from urllib.parse import SplitResult, urljoin

from .result import CheckFailed, Reason
from .urls import parse_url

USER_AGENT = "The-Catalogue-Store-Check/2.0"
MAX_REDIRECTS = 4
REDIRECTS = frozenset({301, 302, 303, 307, 308})
DNS_TIMEOUT = 5.0
REQUEST_TIMEOUT = 10.0

_dns_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="dns")


# --- Transport ----------------------------------------------------------------


@dataclass(frozen=True)
class RawResponse:
    status: int
    headers: dict[str, str]
    body: bytes


class Transport(Protocol):
    def request(self, host: str, target: str, headers: dict[str, str], timeout: float, max_bytes: int) -> RawResponse:
        """Sends one GET. Reads at most max_bytes + 1 of the body, and only for HTTP 200."""
        ...


def resolve_public(host: str, timeout: float = DNS_TIMEOUT) -> str:
    """Looks up the host within `timeout` seconds. Every address must be public."""
    future = _dns_pool.submit(socket.getaddrinfo, host, 443, type=socket.SOCK_STREAM)
    try:
        records = future.result(timeout=timeout)
    except FutureTimeout as error:
        raise CheckFailed(Reason.TIMEOUT, "The store’s address lookup took too long. Try again later.") from error
    except OSError as error:
        raise CheckFailed(Reason.UNREACHABLE) from error
    addresses = [ipaddress.ip_address(record[4][0]) for record in records]
    if not addresses or any(not a.is_global or a.is_multicast or a.is_reserved for a in addresses):
        raise CheckFailed(Reason.PRIVATE_ADDRESS)
    return str(next((a for a in addresses if a.version == 4), addresses[0]))


class _PublicHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, address: str, timeout: float):
        super().__init__(host, 443, timeout=timeout)
        self._address = address

    def connect(self) -> None:
        # Connect to the checked IP. TLS still checks the certificate against the hostname.
        sock = socket.create_connection((self._address, self.port), self.timeout)
        try:
            self.sock = ssl.create_default_context().wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


class SocketTransport:
    """The real network. Tests use a fake transport instead."""

    def request(self, host: str, target: str, headers: dict[str, str], timeout: float, max_bytes: int) -> RawResponse:
        address = resolve_public(host, min(DNS_TIMEOUT, timeout))
        connection = _PublicHTTPSConnection(host, address, timeout)
        try:
            connection.request("GET", target, headers=headers)
            with connection.getresponse() as response:
                body = response.read(max_bytes + 1) if response.status == 200 else b""
                return RawResponse(response.status, {k.lower(): v for k, v in response.getheaders()}, body)
        except ssl.SSLError as error:
            raise CheckFailed(Reason.TLS_FAILED) from error
        except TimeoutError as error:
            raise CheckFailed(Reason.TIMEOUT) from error
        except (OSError, http.client.HTTPException) as error:
            raise CheckFailed(Reason.UNREACHABLE) from error
        finally:
            connection.close()


# --- Politeness -----------------------------------------------------------------


class HostPacer:
    """Keeps a minimum gap between requests to one host. Shared by every check in the process."""

    def __init__(
        self, interval: float = 1.0, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep
    ):
        self.interval = interval
        self._clock = clock
        self._sleep = sleep
        self._next: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, host: str) -> None:
        with self._lock:
            now = self._clock()
            start = max(now, self._next.get(host, 0.0))
            self._next[host] = start + self.interval
            # Forget hosts that have been quiet for a while, so the dict stays small.
            if len(self._next) > 1000:
                self._next = {h: t for h, t in self._next.items() if t > now}
        if start > now:
            self._sleep(start - now)

    def pause(self, host: str, seconds: float) -> None:
        with self._lock:
            self._next[host] = max(self._next.get(host, 0.0), self._clock() + seconds)


shared_pacer = HostPacer()


# --- Fetcher --------------------------------------------------------------------


@dataclass(frozen=True)
class Response:
    chain: list[SplitResult]
    status: int
    headers: dict[str, str]
    body: bytes

    @property
    def final(self) -> SplitResult:
        return self.chain[-1]


def retry_after_seconds(value: str | None, now: float, default: float = 5.0) -> float:
    if not value:
        return default
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        return max(0.0, parsedate_to_datetime(value).timestamp() - now)
    except (TypeError, ValueError):
        return default


@dataclass
class Fetcher:
    """One check's requests. The deadline covers the whole check, not one request."""

    transport: Transport = field(default_factory=SocketTransport)
    pacer: HostPacer = field(default_factory=lambda: shared_pacer)
    deadline_seconds: float = 60.0
    request_timeout: float = REQUEST_TIMEOUT
    max_retry_after: float = 30.0
    rate_limit_retries: int = 2
    clock: Callable[[], float] = time.monotonic
    wall_clock: Callable[[], float] = time.time
    _deadline: float = field(init=False)

    def __post_init__(self) -> None:
        self._deadline = self.clock() + self.deadline_seconds

    def remaining(self) -> float:
        return self._deadline - self.clock()

    def get(self, url: SplitResult, *, accept: str, max_bytes: int, allow_truncated: bool = False) -> Response:
        chain: list[SplitResult] = []
        for _ in range(MAX_REDIRECTS + 1):
            if url in chain:
                raise CheckFailed(Reason.TOO_MANY_REDIRECTS)
            chain.append(url)
            raw = self._send(url, accept, max_bytes)
            location = raw.headers.get("location")
            if raw.status in REDIRECTS and location:
                url = parse_url(urljoin(url.geturl(), location))
                continue
            body = raw.body
            if len(body) > max_bytes:
                if not allow_truncated:
                    raise CheckFailed(Reason.RESPONSE_TOO_LARGE)
                body = body[:max_bytes]
            return Response(chain, raw.status, raw.headers, body)
        raise CheckFailed(Reason.TOO_MANY_REDIRECTS)

    def _send(self, url: SplitResult, accept: str, max_bytes: int) -> RawResponse:
        target = (url.path or "/") + (f"?{url.query}" if url.query else "")
        headers = {"Accept": accept, "Accept-Encoding": "identity", "User-Agent": USER_AGENT}
        for attempt in range(self.rate_limit_retries + 1):
            self.pacer.wait(url.hostname)
            timeout = min(self.request_timeout, self.remaining())
            if timeout <= 0:
                raise CheckFailed(Reason.TIMEOUT)
            raw = self.transport.request(url.hostname, target, headers, timeout, max_bytes)
            if raw.status != 429:
                return raw
            wait = retry_after_seconds(raw.headers.get("retry-after"), self.wall_clock())
            self.pacer.pause(url.hostname, wait)
            if attempt == self.rate_limit_retries or wait > self.max_retry_after or wait >= self.remaining():
                break
        raise CheckFailed(Reason.RATE_LIMITED)
