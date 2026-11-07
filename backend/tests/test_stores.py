"""Store routes with a fake pipeline. No test sends a network request."""

from datetime import timedelta

from catalogue_pipeline import CatalogueResult, Outcome, Reason, StoreIdentity
from sqlalchemy import select, text

from app.db import get_engine, get_sessionmaker
from app.jobs.refresh import refresh_all
from app.stores.models import Product, Store, Variant

from .conftest import signup
from .store_fixtures import FUGAZEE, add, approved_catalogue, error_code, failed, shopify_product

# --- Adding -------------------------------------------------------------------------


def test_stores_need_a_session(client, checker):
    assert client.get("/api/stores").status_code == 401
    assert add(client, "fugazee.com").status_code == 401


def test_approved_store_is_saved_and_imported(user, checker):
    response = add(user, "https://fugazee.com")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] is True
    assert body["store"]["host"] == "fugazee.com"
    assert body["store"]["brandName"] == "Fugazee"

    listed = user.get("/api/stores").json()
    assert listed["brandCount"] == 1 and listed["brandLimit"] == 10
    [store] = listed["stores"]
    assert store["status"] == "ready"  # The import runs after the response.
    assert store["productCount"] == 2
    assert store["lastSuccessfulCheckAt"] is not None
    assert checker.reads == ["fugazee.myshopify.com"]

    with get_sessionmaker()() as db:
        saved = db.scalars(select(Store)).one()
        assert (saved.approval, saved.currency) == ("approved", "INR")
        assert db.scalar(select(Product.min_price).where(Product.shopify_id == 1)) == 149900
        assert len(db.scalars(select(Variant)).all()) == 4


def test_saved_result_is_reused_for_aliases_and_other_accounts(user, checker, new_client, sender):
    add(user, "fugazee.com")
    again = add(user, "https://www.fugazee.com/collections/all")
    assert again.json()["created"] is False
    assert add(user, "fugazee.myshopify.com").json()["created"] is False
    # A new address is checked once, then saved as an alias. The shop name is known from the first check.
    assert checker.checks == ["fugazee.com", "www.fugazee.com"]

    other = new_client()
    signup(other, sender, email="b@example.com")
    response = add(other, "www.fugazee.com")
    assert response.json()["created"] is True
    assert response.json()["store"]["status"] == "ready"
    assert checker.checks == ["fugazee.com", "www.fugazee.com"]
    assert checker.reads == ["fugazee.myshopify.com"]


def test_product_link_is_refused_before_any_check(user, checker):
    response = add(user, "https://fugazee.com/products/racer-tee")
    assert (response.status_code, error_code(response)) == (422, "invalid_url")
    assert response.json()["detail"]["message"] == "Enter the store’s home page, not a product page."
    assert checker.checks == []


def test_rejected_store_is_remembered(user, checker):
    first = add(user, "https://example.com")
    assert (first.status_code, error_code(first)) == (422, "unsupported_store")
    assert first.json()["detail"]["message"] == "Only supported Shopify stores can be added."
    second = add(user, "example.com")
    assert error_code(second) == "unsupported_store"
    assert checker.checks == ["example.com"]
    assert user.get("/api/stores").json()["stores"] == []


def test_unreachable_store_means_try_later_and_is_remembered_briefly(user, checker):
    checker.shops["offline-shop.in"] = failed(Reason.UNREACHABLE)
    first = add(user, "offline-shop.in")
    assert (first.status_code, error_code(first)) == (502, "check_failed")
    assert error_code(add(user, "offline-shop.in")) == "check_failed"
    assert checker.checks == ["offline-shop.in"]

    with get_engine().begin() as connection:
        connection.execute(text("UPDATE store_check_failures SET expires_at = now() - interval '1 minute'"))
    checker.shops["offline-shop.in"] = FUGAZEE
    assert add(user, "offline-shop.in").status_code == 200
    assert checker.checks == ["offline-shop.in", "offline-shop.in"]


def test_failed_first_import_frees_the_brand_slot(user, checker):
    checker.catalogues["fugazee.myshopify.com"] = CatalogueResult(Outcome.REJECTED, Reason.FEED_UNREADABLE, "page 3 failed")
    assert add(user, "fugazee.com").json()["store"]["status"] == "importing"
    listed = user.get("/api/stores").json()
    assert listed["stores"][0]["status"] == "import_failed"
    assert listed["brandCount"] == 0
    with get_sessionmaker()() as db:
        assert db.scalars(select(Store.approval)).one() == "rejected"

    # A rejected import is remembered too. After that, a new add checks again.
    assert error_code(add(user, "fugazee.com")) == "unsupported_store"
    with get_engine().begin() as connection:
        connection.execute(text("DELETE FROM store_check_failures"))
    del checker.catalogues["fugazee.myshopify.com"]
    response = add(user, "fugazee.com")
    assert response.json()["created"] is True
    assert user.get("/api/stores").json()["stores"][0]["status"] == "ready"
    assert len(user.get("/api/stores").json()["stores"]) == 1


