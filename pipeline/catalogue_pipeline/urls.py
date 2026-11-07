"""Storefront address rules. These run before any network request."""

import ipaddress
import re
from urllib.parse import SplitResult, urlsplit

from .result import CheckFailed, Reason

DOMAIN = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?")
SHOP_DOMAIN = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com")
PRODUCT_PATH = re.compile(r"(?:^|/)products/[^/]+")

# Two-label public suffixes we see on storefronts. A brand key keeps one label more than these.
# This is a short list, not the full Public Suffix List.
TWO_LABEL_SUFFIXES = frozenset(
    {
        "co.in",
        "net.in",
        "org.in",
        "firm.in",
        "gen.in",
        "ind.in",
        "co.uk",
        "org.uk",
        "me.uk",
        "com.au",
        "net.au",
        "co.nz",
        "com.br",
        "com.mx",
        "co.jp",
        "co.za",
        "com.sg",
        "com.my",
        "com.tr",
        "com.hk",
        "co.id",
        "co.kr",
    }
)


def _invalid(detail: str | None = None) -> CheckFailed:
    return CheckFailed(Reason.INVALID_URL, detail)


def normalise_host(host: str) -> str:
    """Lower case, IDNA (punycode), no trailing dot. Raises CheckFailed for an IP or a bad name."""
    try:
        host = host.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as error:
        raise _invalid() from error
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        pass
    else:
        raise _invalid("Enter a store domain, not an IP address.")
    if len(host) > 253 or not DOMAIN.fullmatch(host) or host == "localhost" or host.endswith(".localhost"):
        raise _invalid()
    return host


def parse_url(value: str) -> SplitResult:
    """Parses any https URL that the pipeline may request, such as a redirect target."""
    if any(ord(char) < 33 or ord(char) == 127 for char in value) or "\\" in value:
        raise _invalid()
    if "://" not in value:
        value = "https://" + value
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise _invalid() from error
    if parsed.scheme == "http":
        raise _invalid("Use the store’s https:// address.")
    if parsed.scheme != "https" or not parsed.hostname or "@" in parsed.netloc:
        raise _invalid()
    if port not in (None, 443):
        raise _invalid("Only the standard HTTPS port is allowed.")
    return parsed._replace(netloc=normalise_host(parsed.hostname), fragment="")


def storefront_homepage(value: str) -> SplitResult:
    """
    The address a person types when they add a store. Only the store's main address counts:
    a product link is refused. Any other path, such as a collection, becomes the home page.
    """
    value = value.strip()
    if not value:
        raise _invalid("Enter the store’s web address.")
    if any(char.isspace() for char in value):
        raise _invalid()
    parsed = parse_url(value)
    if PRODUCT_PATH.search(parsed.path.lower()):
        raise CheckFailed(Reason.PRODUCT_PAGE)
    return parsed._replace(path="/", query="")


def is_shop_domain(host: str) -> bool:
    return bool(SHOP_DOMAIN.fullmatch(host))


def brand_key(host: str) -> str:
    """
    The registrable domain, such as fugazee.com for www.fugazee.com and archive.fugazee.com.
    Storefronts on one registrable domain count as one brand. A myshopify.com host is its own brand.
    """
    if is_shop_domain(host):
        return host
    labels = host.split(".")
    keep = 3 if ".".join(labels[-2:]) in TWO_LABEL_SUFFIXES else 2
    return ".".join(labels[-keep:])
