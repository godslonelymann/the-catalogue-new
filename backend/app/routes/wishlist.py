"""
Saved products (the wishlist) with their size alerts. Every route needs a session and sees only the account's own entries.

    GET    /api/wishlist               saved products, newest first, each with its watched sizes
    PUT    /api/wishlist/{productId}   save a product
    DELETE /api/wishlist/{productId}   remove it and cancel its active alerts
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..alerts.models import RestockAlert
from ..db import get_db
from ..sessions import Auth, require_auth
from ..wishlist.service import SavedProduct, alerts_by_product, list_items, remove_product, save_product
from .products import summary
from .stores import iso

router = APIRouter(prefix="/api/wishlist", tags=["wishlist"])


def saved_alert_view(alert: RestockAlert) -> dict:
    variant = alert.variant
    return {
        "id": str(alert.id),
        "variantId": str(variant.id),
        "variantTitle": " / ".join(variant.options) or variant.title,
        "status": alert.status,
        "createdAt": iso(alert.created_at),
        "sentAt": iso(alert.sent_at),
    }


def item_view(saved: SavedProduct) -> dict:
    item = saved.item
    return {
        "id": str(item.id),
        "savedAt": iso(item.created_at),
        "storeName": item.store.name,
        "product": summary(item.product, item.store, saved=True),
        "alerts": [saved_alert_view(alert) for alert in saved.alerts],
    }


@router.get("")
def list_(auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    return [item_view(saved) for saved in list_items(db, auth.account.id)]


@router.put("/{product_id}")
def save(product_id: uuid.UUID, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    item = save_product(db, auth.account.id, product_id)
    alerts = alerts_by_product(db, auth.account.id, [product_id]).get(product_id, [])
    return item_view(SavedProduct(item, alerts))


@router.delete("/{product_id}")
def remove(product_id: uuid.UUID, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    return {"cancelledAlerts": remove_product(db, auth.account.id, product_id)}
