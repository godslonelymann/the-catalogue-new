"""Catalogue updates for the stores an account monitors: price drops, price rises, restocks, and sell-outs."""

from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..sessions import Auth, require_auth
from ..stores.models import READY, AccountStore, CatalogueUpdate, Product, Store
from .stores import iso

router = APIRouter(prefix="/api/updates", tags=["updates"])

LIMIT = 200


@router.get("")
def list_updates(
    kind: Literal["", "price_drop", "price_rise", "restock", "sold_out"] = "",
    auth: Auth = Depends(require_auth),
    db: Session = Depends(get_db),
):
    query = (
        select(CatalogueUpdate, Product, Store)
        .join(Product, Product.id == CatalogueUpdate.product_id)
        .join(Store, Store.id == CatalogueUpdate.store_id)
        .join(AccountStore, (AccountStore.store_id == Store.id) & (AccountStore.account_id == auth.account.id))
        .where(Store.import_status == READY, Product.removed_at.is_(None))
        .order_by(CatalogueUpdate.at.desc(), CatalogueUpdate.id)
        .limit(LIMIT)
    )
    if kind:
        query = query.where(CatalogueUpdate.kind == kind)
    return [
        {
            "id": str(update.id),
            "kind": update.kind,
            "storeId": str(store.id),
            "storeName": store.name,
            "productId": str(product.id),
            "productTitle": product.title,
            "imageUrl": product.image_url or "",
            "variantTitle": update.variant_title,
            "currency": store.currency,
            "oldPrice": update.old_price,
            "newPrice": update.new_price,
            "at": iso(update.at),
        }
        for update, product, store in db.execute(query)
    ]
