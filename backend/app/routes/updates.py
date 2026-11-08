"""Catalogue updates for the stores an account monitors: price drops, price rises, restocks, and sell-outs.

Each update also returns the product's state now, because an update is a record of one check.
A size that came back in stock on Monday can be sold out again on Tuesday.
"""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from ..alerts.models import CANCELLED, RestockAlert
from ..db import get_db
from ..errors import ApiError
from ..sessions import Auth, require_auth
from ..stores.models import READY, AccountStore, CatalogueUpdate, Product, Store, Variant
from ..wishlist.models import WishlistItem
from .stores import iso

router = APIRouter(prefix="/api/updates", tags=["updates"])

LIMIT = 200


@router.get("")
def list_updates(
    kind: Literal["", "price_drop", "price_rise", "restock", "sold_out"] = "",
    before: uuid.UUID | None = None,
    auth: Auth = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Newest first, LIMIT at a time. Pass the last id as `before` to get the next older page."""
    query = (
        select(CatalogueUpdate, Product, Store, Variant)
        .join(Product, Product.id == CatalogueUpdate.product_id)
        .join(Store, Store.id == CatalogueUpdate.store_id)
        .join(AccountStore, (AccountStore.store_id == Store.id) & (AccountStore.account_id == auth.account.id))
        .outerjoin(Variant, Variant.id == CatalogueUpdate.variant_id)
        .where(Store.import_status == READY, Product.removed_at.is_(None))
        .order_by(CatalogueUpdate.at.desc(), CatalogueUpdate.id)
        .limit(LIMIT)
    )
    if kind:
        query = query.where(CatalogueUpdate.kind == kind)
    if before:
        cursor = db.get(CatalogueUpdate, before)
        if cursor is None:
            raise ApiError(422, "invalid_request", "That page of updates is no longer available. Reload the page.")
        query = query.where(
            or_(CatalogueUpdate.at < cursor.at, and_(CatalogueUpdate.at == cursor.at, CatalogueUpdate.id > cursor.id))
        )

    rows = db.execute(query).all()
    product_ids = {product.id for _, product, _, _ in rows}
    saved: set[uuid.UUID] = set()
    watched_variants: set[uuid.UUID] = set()
    watched_products: set[uuid.UUID] = set()
    if product_ids:
        saved = set(
            db.scalars(
                select(WishlistItem.product_id).where(
                    WishlistItem.account_id == auth.account.id, WishlistItem.product_id.in_(product_ids)
                )
            )
        )
        for product_id, variant_id in db.execute(
            select(RestockAlert.product_id, RestockAlert.variant_id).where(
                RestockAlert.account_id == auth.account.id,
                RestockAlert.status != CANCELLED,
                RestockAlert.product_id.in_(product_ids),
            )
        ):
            watched_products.add(product_id)
            watched_variants.add(variant_id)

    items = []
    for update, product, store, variant in rows:
        if update.variant_id is None:
            # The change covered every option, so the product's own state is the answer.
            now_available, now_price = product.in_stock, product.min_price
            watched = product.id in watched_products
        elif variant is None or variant.removed_at is not None:
            now_available, now_price = None, None
            watched = update.variant_id in watched_variants
        else:
            now_available, now_price = variant.available, variant.price
            watched = update.variant_id in watched_variants
        items.append(
            {
                "id": str(update.id),
                "kind": update.kind,
                "storeId": str(store.id),
                "storeName": store.name,
                "productId": str(product.id),
                "productTitle": product.title,
                "imageUrl": product.image_url or "",
                "variantId": str(update.variant_id) if update.variant_id else None,
                "variantTitle": update.variant_title,
                "currency": store.currency,
                "oldPrice": update.old_price,
                "newPrice": update.new_price,
                "at": iso(update.at),
                "nowAvailable": now_available,
                "nowPrice": now_price,
                "saved": product.id in saved,
                "watched": watched,
            }
        )
    return items
