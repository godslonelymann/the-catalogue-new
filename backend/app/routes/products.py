"""
Catalogue routes for one monitored store.

    GET /api/stores/{store_id}/products?q=&size=&availability=&price=&cursor=
    GET /api/stores/{store_id}/products/{product_id}

The account must monitor the store. Until the first import is ready, the list is empty and details are 404.
Prices are integers in the store currency's minor unit.
"""

import re
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, and_, exists, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from ..alerts.service import active_alerts_for_product
from ..db import get_db
from ..errors import not_found
from ..sessions import Auth, require_auth
from ..stores.models import READY, AccountStore, PricePoint, Product, Store, Variant
from ..wishlist.service import saved_product_ids
from .stores import iso, store_view

router = APIRouter(prefix="/api/stores/{store_id}/products", tags=["products"])

PAGE_SIZE = 12
HISTORY_POINTS = 30
MAX_OFFSET = 100_000
SIZE_ORDER = {
    size: rank for rank, size in enumerate(["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL"])
}
NUMBER = re.compile(r"\d+(?:\.\d+)?")


# --- Helpers -----------------------------------------------------------------------


def monitored_entry(db: Session, account_id: uuid.UUID, store_id: uuid.UUID) -> AccountStore:
    entry = db.scalars(
        select(AccountStore)
        .where(AccountStore.account_id == account_id, AccountStore.store_id == store_id)
        .options(joinedload(AccountStore.store).joinedload(Store.brand))
    ).one_or_none()
    if entry is None:
        raise not_found()
    return entry


def size_sort_key(size: str) -> tuple:
    """Letter sizes in wearing order, then numbers in number order, then everything else A to Z."""
    upper = size.strip().upper()
    if upper in SIZE_ORDER:
        return (0, SIZE_ORDER[upper], "")
    if match := NUMBER.match(upper):
        return (1, float(match.group()), upper)
    return (2, 0, upper)


