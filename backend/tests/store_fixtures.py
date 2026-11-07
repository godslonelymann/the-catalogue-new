"""Shared store fixtures: a fake pipeline (no network) and a signed-in client. Loaded by conftest.py."""

from dataclasses import dataclass, field

import pytest
from catalogue_pipeline import MESSAGES, CatalogueResult, CheckResult, Outcome, Reason, StoreIdentity, storefront_homepage

from app.stores.checker import get_store_checker

FUGAZEE = StoreIdentity("fugazee.myshopify.com", "fugazee.com", "INR", "Fugazee")


def shopify_product(pid: int, available: bool = True, price: str = "1499.00") -> dict:
    return {
        "id": pid,
        "handle": f"tee-{pid}",
        "title": f"Tee {pid}",
        "options": [{"name": "Size", "values": ["S", "M"]}],
        "images": [{"id": 1, "src": "https://cdn.shopify.com/a.jpg"}],
        "variants": [
            {"id": pid * 10 + 1, "title": "S", "option1": "S", "price": price, "available": available},
            {"id": pid * 10 + 2, "title": "M", "option1": "M", "price": "1599.00", "available": False},
        ],
    }


def approved_catalogue(*products: dict) -> CatalogueResult:
    items = list(products) or [shopify_product(1), shopify_product(2)]
    return CatalogueResult(Outcome.APPROVED, None, "ok", items, 1)


def failed(reason: Reason) -> CheckResult:
    outcome = Outcome.RETRY_LATER if reason in (Reason.UNREACHABLE, Reason.RATE_LIMITED) else Outcome.REJECTED
    return CheckResult(outcome, reason, MESSAGES[reason])


@dataclass
class FakeChecker:
    """Shops by the host a person types. A host that isn't listed is not a Shopify store."""

    shops: dict[str, StoreIdentity | CheckResult] = field(default_factory=dict)
    catalogues: dict[str, CatalogueResult] = field(default_factory=dict)
    checks: list[str] = field(default_factory=list)
    reads: list[str] = field(default_factory=list)

    def check(self, url: str) -> CheckResult:
        host = storefront_homepage(url).hostname
        self.checks.append(host)
        found = self.shops.get(host, failed(Reason.NOT_SHOPIFY))
        if isinstance(found, CheckResult):
            return CheckResult(found.outcome, found.reason, found.message, host)
        return CheckResult(Outcome.APPROVED, None, "ok", host, found)

    def recheck(self, identity: StoreIdentity) -> CheckResult:
        return self.check(identity.storefront_url)

    def read(self, identity: StoreIdentity) -> CatalogueResult:
        self.reads.append(identity.shop_domain)
        return self.catalogues.get(identity.shop_domain, approved_catalogue())


@pytest.fixture
def checker(app) -> FakeChecker:
    fake = FakeChecker(shops={"fugazee.com": FUGAZEE, "www.fugazee.com": FUGAZEE})
    app.dependency_overrides[get_store_checker] = lambda: fake
    return fake


@pytest.fixture
def user(client, sender):
    from .conftest import signup  # conftest loads this module, so import here.

    signup(client, sender)
    return client


def add(client, url: str):
    return client.post("/api/stores", json={"url": url})


def error_code(response) -> str:
    return response.json()["detail"]["code"]
