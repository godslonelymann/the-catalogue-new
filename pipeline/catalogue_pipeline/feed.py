"""Reads /products.json page by page and checks every page."""

import json
from decimal import Decimal, InvalidOperation

from .net import Fetcher
from .result import CheckFailed, Reason
from .urls import parse_url

PAGE_SIZE = 250
MAX_PAGES = 100  # 25,000 products
MAX_PAGE_BYTES = 16 * 1024 * 1024
MAX_PRICE = Decimal(100_000_000)


def positive_id(value: object) -> bool:
    return type(value) is int and value > 0


def valid_price(value: object, required: bool) -> bool:
    if value is None or value == "":
        return not required
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return False
    try:
        amount = Decimal(str(value))
    except InvalidOperation:
        return False
    return amount.is_finite() and 0 <= amount < MAX_PRICE


def valid_variant(variant: object) -> bool:
    return (
        isinstance(variant, dict)
        and positive_id(variant.get("id"))
        and type(variant.get("available")) is bool
        and valid_price(variant.get("price"), required=True)
        and valid_price(variant.get("compare_at_price"), required=False)
    )


def valid_product(product: object) -> bool:
    if not isinstance(product, dict) or not positive_id(product.get("id")):
        return False
    if not isinstance(product.get("handle"), str) or not product["handle"]:
        return False
    variants = product.get("variants")
    return isinstance(variants, list) and bool(variants) and all(map(valid_variant, variants))


def parse_page(body: bytes) -> list[dict]:
    try:
        payload = json.loads(body)
    except (ValueError, RecursionError) as error:
        raise CheckFailed(Reason.FEED_INVALID, "The store’s product list is not valid JSON.") from error
    products = payload.get("products") if isinstance(payload, dict) else None
    if not isinstance(products, list):
        raise CheckFailed(Reason.FEED_INVALID, "The store’s product list has no products.")
    if not all(map(valid_product, products)):
        raise CheckFailed(Reason.FEED_INVALID)
    return products


def fetch_page(fetcher: Fetcher, host: str, page: int, limit: int = PAGE_SIZE) -> list[dict]:
    url = parse_url(f"https://{host}/products.json?limit={limit}&page={page}")
    response = fetcher.get(url, accept="application/json", max_bytes=MAX_PAGE_BYTES)
    if response.final.hostname != host:
        raise CheckFailed(Reason.REDIRECT_ELSEWHERE)
    if response.status in (500, 502, 503, 504, 408):
        raise CheckFailed(Reason.SERVER_BUSY)
    if response.status != 200:
        raise CheckFailed(
            Reason.FEED_UNREADABLE, f"Page {page} of the store’s product list did not load (HTTP {response.status})."
        )
    return parse_page(response.body)


def read_all_pages(fetcher: Fetcher, host: str, max_pages: int = MAX_PAGES) -> tuple[list[dict], int]:
    """Reads pages until one comes back empty. Every page must load. Repeated products are kept once."""
    products: dict[int, dict] = {}
    for page in range(1, max_pages + 2):
        batch = fetch_page(fetcher, host, page)
        if not batch:
            if not products:
                raise CheckFailed(Reason.FEED_EMPTY)
            return list(products.values()), page - 1
        if page > max_pages:
            break
        for product in batch:
            products.setdefault(product["id"], product)
    raise CheckFailed(Reason.CATALOGUE_TOO_LARGE)