def like_pattern(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def summary(product: Product, store: Store, saved: bool = False) -> dict:
    return {
        "id": str(product.id),
        "storeId": str(store.id),
        "title": product.title,
        "imageUrl": product.image_url or "",
        "imageAlt": product.image_alt or product.title,
        "currency": store.currency,
        "price": product.min_price,
        "maxPrice": product.max_price,
        "compareAtPrice": product.compare_at_price,
        "inStock": product.in_stock,
        "colourCount": product.colour_count,
        "saved": saved,
    }


def _active_variant(*conditions):
    return exists().where(Variant.product_id == Product.id, Variant.removed_at.is_(None), *conditions)


def _price_bands(db: Session, store_id: uuid.UUID) -> tuple[float, float] | None:
    """Price bands follow the store's own prices: the cheapest third, the middle third, and the top third."""
    low, high = db.execute(
        select(
            func.percentile_cont(1 / 3).within_group(Product.min_price),
            func.percentile_cont(2 / 3).within_group(Product.min_price),
        ).where(Product.store_id == store_id, Product.removed_at.is_(None))
    ).one()
    return None if low is None else (low, high)


def filtered(db: Session, store_id: uuid.UUID, q: str, size: str, availability: str, price: str) -> Select:
    query = select(Product).where(Product.store_id == store_id, Product.removed_at.is_(None))
    if q:
        pattern = like_pattern(q)
        query = query.where(
            or_(Product.title.ilike(pattern, escape="\\"), _active_variant(Variant.colour.ilike(pattern, escape="\\")))
        )
    size_condition = [Variant.size == size] if size else []
    if size:
        query = query.where(_active_variant(*size_condition))
    if availability:
        in_stock = _active_variant(Variant.available.is_(True), *size_condition)
        query = query.where(in_stock if availability == "in" else ~in_stock)
    if price and (bands := _price_bands(db, store_id)):
        low, high = bands
        query = query.where(
            {
                "low": Product.min_price < low,
                "mid": and_(Product.min_price >= low, Product.min_price < high),
                "high": Product.min_price >= high,
            }[price]
        )
    return query


def store_sizes(db: Session, store_id: uuid.UUID) -> list[str]:
    sizes = db.scalars(
        select(Variant.size)
        .join(Product, Product.id == Variant.product_id)
        .where(
            Product.store_id == store_id, Product.removed_at.is_(None), Variant.removed_at.is_(None), Variant.size.is_not(None)
        )
        .distinct()
    )
    return sorted(sizes, key=size_sort_key)


def price_history(db: Session, product_id: uuid.UUID) -> dict[uuid.UUID | None, list[dict]]:
    """Dated prices, oldest first, keyed by variant. The key None holds the product's lowest price."""
    history: dict[uuid.UUID | None, list[dict]] = {}
    points = db.scalars(select(PricePoint).where(PricePoint.product_id == product_id).order_by(PricePoint.at, PricePoint.id))
    for point in points:
        history.setdefault(point.variant_id, []).append({"at": iso(point.at), "price": point.price})
    return {key: values[-HISTORY_POINTS:] for key, values in history.items()}


# --- Routes -------------------------------------------------------------------------


@router.get("")
def list_products(
    store_id: uuid.UUID,
    q: str = Query("", max_length=200),
    size: str = Query("", max_length=120),
    availability: Literal["", "in", "out"] = "",
    price: Literal["", "low", "mid", "high"] = "",
    cursor: str | None = Query(None, max_length=20),
    auth: Auth = Depends(require_auth),
    db: Session = Depends(get_db),
):
    entry = monitored_entry(db, auth.account.id, store_id)
    store = entry.store
    view = store_view(entry)
    if store.import_status != READY:
        return {"store": view, "items": [], "total": 0, "nextCursor": None, "sizes": []}

    offset = int(cursor) if cursor and cursor.isdigit() and int(cursor) <= MAX_OFFSET else 0
    query = filtered(db, store.id, q.strip(), size.strip(), availability, price)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    products = db.scalars(query.order_by(Product.shopify_id.desc()).offset(offset).limit(PAGE_SIZE)).all()
    saved = saved_product_ids(db, auth.account.id, [product.id for product in products])
    next_cursor = str(offset + PAGE_SIZE) if offset + PAGE_SIZE < total else None
    return {
        "store": view,
        "items": [summary(product, store, product.id in saved) for product in products],
        "total": total,
        "nextCursor": next_cursor,
        "sizes": store_sizes(db, store.id),
    }


@router.get("/{product_id}")
def get_product(store_id: uuid.UUID, product_id: uuid.UUID, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    entry = monitored_entry(db, auth.account.id, store_id)
    store = entry.store
    if store.import_status != READY:
        raise not_found()
    product = db.scalars(
        select(Product)
        .where(Product.id == product_id, Product.store_id == store.id, Product.removed_at.is_(None))
        .options(selectinload(Product.variants))
    ).one_or_none()
    if product is None:
        raise not_found()

    variants = sorted((v for v in product.variants if v.removed_at is None), key=lambda v: v.shopify_id)
    checked = iso(store.last_successful_check_at)
    history = price_history(db, product.id)
    return {
        **summary(product, store, bool(saved_product_ids(db, auth.account.id, [product.id]))),
        "storeName": store.name,
        "description": product.description,
        "url": product.url,
        "options": product.options,
        "variants": [
            {
                "id": str(variant.id),
                "title": variant.title,
                "options": variant.options,
                "price": variant.price,
                "compareAtPrice": variant.compare_at_price,
                "available": variant.available,
                "imageUrl": variant.image_url,
                "priceHistory": history.get(variant.id, []),
            }
            for variant in variants
        ],
        "priceHistory": history.get(None, []),
        "lastSuccessfulCheckAt": checked,
        "lastCheckFailed": store.last_check_failed,
        "alerts": active_alerts_for_product(db, auth.account.id, product.id),
    }
