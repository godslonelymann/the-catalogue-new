"""The daily-check log behind the check grid."""

from datetime import timedelta

from catalogue_pipeline import CatalogueResult, Outcome
from sqlalchemy import text

from app.db import get_engine
from app.jobs.refresh import refresh_all

from .conftest import signup
from .store_fixtures import add, approved_catalogue
from .test_products import tee

SHOP = "fugazee.myshopify.com"


def racer(price: str = "999.00") -> dict:
    return tee(1, "Racer Tee", price, {("Black", "S"): True})


def checks(client, store_id) -> dict:
    response = client.get(f"/api/stores/{store_id}/checks")
    assert response.status_code == 200, response.text
    return response.json()


def shift_back(days: int) -> None:
    """Moves every recorded check back, so the next one lands on another day."""
    with get_engine().begin() as connection:
        connection.execute(text("UPDATE store_checks SET at = at - :shift"), {"shift": timedelta(days=days)})


def test_import_and_refreshes_add_one_day_each(user, checker):
    checker.catalogues[SHOP] = approved_catalogue(racer())
    store_id = add(user, "fugazee.com").json()["store"]["id"]
    body = checks(user, store_id)
    assert len(body["days"]) == 1 and body["days"][0] == {"day": body["to"], "ok": True, "changes": 0}

    shift_back(1)
    checker.catalogues[SHOP] = approved_catalogue(racer(price="799.00"))
    refresh_all(checker)
    shift_back(1)
    checker.catalogues[SHOP] = CatalogueResult(Outcome.RETRY_LATER, None, "busy")
    refresh_all(checker)

    days = checks(user, store_id)["days"]
    assert [(d["ok"], d["changes"]) for d in days] == [(True, 0), (True, 1), (False, 0)]
    assert days[-1]["day"] == checks(user, store_id)["to"]


def test_days_are_merged_and_old_days_are_left_out(user, checker):
    checker.catalogues[SHOP] = approved_catalogue(racer())
    store_id = add(user, "fugazee.com").json()["store"]["id"]
    checker.catalogues[SHOP] = CatalogueResult(Outcome.RETRY_LATER, None, "busy")
    refresh_all(checker)  # Same day: one passed check is enough.
    assert [d["ok"] for d in checks(user, store_id)["days"]] == [True]
    shift_back(84)
    assert checks(user, store_id)["days"] == []


def test_checks_are_private(user, checker, new_client, sender):
    checker.catalogues[SHOP] = approved_catalogue(racer())
    store_id = add(user, "fugazee.com").json()["store"]["id"]
    other = new_client()
    signup(other, sender, email="b@example.com")
    assert other.get(f"/api/stores/{store_id}/checks").status_code == 404
