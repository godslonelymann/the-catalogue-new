"""
Restock alerts.

Create: the account must monitor the store, the catalogue must be ready, and the variant must be sold out.
Creating an alert also saves the product: alerts show on the Saved page, under their product.
Send: after a refresh, every active alert whose variant is back in stock gets one email. The alert is marked
sent only after the SMTP server accepts the email. A failed send stays active and is tried on the next run.
"""

import logging
import uuid

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload

from ..config import get_settings
from ..db import get_sessionmaker
from ..emails import Email, EmailSender, EmailSendError, back_in_stock
from ..errors import ApiError, not_found
from ..models import Account
from ..security import utcnow
from ..stores.models import APPROVED, READY, AccountStore, Product, Store, Variant
from ..wishlist.service import ensure_saved
from .models import ACTIVE, CANCELLED, SENT, RestockAlert

log = logging.getLogger(__name__)

MAX_ACTIVE_ALERTS = 200
MAX_SEND_ATTEMPTS = 5
SEND_BATCH = 200


# --- Create and cancel -------------------------------------------------------------------


def create_alert(db: Session, account_id: uuid.UUID, product_id: uuid.UUID, variant_id: uuid.UUID) -> RestockAlert:
    row = db.execute(
        select(Variant, Product, Store)
        .join(Product, Product.id == Variant.product_id)
        .join(Store, Store.id == Product.store_id)
        .join(AccountStore, (AccountStore.store_id == Store.id) & (AccountStore.account_id == account_id))
        .where(
            Variant.id == variant_id,
            Product.id == product_id,
            Variant.removed_at.is_(None),
            Product.removed_at.is_(None),
            Store.import_status == READY,
        )
    ).one_or_none()
    if row is None:
        raise not_found()
    variant, product, store = row
    if variant.available:
        raise ApiError(422, "not_sold_out", "This option is in stock. Alerts are for sold-out options.")

    # Lock the account row, so the count below can't be passed by two requests at once.
    db.execute(select(Account.id).where(Account.id == account_id).with_for_update())
    active = db.scalars(select(RestockAlert).where(RestockAlert.account_id == account_id, RestockAlert.status == ACTIVE)).all()
    if existing := next((alert for alert in active if alert.variant_id == variant_id), None):
        ensure_saved(db, account_id, product)
        db.commit()
        return existing
    if len(active) >= MAX_ACTIVE_ALERTS:
        db.rollback()
        raise ApiError(409, "conflict", f"You can have up to {MAX_ACTIVE_ALERTS} active alerts. Cancel one to add another.")

    alert_id = uuid.uuid4()
    db.execute(
        insert(RestockAlert)
        .values(
            id=alert_id,
            account_id=account_id,
            store_id=store.id,
            product_id=product.id,
            variant_id=variant.id,
            status=ACTIVE,
            send_attempts=0,
        )
        .on_conflict_do_nothing()
    )
    # An alert lives on a saved product, so setting one saves the product.
    ensure_saved(db, account_id, product)
    db.commit()
    return db.scalars(
        select(RestockAlert).where(
            RestockAlert.account_id == account_id, RestockAlert.variant_id == variant_id, RestockAlert.status == ACTIVE
        )
    ).one()


def cancel_alert(db: Session, account_id: uuid.UUID, alert_id: uuid.UUID) -> None:
    result = db.execute(
        update(RestockAlert)
        .where(RestockAlert.id == alert_id, RestockAlert.account_id == account_id, RestockAlert.status == ACTIVE)
        .values(status=CANCELLED, cancelled_at=utcnow())
    )
    db.commit()
    if result.rowcount == 0:
        raise not_found()


def cancel_store_alerts(db: Session, account_id: uuid.UUID, store_id: uuid.UUID) -> None:
    """Removing a store cancels the account's active alerts for it. The caller commits."""
    db.execute(
        update(RestockAlert)
        .where(RestockAlert.account_id == account_id, RestockAlert.store_id == store_id, RestockAlert.status == ACTIVE)
        .values(status=CANCELLED, cancelled_at=utcnow())
    )


def list_alerts(db: Session, account_id: uuid.UUID) -> list[RestockAlert]:
    return list(
        db.scalars(
            select(RestockAlert)
            .where(RestockAlert.account_id == account_id, RestockAlert.status != CANCELLED)
            .options(joinedload(RestockAlert.store), joinedload(RestockAlert.product), joinedload(RestockAlert.variant))
            .order_by(RestockAlert.created_at.desc(), RestockAlert.id)
        )
    )


def active_alerts_for_product(db: Session, account_id: uuid.UUID, product_id: uuid.UUID) -> list[dict]:
    rows = db.execute(
        select(RestockAlert.id, RestockAlert.variant_id).where(
            RestockAlert.account_id == account_id, RestockAlert.product_id == product_id, RestockAlert.status == ACTIVE
        )
    )
    return [{"id": str(alert_id), "variantId": str(variant_id)} for alert_id, variant_id in rows]


# --- Sending ------------------------------------------------------------------------------


def restock_email(alert: RestockAlert) -> Email:
    product, variant, store = alert.product, alert.variant, alert.store
    app_link = f"{get_settings().app_base_url}/stores/{store.id}/products/{product.id}"
    option = " / ".join(variant.options) or variant.title
    return back_in_stock(alert.account.email, str(alert.id), product.title, option, store.name, product.url, app_link)


def send_restock_emails(sender: EmailSender) -> dict[str, int]:
    """
    Sends one email per active alert whose variant is in stock in the latest successful check.
    Each alert is locked while it sends (SKIP LOCKED), so two runs at once never send the same alert.
    """
    counts = {"sent": 0, "failed": 0}
    with get_sessionmaker()() as db:
        due = db.scalars(
            select(RestockAlert.id)
            .join(Variant, Variant.id == RestockAlert.variant_id)
            .join(Product, Product.id == RestockAlert.product_id)
            .join(Store, Store.id == RestockAlert.store_id)
            .join(Account, Account.id == RestockAlert.account_id)
            .where(
                RestockAlert.status == ACTIVE,
                RestockAlert.send_attempts < MAX_SEND_ATTEMPTS,
                Variant.available.is_(True),
                Variant.removed_at.is_(None),
                Product.removed_at.is_(None),
                Store.approval == APPROVED,
                Store.last_check_failed.is_(False),
                Account.email_verified.is_(True),
            )
            .order_by(RestockAlert.created_at)
            .limit(SEND_BATCH)
        ).all()

    for alert_id in due:
        with get_sessionmaker()() as db:
            alert = db.scalars(
                select(RestockAlert)
                .where(RestockAlert.id == alert_id, RestockAlert.status == ACTIVE)
                .options(
                    joinedload(RestockAlert.account),
                    joinedload(RestockAlert.store),
                    joinedload(RestockAlert.product),
                    joinedload(RestockAlert.variant),
                )
                .with_for_update(skip_locked=True, of=RestockAlert)
            ).one_or_none()
            if alert is None:
                continue  # Sent, cancelled, or another run holds it.
            try:
                sender.send(restock_email(alert))
            except EmailSendError as error:
                alert.send_attempts += 1
                alert.last_error = str(error)[:255]
                counts["failed"] += 1
                log.error("Restock email for alert %s not sent: %s", alert.id, error)
            else:
                alert.status = SENT
                alert.sent_at = utcnow()
                alert.last_error = None
                counts["sent"] += 1
            db.commit()
    return counts
