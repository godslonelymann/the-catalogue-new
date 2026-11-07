"""Restock alert routes: list, create (sold-out variants only), and cancel."""

import uuid

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..alerts.models import RestockAlert
from ..alerts.service import cancel_alert, create_alert, list_alerts
from ..db import get_db
from ..sessions import Auth, require_auth
from .stores import iso

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


class AlertIn(BaseModel):
    productId: uuid.UUID
    variantId: uuid.UUID


def alert_view(alert: RestockAlert) -> dict:
    variant = alert.variant
    return {
        "id": str(alert.id),
        "storeId": str(alert.store_id),
        "storeName": alert.store.name,
        "productId": str(alert.product_id),
        "productTitle": alert.product.title,
        "imageUrl": variant.image_url or alert.product.image_url or "",
        "variantId": str(variant.id),
        "variantTitle": " / ".join(variant.options) or variant.title,
        "status": alert.status,
        "createdAt": iso(alert.created_at),
        "sentAt": iso(alert.sent_at),
    }


@router.get("")
def list_(auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    return [alert_view(alert) for alert in list_alerts(db, auth.account.id)]


@router.post("")
def create(body: AlertIn, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    alert = create_alert(db, auth.account.id, body.productId, body.variantId)
    db.refresh(alert)
    alert = db.get(
        RestockAlert,
        alert.id,
        options=[joinedload(RestockAlert.store), joinedload(RestockAlert.product), joinedload(RestockAlert.variant)],
    )
    return alert_view(alert)


@router.delete("/{alert_id}", status_code=204)
def cancel(alert_id: uuid.UUID, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    cancel_alert(db, auth.account.id, alert_id)
    return Response(status_code=204)
