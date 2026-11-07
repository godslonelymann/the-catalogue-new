"""Restock alerts and emails. The fake pipeline changes stock; the fake sender records emails."""

import pytest
from sqlalchemy import text

from app.alerts.service import send_restock_emails
from app.db import get_engine
from app.emails import EmailSendError
from app.jobs.refresh import refresh_all

from .conftest import signup
from .store_fixtures import add, approved_catalogue
from .test_updates import SHOP, jacket, racer

ZERO = "00000000-0000-0000-0000-000000000000"


@pytest.fixture
def racer_ids(user, checker):
    """Racer Tee: Black / S in stock, Black / M sold out."""
    checker.catalogues[SHOP] = approved_catalogue(racer(), jacket())
    store_id = add(user, "fugazee.com").json()["store"]["id"]
    items = user.get(f"/api/stores/{store_id}/products").json()["items"]
    product_id = next(item["id"] for item in items if item["title"] == "Racer Tee")
    detail = user.get(f"/api/stores/{store_id}/products/{product_id}").json()
    small, medium = detail["variants"]
    return {"store": store_id, "product": product_id, "small": small["id"], "medium": medium["id"]}


def create(client, ids, variant="medium"):
    return client.post("/api/alerts", json={"productId": ids["product"], "variantId": ids[variant]})


def alerts(client) -> list[dict]:
    response = client.get("/api/alerts")
    assert response.status_code == 200, response.text
    return response.json()


def restock(checker):
    checker.catalogues[SHOP] = approved_catalogue(racer(m=True), jacket())


class FailingSender:
    def __init__(self):
        self.tries = 0

    def send(self, email):
        self.tries += 1
        raise EmailSendError("SMTPServerDisconnected")


# --- Create, list, cancel ---------------------------------------------------------------------


def test_create_alert_for_a_sold_out_option(user, racer_ids):
    response = create(user, racer_ids)
    assert response.status_code == 200, response.text
    alert = response.json()
    assert alert == {
        "id": alert["id"],
        "storeId": racer_ids["store"],
        "storeName": "Fugazee",
        "productId": racer_ids["product"],
        "productTitle": "Racer Tee",
        "imageUrl": "https://cdn.shopify.com/1.jpg",
        "variantId": racer_ids["medium"],
        "variantTitle": "Black / M",
        "status": "active",
        "createdAt": alert["createdAt"],
        "sentAt": None,
    }
    assert create(user, racer_ids).json()["id"] == alert["id"]  # One active alert per option.
    assert [a["id"] for a in alerts(user)] == [alert["id"]]
    detail = user.get(f"/api/stores/{racer_ids['store']}/products/{racer_ids['product']}").json()
    assert detail["alerts"] == [{"id": alert["id"], "variantId": racer_ids["medium"]}]


def test_in_stock_option_is_refused(user, racer_ids):
    response = create(user, racer_ids, "small")
    assert (response.status_code, response.json()["detail"]["code"]) == (422, "not_sold_out")
    assert alerts(user) == []


def test_cancel_alert(user, racer_ids):
    alert_id = create(user, racer_ids).json()["id"]
    assert user.delete(f"/api/alerts/{alert_id}").status_code == 204
    assert alerts(user) == []
    assert user.delete(f"/api/alerts/{alert_id}").status_code == 404
    assert create(user, racer_ids).json()["id"] != alert_id  # A new alert after a cancel is allowed.


def test_alerts_are_private(user, racer_ids, new_client, sender):
    alert_id = create(user, racer_ids).json()["id"]
    other = new_client()
    signup(other, sender, email="b@example.com")
    assert alerts(other) == []
    assert other.delete(f"/api/alerts/{alert_id}").status_code == 404
    assert create(other, racer_ids).status_code == 404  # The other account doesn't monitor the store.


