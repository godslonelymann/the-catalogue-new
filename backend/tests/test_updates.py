"""Updates and price history, recorded by refreshes through the fake pipeline."""

from datetime import timedelta

import pytest
from sqlalchemy import text

from app.db import get_engine
from app.jobs.refresh import refresh_all

from .conftest import signup
from .store_fixtures import add, approved_catalogue
from .test_products import tee

SHOP = "fugazee.myshopify.com"


def racer(price: str = "999.00", s: bool = True, m: bool = False, m_price: str | None = None) -> dict:
    product = tee(1, "Racer Tee", price, {("Black", "S"): s, ("Black", "M"): m})
    if m_price:
        product["variants"][1]["price"] = m_price
    return product


def jacket(available: bool = True) -> dict:
    return tee(3, "Field Jacket", "4999.00", {("Black", "XL"): available})


@pytest.fixture
def store_id(user, checker):
    checker.catalogues[SHOP] = approved_catalogue(racer(), jacket())
    return add(user, "fugazee.com").json()["store"]["id"]


def refresh(checker, *products):
    checker.catalogues[SHOP] = approved_catalogue(*products)
    # Each refresh gets its own time, so history points don't share a timestamp.
    with get_engine().begin() as connection:
        for table in ("price_points", "catalogue_updates"):
            connection.execute(text(f"UPDATE {table} SET at = at - :shift"), {"shift": timedelta(hours=1)})
    assert set(refresh_all(checker).values()) == {"ready"}