def test_brand_limit_counts_storefronts_of_one_brand_once(user, checker):
    for number in range(10):
        checker.shops[f"brand{number}.in"] = StoreIdentity(
            f"brand{number}.myshopify.com", f"brand{number}.in", "INR", f"B{number}"
        )
        assert add(user, f"brand{number}.in").status_code == 200

    checker.shops["eleventh.in"] = StoreIdentity("eleventh.myshopify.com", "eleventh.in", "INR", "Eleventh")
    response = add(user, "eleventh.in")
    assert (response.status_code, error_code(response)) == (409, "brand_limit")

    # Another storefront (another shop) on a monitored brand's domain is accepted.
    checker.shops["archive.brand0.in"] = StoreIdentity("brand0-archive.myshopify.com", "archive.brand0.in", "INR", "Archive")
    assert add(user, "archive.brand0.in").status_code == 200
    listed = user.get("/api/stores").json()
    assert (len(listed["stores"]), listed["brandCount"]) == (11, 10)


def test_one_person_can_only_check_so_many_stores(user, checker):
    for number in range(20):
        add(user, f"nope{number}.com")
    response = add(user, "one-more.com")
    assert (response.status_code, error_code(response)) == (429, "rate_limited")
    assert len(checker.checks) == 20


def test_remove_store(user, checker):
    store_id = add(user, "fugazee.com").json()["store"]["id"]
    assert user.delete(f"/api/stores/{store_id}").status_code == 204
    assert user.get("/api/stores").json()["stores"] == []
    assert user.delete(f"/api/stores/{store_id}").status_code == 404


# --- Daily refresh ----------------------------------------------------------------------


def test_refresh_updates_the_catalogue_and_marks_removed_products(user, checker):
    add(user, "fugazee.com")
    checker.catalogues["fugazee.myshopify.com"] = approved_catalogue(shopify_product(1, price="999.00"), shopify_product(3))
    results = refresh_all(checker)
    assert list(results.values()) == ["ready"]
    with get_sessionmaker()() as db:
        prices = {p.shopify_id: (p.min_price, p.removed_at is not None) for p in db.scalars(select(Product))}
    assert prices[1] == (99900, False)
    assert prices[2][1] is True  # No longer in the store. Kept, marked removed.
    assert prices[3] == (149900, False)
    assert user.get("/api/stores").json()["stores"][0]["productCount"] == 2


def test_refresh_revokes_a_store_that_left_shopify(user, checker):
    add(user, "fugazee.com")
    checker.shops["fugazee.com"] = failed(Reason.NOT_SHOPIFY)
    assert list(refresh_all(checker).values()) == ["rejected: not_shopify"]
    [store] = user.get("/api/stores").json()["stores"]
    assert (store["status"], store["lastCheckFailed"], store["productCount"]) == ("ready", True, 2)
    with get_sessionmaker()() as db:
        assert db.scalars(select(Store.approval)).one() == "revoked"

    # A revoked store is not reused: a new add checks it again. Here the check passes, so it imports again.
    checks = len(checker.checks)
    checker.shops["fugazee.com"] = FUGAZEE
    response = add(user, "fugazee.com")
    assert response.json()["created"] is False
    assert len(checker.checks) == checks + 1
    with get_sessionmaker()() as db:
        assert db.scalars(select(Store.approval)).one() == "approved"


def test_refresh_keeps_the_catalogue_when_a_store_is_busy(user, checker):
    add(user, "fugazee.com")
    checker.shops["fugazee.com"] = failed(Reason.RATE_LIMITED)
    refresh_all(checker)
    [store] = user.get("/api/stores").json()["stores"]
    assert (store["status"], store["lastCheckFailed"]) == ("ready", True)
    with get_sessionmaker()() as db:
        assert db.scalars(select(Store.approval)).one() == "approved"


def test_refresh_restarts_a_stuck_import(user, checker):
    add(user, "fugazee.com")
    with get_engine().begin() as connection:
        connection.execute(
            text(
                "UPDATE stores SET import_status = 'importing', approval = 'pending', last_successful_check_at = NULL, "
                "import_started_at = now() - :age"
            ),
            {"age": timedelta(hours=1)},
        )
    assert list(refresh_all(checker).values()) == ["ready"]
