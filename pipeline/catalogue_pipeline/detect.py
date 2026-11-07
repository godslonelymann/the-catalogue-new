"""Reads Shopify clues: the fixed shop name (x.myshopify.com), the currency, and the store's display name."""

import html
import json
import re
from dataclasses import dataclass

from .urls import SHOP_DOMAIN, is_shop_domain

SHOP_MARKER = re.compile(r"""\bShopify\.shop\s*=\s*["'](""" + SHOP_DOMAIN.pattern + r""")["']""")
CURRENCY_MARKER = re.compile(r"""\bShopify\.currency\s*=\s*\{[^}]*?["']active["']\s*:\s*["']([A-Z]{3})["']""")
SITE_NAME = re.compile(r"""<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,200})["']""", re.IGNORECASE)
CURRENCY_CODE = re.compile(r"[A-Z]{3}")


@dataclass(frozen=True)
class PageSignals:
    shop_domain: str | None
    currency: str | None
    name: str | None
    has_routes: bool
    has_cdn: bool

    @property
    def looks_like_shopify(self) -> bool:
        return self.shop_domain is not None or (self.has_routes and self.has_cdn)


def clean_label(value: object, limit: int = 120) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(html.unescape(value).split())
    text = "".join(char for char in text if char.isprintable())[:limit].strip()
    return text or None


def read_homepage(visited_hosts: list[str], body: bytes) -> PageSignals:
    page = body.decode("utf-8", errors="replace")
    shop = next((host for host in visited_hosts if is_shop_domain(host)), None)
    if shop is None and (match := SHOP_MARKER.search(page)):
        shop = match.group(1)
    currency = match.group(1) if (match := CURRENCY_MARKER.search(page)) else None
    name = clean_label(match.group(1)) if (match := SITE_NAME.search(page)) else None
    return PageSignals(shop, currency, name, "Shopify.routes" in page, "cdn.shopify.com/" in page)


@dataclass(frozen=True)
class ShopMeta:
    shop_domain: str | None
    currency: str | None
    name: str | None


def read_meta(body: bytes) -> ShopMeta:
    """Shopify serves /meta.json with `myshopify_domain`, `currency`, and `name`. Bad data gives an empty result."""
    try:
        data = json.loads(body)
    except (ValueError, RecursionError):
        return ShopMeta(None, None, None)
    if not isinstance(data, dict):
        return ShopMeta(None, None, None)
    shop = data.get("myshopify_domain")
    shop = shop.lower() if isinstance(shop, str) and is_shop_domain(shop.lower()) else None
    currency = data.get("currency")
    currency = currency if isinstance(currency, str) and CURRENCY_CODE.fullmatch(currency) else None
    return ShopMeta(shop, currency, clean_label(data.get("name")))