def updates(client, **params) -> list[dict]:
    response = client.get("/api/updates", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def summary(items) -> list[tuple]:
    return sorted((u["kind"], u["productTitle"], u["variantTitle"], u["oldPrice"], u["newPrice"]) for u in items)


def test_first_import_records_no_updates(user, store_id):
    assert updates(user) == []


def test_same_price_change_on_every_option_is_one_update(user, checker, store_id):
    refresh(checker, racer(price="799.00"), jacket())
    [update] = updates(user)
    assert update == {
        "id": update["id"],
        "kind": "price_drop",
        "storeId": store_id,
        "storeName": "Fugazee",
        "productId": update["productId"],
        "productTitle": "Racer Tee",
        "imageUrl": "https://cdn.shopify.com/1.jpg",
        "variantId": None,
        "variantTitle": None,
        "currency": "INR",
        "oldPrice": 99900,
        "newPrice": 79900,
        "at": update["at"],
        "nowAvailable": True,
        "nowPrice": 79900,
        "saved": False,
        "watched": False,
    }


def test_changes_to_some_options_are_listed_per_option(user, checker, store_id):
    refresh(checker, racer(m_price="1299.00", m=True), jacket(available=False))
    assert summary(updates(user)) == [
        ("price_rise", "Racer Tee", "Black / M", 99900, 129900),
        ("restock", "Racer Tee", "Black / M", None, None),
        ("sold_out", "Field Jacket", "Black / XL", None, None),  # One option only, so it names the option.
    ]


def test_whole_product_sell_out_and_restock(user, checker, store_id):
    refresh(checker, racer(s=False, m=False), jacket())
    refresh(checker, racer(s=True, m=True), jacket())
    items = updates(user)
    assert [(u["kind"], u["variantTitle"]) for u in items] == [("restock", None), ("sold_out", "Black / S")]


def test_filter_by_kind_and_refuse_unknown_kinds(user, checker, store_id):
    refresh(checker, racer(price="799.00", m=True), jacket(available=False))
    assert {u["kind"] for u in updates(user, kind="sold_out")} == {"sold_out"}
    assert len(updates(user)) == 3
    response = user.get("/api/updates", params={"kind": "new"})
    assert (response.status_code, response.json()["detail"]["code"]) == (422, "invalid_request")


def test_updates_are_private_to_monitoring_accounts(user, checker, store_id, new_client, sender):
    refresh(checker, racer(price="799.00"), jacket())
    other = new_client()
    signup(other, sender, email="b@example.com")
    assert updates(other) == []
    assert other.get("/api/updates").status_code == 200
    assert user.delete(f"/api/stores/{store_id}").status_code == 204
    assert updates(user) == []


def test_removed_products_drop_out_of_updates(user, checker, store_id):
    refresh(checker, racer(price="799.00"), jacket())
    refresh(checker, jacket())
    assert updates(user) == []


def test_old_updates_are_deleted(user, checker, store_id):
    refresh(checker, racer(price="799.00"), jacket())
    with get_engine().begin() as connection:
        connection.execute(text("UPDATE catalogue_updates SET at = now() - interval '91 days'"))
    refresh(checker, racer(price="799.00"), jacket())
    assert updates(user) == []


def test_price_history_per_variant_and_product(user, checker, store_id):
    refresh(checker, racer(price="799.00", m_price="899.00"), jacket())
    refresh(checker, racer(price="799.00", m_price="899.00"), jacket())  # No change, no new point.
    refresh(checker, racer(price="899.00", m_price="899.00"), jacket())
    items = user.get(f"/api/stores/{store_id}/products").json()["items"]
    racer_id = next(item["id"] for item in items if item["title"] == "Racer Tee")
    detail = user.get(f"/api/stores/{store_id}/products/{racer_id}").json()
    small, medium = detail["variants"]
    assert [p["price"] for p in small["priceHistory"]] == [99900, 79900, 89900]
    assert [p["price"] for p in medium["priceHistory"]] == [99900, 89900]
    assert [p["price"] for p in detail["priceHistory"]] == [99900, 79900, 89900]
    assert small["priceHistory"] == sorted(small["priceHistory"], key=lambda p: p["at"])


def test_updates_show_the_state_now(user, checker, store_id):
    refresh(checker, racer(m=True), jacket())  # Black / M is back.
    refresh(checker, racer(m=False, m_price="899.00"), jacket())  # Sold out again, and cheaper.
    restock = next(u for u in updates(user) if u["kind"] == "restock")
    assert (restock["variantTitle"], restock["nowAvailable"], restock["nowPrice"]) == ("Black / M", False, 89900)
    assert restock["variantId"]
    refresh(checker, tee(1, "Racer Tee", "999.00", {("Black", "S"): True}), jacket())  # Black / M is gone.
    restock = next(u for u in updates(user) if u["kind"] == "restock")
    assert (restock["nowAvailable"], restock["nowPrice"]) == (None, None)


def test_updates_mark_saved_products_and_watched_sizes(user, checker, store_id):
    items = user.get(f"/api/stores/{store_id}/products").json()["items"]
    racer_id = next(item["id"] for item in items if item["title"] == "Racer Tee")
    jacket_id = next(item["id"] for item in items if item["title"] == "Field Jacket")
    medium = user.get(f"/api/stores/{store_id}/products/{racer_id}").json()["variants"][1]["id"]
    assert user.post("/api/alerts", json={"productId": racer_id, "variantId": medium}).status_code == 200
    assert user.put(f"/api/wishlist/{jacket_id}").status_code == 200
    refresh(checker, racer(m=True), jacket(available=False))
    marks = {(u["kind"], u["productTitle"]): (u["saved"], u["watched"]) for u in updates(user)}
    # Setting an alert also saves the product.
    assert marks == {("restock", "Racer Tee"): (True, True), ("sold_out", "Field Jacket"): (True, False)}


def test_older_pages_continue_after_the_last_id(user, checker, store_id, monkeypatch):
    from app.routes import updates as route

    monkeypatch.setattr(route, "LIMIT", 2)
    refresh(checker, racer(price="799.00", m=True), jacket(available=False))
    first = updates(user)
    rest = updates(user, before=first[-1]["id"])
    assert len(first) == 2 and len(rest) == 1
    assert {u["id"] for u in first}.isdisjoint(u["id"] for u in rest)
    missing = user.get("/api/updates", params={"before": "00000000-0000-0000-0000-000000000000"})
    assert (missing.status_code, missing.json()["detail"]["code"]) == (422, "invalid_request")


def test_updates_need_a_session(client):
    assert client.get("/api/updates").status_code == 401
