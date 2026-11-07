"""
Saved products (the wishlist) and their size alerts, in one list.

- Only products from stores that the account monitors, with a ready catalogue, can be saved.
- Saving twice keeps one entry. An account can save up to 500 products.
- A saved product can watch sizes: each is a restock alert. Setting an alert saves the product.
- Removing a saved product cancels its active alerts. Removing a store removes its saved products and alerts.
- A product that leaves the store is hidden from the list. It shows again if the store lists it again.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload

from ..alerts.models import ACTIVE, CANCELLED, RestockAlert
from ..errors import ApiError, not_found
from ..models import Account
from ..security import utcnow
from ..stores.models import READY, AccountStore, Product, Store
from .models import WishlistItem

MAX_SAVED = 500


def _visible():
    """Conditions for an entry the account can see: ready catalogue, product still listed."""
    return (Store.import_status == READY, Product.removed_at.is_(None))


def monitored_product(db: Session, account_id: uuid.UUID, product_id: uuid.UUID) -> Product:
    product = db.scalars(
        select(Product)
        .join(Store, Store.id == Product.store_id)
        .join(AccountStore, (AccountStore.store_id == Store.id) & (AccountStore.account_id == account_id))
        .where(Product.id == product_id, *_visible())
    ).one_or_none()
    if product is None:
        raise not_found()
    return product


def ensure_saved(db: Session, account_id: uuid.UUID, product: Product) -> None:
    """Saves the product if it isn't saved yet. Locks the account row for the limit. The caller commits."""
    db.execute(select(Account.id).where(Account.id == account_id).with_for_update())
    existing = db.scalar(
        select(WishlistItem.id).where(WishlistItem.account_id == account_id, WishlistItem.product_id == product.id)
    )
    if existing is not None:
        return
    count = db.scalar(select(func.count()).select_from(WishlistItem).where(WishlistItem.account_id == account_id)) or 0
    if count >= MAX_SAVED:
        db.rollback()
        raise ApiError(409, "conflict", f"You can save up to {MAX_SAVED} products. Remove one to save another.")
    db.execute(
        insert(WishlistItem)
        .values(id=uuid.uuid4(), account_id=account_id, store_id=product.store_id, product_id=product.id)
        .on_conflict_do_nothing(index_elements=["account_id", "product_id"])
    )


def save_product(db: Session, account_id: uuid.UUID, product_id: uuid.UUID) -> WishlistItem:
    ensure_saved(db, account_id, monitored_product(db, account_id, product_id))
    db.commit()
    return entry(db, account_id, product_id)


def entry(db: Session, account_id: uuid.UUID, product_id: uuid.UUID) -> WishlistItem:
    return db.scalars(
        select(WishlistItem)
        .where(WishlistItem.account_id == account_id, WishlistItem.product_id == product_id)
        .options(joinedload(WishlistItem.store), joinedload(WishlistItem.product))
    ).one()


def remove_product(db: Session, account_id: uuid.UUID, product_id: uuid.UUID) -> int:
    """Removes a saved product and cancels its active alerts. Returns how many alerts were cancelled."""
    result = db.execute(delete(WishlistItem).where(WishlistItem.account_id == account_id, WishlistItem.product_id == product_id))
    if result.rowcount == 0:
        db.rollback()
        raise not_found()
    cancelled = db.execute(
        update(RestockAlert)
        .where(RestockAlert.account_id == account_id, RestockAlert.product_id == product_id, RestockAlert.status == ACTIVE)
        .values(status=CANCELLED, cancelled_at=utcnow())
    ).rowcount
    db.commit()
    return cancelled


def remove_store_items(db: Session, account_id: uuid.UUID, store_id: uuid.UUID) -> None:
    """Called when the account removes a store. The caller commits."""
    db.execute(delete(WishlistItem).where(WishlistItem.account_id == account_id, WishlistItem.store_id == store_id))


@dataclass
class SavedProduct:
    item: WishlistItem
    # One per watched size: the active alert, or else the latest sent one.
    alerts: list[RestockAlert]


def list_items(db: Session, account_id: uuid.UUID) -> list[SavedProduct]:
    items = list(
        db.scalars(
            select(WishlistItem)
            .join(Product, Product.id == WishlistItem.product_id)
            .join(Store, Store.id == WishlistItem.store_id)
            .join(AccountStore, (AccountStore.store_id == Store.id) & (AccountStore.account_id == account_id))
            .where(WishlistItem.account_id == account_id, *_visible())
            .options(joinedload(WishlistItem.store), joinedload(WishlistItem.product))
            .order_by(WishlistItem.created_at.desc(), WishlistItem.id)
        )
    )
    alerts = alerts_by_product(db, account_id, [item.product_id for item in items])
    return [SavedProduct(item, alerts.get(item.product_id, [])) for item in items]


def alerts_by_product(db: Session, account_id: uuid.UUID, product_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[RestockAlert]]:
    if not product_ids:
        return {}
    rows = db.scalars(
        select(RestockAlert)
        .where(RestockAlert.account_id == account_id, RestockAlert.product_id.in_(product_ids), RestockAlert.status != CANCELLED)
        .options(joinedload(RestockAlert.variant))
        # Active first, then the newest sent alert.
        .order_by((RestockAlert.status == ACTIVE).desc(), RestockAlert.created_at.desc())
    )
    result: dict[uuid.UUID, list[RestockAlert]] = {}
    seen: set[uuid.UUID] = set()
    for alert in rows:
        if alert.variant_id in seen or alert.variant.removed_at is not None:
            continue
        seen.add(alert.variant_id)
        result.setdefault(alert.product_id, []).append(alert)
    for alerts in result.values():
        alerts.sort(key=lambda alert: alert.created_at)
    return result


def saved_product_ids(db: Session, account_id: uuid.UUID, product_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not product_ids:
        return set()
    return set(
        db.scalars(
            select(WishlistItem.product_id).where(WishlistItem.account_id == account_id, WishlistItem.product_id.in_(product_ids))
        )
    )
