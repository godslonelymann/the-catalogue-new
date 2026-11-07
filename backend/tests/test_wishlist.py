"""Wishlist routes. Every route needs a session, and each account sees only its own saved products."""

import pytest

from app.jobs.refresh import refresh_all

from .conftest import signup
from .store_fixtures import add, approved_catalogue
from .test_updates import SHOP, jacket, racer

ZERO = "00000000-0000-0000-0000-000000000000"


@pytest.fixture
def ids(user, checker):
    checker.catalogues[SHOP] = approved_catalogue(racer(), jacket())
    store_id = add(user, "fugazee.com").json()["store"]["id"]
    items = user.get(f"/api/stores/{store_id}/products").json()["items"]
    by_title = {item["title"]: item["id"] for item in items}
    return {"store": store_id, "racer": by_title["Racer Tee"], "jacket": by_title["Field Jacket"]}


def wishlist(client) -> list[dict]:
    response = client.get("/api/wishlist")
    assert response.status_code == 200, response.text
    return response.json()


def test_save_and_list(user, ids):
    response = user.put(f"/api/wishlist/{ids['racer']}")
    assert response.status_code == 200, response.text
    item = response.json()
    assert item["storeName"] == "Fugazee"
    assert item["product"]["id"] == ids["racer"]
    assert item["product"]["title"] == "Racer Tee"
    assert item["product"]["saved"] is True
    assert item["product"]["price"] == 99900
    assert item["alerts"] == []

    again = user.put(f"/api/wishlist/{ids['racer']}")
    assert again.json()["id"] == item["id"]  # One entry per product.
    user.put(f"/api/wishlist/{ids['jacket']}")
    assert [entry["product"]["title"] for entry in wishlist(user)] == ["Field Jacket", "Racer Tee"]  # Newest first.


def test_saved_marker_on_products(user, ids):
    user.put(f"/api/wishlist/{ids['racer']}")
    items = user.get(f"/api/stores/{ids['store']}/products").json()["items"]
    assert {item["title"]: item["saved"] for item in items} == {"Field Jacket": False, "Racer Tee": True}
    assert user.get(f"/api/stores/{ids['store']}/products/{ids['racer']}").json()["saved"] is True
    assert user.get(f"/api/stores/{ids['store']}/products/{ids['jacket']}").json()["saved"] is False


def test_remove(user, ids):
    user.put(f"/api/wishlist/{ids['racer']}")
    response = user.delete(f"/api/wishlist/{ids['racer']}")
    assert (response.status_code, response.json()) == (200, {"cancelledAlerts": 0})
    assert wishlist(user) == []
    assert user.delete(f"/api/wishlist/{ids['racer']}").status_code == 404


def test_wishlist_is_private(user, ids, new_client, sender):
    user.put(f"/api/wishlist/{ids['racer']}")
    other = new_client()
    signup(other, sender, email="b@example.com")
    assert wishlist(other) == []
    assert other.put(f"/api/wishlist/{ids['racer']}").status_code == 404  # Not a store the account monitors.
    assert other.delete(f"/api/wishlist/{ids['racer']}").status_code == 404

    # When both accounts monitor the store, both can save the same product.
    add(other, "fugazee.com")
    assert other.put(f"/api/wishlist/{ids['racer']}").status_code == 200
    assert len(wishlist(other)) == 1 and len(wishlist(user)) == 1
    assert other.delete(f"/api/wishlist/{ids['racer']}").status_code == 200
    assert len(wishlist(user)) == 1


def test_removing_the_store_removes_its_saved_products(user, ids):
    user.put(f"/api/wishlist/{ids['racer']}")
    assert user.delete(f"/api/stores/{ids['store']}").status_code == 204
    assert wishlist(user) == []
    add(user, "fugazee.com")  # Adding it again does not bring them back.
    assert wishlist(user) == []


def test_product_that_leaves_the_store_is_hidden(user, checker, ids):
    user.put(f"/api/wishlist/{ids['racer']}")
    checker.catalogues[SHOP] = approved_catalogue(jacket())
    refresh_all(checker)
    assert wishlist(user) == []
    checker.catalogues[SHOP] = approved_catalogue(racer(), jacket())
    refresh_all(checker)
    assert [entry["product"]["title"] for entry in wishlist(user)] == ["Racer Tee"]