def test_unknown_or_mismatched_ids_are_404(user, racer_ids):
    assert user.post("/api/alerts", json={"productId": ZERO, "variantId": racer_ids["medium"]}).status_code == 404
    assert user.post("/api/alerts", json={"productId": racer_ids["product"], "variantId": ZERO}).status_code == 404
    response = user.post("/api/alerts", json={"productId": "nope", "variantId": racer_ids["medium"]})
    assert (response.status_code, response.json()["detail"]["code"]) == (422, "invalid_request")


def test_removing_the_store_cancels_its_alerts(user, racer_ids):
    create(user, racer_ids)
    assert user.delete(f"/api/stores/{racer_ids['store']}").status_code == 204
    assert alerts(user) == []
    with get_engine().begin() as connection:
        assert connection.execute(text("SELECT status FROM restock_alerts")).scalar_one() == "cancelled"


def test_alerts_need_a_session(client):
    assert client.get("/api/alerts").status_code == 401
    assert client.post("/api/alerts", json={"productId": ZERO, "variantId": ZERO}).status_code == 401


# --- Emails ---------------------------------------------------------------------------------


def test_restock_sends_one_email_and_marks_the_alert_sent(user, checker, racer_ids, sender):
    create(user, racer_ids)
    signup_emails = len(sender.sent)
    refresh_all(checker, sender)
    assert len(sender.sent) == signup_emails  # Still sold out: nothing to send.

    restock(checker)
    refresh_all(checker, sender)
    [email] = sender.sent[signup_emails:]
    assert email.to == "a@example.com"
    assert email.subject == "Back in stock: Racer Tee (Black / M)"
    assert "https://fugazee.com/products/p-1" in email.text
    assert f"http://localhost:5173/stores/{racer_ids['store']}/products/{racer_ids['product']}" in email.text
    assert email.idempotency_key.startswith("restock-")
    [alert] = alerts(user)
    assert alert["status"] == "sent" and alert["sentAt"] is not None

    refresh_all(checker, sender)  # A second run sends nothing more.
    assert len(sender.sent) == signup_emails + 1


def test_refresh_without_a_sender_sends_nothing(user, checker, racer_ids, sender):
    create(user, racer_ids)
    restock(checker)
    before = len(sender.sent)
    refresh_all(checker)
    assert len(sender.sent) == before
    assert alerts(user)[0]["status"] == "active"


def test_failed_send_stays_active_and_is_tried_again(user, checker, racer_ids, sender):
    create(user, racer_ids)
    restock(checker)
    failing = FailingSender()
    refresh_all(checker, failing)
    assert failing.tries == 1
    assert alerts(user)[0]["status"] == "active"
    with get_engine().begin() as connection:
        assert connection.execute(text("SELECT send_attempts, last_error FROM restock_alerts")).one() == (
            1,
            "SMTPServerDisconnected",
        )
    assert send_restock_emails(sender) == {"sent": 1, "failed": 0}
    assert alerts(user)[0]["status"] == "sent"


def test_sending_stops_after_five_failures(user, checker, racer_ids):
    create(user, racer_ids)
    restock(checker)
    refresh_all(checker)
    failing = FailingSender()
    for _ in range(7):
        send_restock_emails(failing)
    assert failing.tries == 5


def test_no_email_while_the_latest_check_failed(user, checker, racer_ids, sender):
    create(user, racer_ids)
    restock(checker)
    refresh_all(checker)
    with get_engine().begin() as connection:
        connection.execute(text("UPDATE stores SET last_check_failed = true"))
    assert send_restock_emails(sender) == {"sent": 0, "failed": 0}


def test_new_alert_after_a_sent_one(user, checker, racer_ids, sender):
    create(user, racer_ids)
    restock(checker)
    refresh_all(checker, sender)
    checker.catalogues[SHOP] = approved_catalogue(racer(), jacket())  # Sold out again.
    refresh_all(checker, sender)
    second = create(user, racer_ids)
    assert second.status_code == 200
    assert sorted(a["status"] for a in alerts(user)) == ["active", "sent"]
