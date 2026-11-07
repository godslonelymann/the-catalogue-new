"""
Saves an imported catalogue and records what changed.

- Products and variants that disappear are marked removed, not deleted.
- A price point is saved for a new variant and for each price change, so price history stays short.
- A refresh (not the first import) records updates: price drop, price rise, back in stock, and sold out.
  When every option of a product has the same change, one update covers the whole product.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from catalogue_pipeline import ProductRecord
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import PRICE_DROP, PRICE_RISE, RESTOCK, SOLD_OUT, CatalogueUpdate, PricePoint, Product, Store, Variant


@dataclass
class _Changes:
    """Changes to variants that were already listed before this import."""

    tracked: int = 0
    prices: list[tuple[Variant, int, int]] = field(default_factory=list)
    restocked: list[Variant] = field(default_factory=list)
    sold_out: list[Variant] = field(default_factory=list)


def save_catalogue(db: Session, store: Store, records: list[ProductRecord], now: datetime, record_updates: bool) -> int:
    """Returns the number of updates recorded."""
    existing = {
        product.shopify_id: product
        for product in db.scalars(select(Product).where(Product.store_id == store.id).options(selectinload(Product.variants)))
    }
    seen: set[int] = set()
    updates = 0
    for record in records:
        seen.add(record.shopify_id)
        product = existing.get(record.shopify_id)
        known = product is not None and product.removed_at is None
        if product is None:
            product = Product(id=uuid.uuid4(), store_id=store.id, shopify_id=record.shopify_id)
            db.add(product)
        old_min = product.min_price if known else None
        product.handle = record.handle
        product.title = record.title
        product.description = record.description
        product.vendor = record.vendor
        product.product_type = record.product_type
        product.tags = record.tags
        product.url = record.url
        product.image_url = record.image_url
        product.image_alt = record.image_alt
        product.options = record.options
        product.min_price = record.min_price
        product.max_price = record.max_price
        product.compare_at_price = record.compare_at_price
        product.in_stock = record.in_stock
        product.colour_count = record.colour_count
        product.removed_at = None
        product.updated_at = now
        if old_min != product.min_price:
            db.add(PricePoint(product=product, variant=None, price=product.min_price, at=now))

        changes = _save_variants(db, product, record, now)
        if record_updates and known:
            updates += _record_updates(db, store, product, changes, now)

    for shopify_id, product in existing.items():
        if shopify_id not in seen and product.removed_at is None:
            product.removed_at = now
    return updates


def _save_variants(db: Session, product: Product, record: ProductRecord, now: datetime) -> _Changes:
    current = {variant.shopify_id: variant for variant in product.variants}
    changes = _Changes()
    seen: set[int] = set()
    for item in record.variants:
        seen.add(item.shopify_id)
        variant = current.get(item.shopify_id)
        known = variant is not None and variant.removed_at is None
        if variant is None:
            variant = Variant(id=uuid.uuid4(), shopify_id=item.shopify_id)
            product.variants.append(variant)
        if known:
            changes.tracked += 1
            if variant.price != item.price:
                changes.prices.append((variant, variant.price, item.price))
            if not variant.available and item.available:
                changes.restocked.append(variant)
            if variant.available and not item.available:
                changes.sold_out.append(variant)
        if not known or variant.price != item.price:
            db.add(PricePoint(product=product, variant=variant, price=item.price, at=now))
        variant.title = item.title[:255]
        variant.options = item.options
        variant.price = item.price
        variant.compare_at_price = item.compare_at_price
        variant.available = item.available
        variant.sku = item.sku
        variant.image_url = item.image_url
        variant.size = item.size
        variant.colour = item.colour
        variant.removed_at = None
    for shopify_id, variant in current.items():
        if shopify_id not in seen and variant.removed_at is None:
            variant.removed_at = now
    return changes


def _variant_title(variant: Variant) -> str | None:
    return " / ".join(variant.options) if variant.options else None


def _record_updates(db: Session, store: Store, product: Product, changes: _Changes, now: datetime) -> int:
    rows: list[CatalogueUpdate] = []

    def add(kind: str, variant: Variant | None, old: int | None = None, new: int | None = None) -> None:
        rows.append(
            CatalogueUpdate(
                store_id=store.id,
                product=product,
                variant=variant,
                variant_title=_variant_title(variant) if variant else None,
                kind=kind,
                old_price=old,
                new_price=new,
                at=now,
            )
        )

    whole_product = changes.tracked > 1
    if changes.prices:
        same = len({(old, new) for _, old, new in changes.prices}) == 1
        if whole_product and same and len(changes.prices) == changes.tracked:
            _, old, new = changes.prices[0]
            add(PRICE_DROP if new < old else PRICE_RISE, None, old, new)
        else:
            for variant, old, new in changes.prices:
                add(PRICE_DROP if new < old else PRICE_RISE, variant, old, new)

    for kind, variants in ((RESTOCK, changes.restocked), (SOLD_OUT, changes.sold_out)):
        if whole_product and variants and len(variants) == changes.tracked:
            add(kind, None)
        else:
            for variant in variants:
                add(kind, variant)

    db.add_all(rows)
    return len(rows)