def test_unknown_ids(user, ids):
    assert user.put(f"/api/wishlist/{ZERO}").status_code == 404
    response = user.put("/api/wishlist/not-a-uuid")
    assert (response.status_code, response.json()["detail"]["code"]) == (422, "invalid_request")


def test_wishlist_needs_a_session(client):
    assert client.get("/api/wishlist").status_code == 401
    assert client.put(f"/api/wishlist/{ZERO}").status_code == 401
    assert client.delete(f"/api/wishlist/{ZERO}").status_code == 401


def test_every_private_route_needs_a_session(client):
    """The app has no guest browsing: every data route answers 401 without a session."""
    routes = [
        ("GET", "/api/me"),
        ("GET", "/api/stores"),
        ("POST", "/api/stores"),
        ("DELETE", f"/api/stores/{ZERO}"),
        ("GET", f"/api/stores/{ZERO}/products"),
        ("GET", f"/api/stores/{ZERO}/products/{ZERO}"),
        ("GET", "/api/updates"),
        ("GET", "/api/alerts"),
        ("POST", "/api/alerts"),
        ("DELETE", f"/api/alerts/{ZERO}"),
        ("GET", "/api/wishlist"),
        ("PUT", f"/api/wishlist/{ZERO}"),
        ("DELETE", f"/api/wishlist/{ZERO}"),
    ]
    for method, path in routes:
        response = client.request(method, path, json={})
        assert response.status_code == 401, (method, path, response.status_code)


# --- Size alerts on saved products ---------------------------------------------------------------


def medium_id(user, ids) -> str:
    """Racer Tee, Black / M: the sold-out size."""
    detail = user.get(f"/api/stores/{ids['store']}/products/{ids['racer']}").json()
    return next(v["id"] for v in detail["variants"] if not v["available"])


def test_setting_an_alert_saves_the_product(user, ids):
    variant = medium_id(user, ids)
    alert = user.post("/api/alerts", json={"productId": ids["racer"], "variantId": variant}).json()
    [item] = wishlist(user)
    assert item["product"]["id"] == ids["racer"]
    assert item["alerts"] == [
        {
            "id": alert["id"],
            "variantId": variant,
            "variantTitle": "Black / M",
            "status": "active",
            "createdAt": alert["createdAt"],
            "sentAt": None,
        }
    ]
    assert user.get(f"/api/stores/{ids['store']}/products/{ids['racer']}").json()["saved"] is True


def test_removing_a_saved_product_cancels_its_alerts(user, ids):
    variant = medium_id(user, ids)
    user.post("/api/alerts", json={"productId": ids["racer"], "variantId": variant})
    response = user.delete(f"/api/wishlist/{ids['racer']}")
    assert response.json() == {"cancelledAlerts": 1}
    assert user.get("/api/alerts").json() == []
    detail = user.get(f"/api/stores/{ids['store']}/products/{ids['racer']}").json()
    assert (detail["saved"], detail["alerts"]) == (False, [])


def test_cancelling_an_alert_keeps_the_product_saved(user, ids):
    variant = medium_id(user, ids)
    alert = user.post("/api/alerts", json={"productId": ids["racer"], "variantId": variant}).json()
    assert user.delete(f"/api/alerts/{alert['id']}").status_code == 204
    [item] = wishlist(user)
    assert item["alerts"] == []


def test_sent_alert_shows_until_a_new_one_replaces_it(user, checker, ids, sender):
    variant = medium_id(user, ids)
    user.post("/api/alerts", json={"productId": ids["racer"], "variantId": variant})
    checker.catalogues[SHOP] = approved_catalogue(racer(m=True), jacket())
    refresh_all(checker, sender)
    [item] = wishlist(user)
    assert [(a["variantTitle"], a["status"]) for a in item["alerts"]] == [("Black / M", "sent")]
    assert item["alerts"][0]["sentAt"] is not None

    checker.catalogues[SHOP] = approved_catalogue(racer(), jacket())  # Sold out again.
    refresh_all(checker, sender)
    user.post("/api/alerts", json={"productId": ids["racer"], "variantId": variant})
    [item] = wishlist(user)
    assert [(a["variantTitle"], a["status"]) for a in item["alerts"]] == [("Black / M", "active")]
