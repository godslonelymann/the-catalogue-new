"""
Store tables.

A store is one Shopify shop, keyed by its fixed shop name (such as fugazee.myshopify.com).
Every address that leads to it (fugazee.com, www.fugazee.com) is a row in store_hosts.
Stores on one registrable domain share a brand. An account's brand limit counts brands.
"""

import uuid
from datetime import datetime

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base

# Store.approval
PENDING = "pending"  # The quick check passed. The full import has not finished yet.
APPROVED = "approved"  # Every product page loaded. Later adds reuse this result.
REJECTED = "rejected"  # The full import found a problem. The next add checks again.
REVOKED = "revoked"  # A daily re-check found that the store left Shopify or changed shop.

# Store.import_status (the frontend's StoreStatus)
IMPORTING = "importing"
READY = "ready"
IMPORT_FAILED = "import_failed"


def _id() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def _now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Brand(Base):
    __tablename__ = "brands"

    id: Mapped[uuid.UUID] = _id()
    key: Mapped[str] = mapped_column(String(253), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = _now()


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[uuid.UUID] = _id()
    shop_domain: Mapped[str] = mapped_column(String(253), unique=True, nullable=False)
    brand_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("brands.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    primary_host: Mapped[str] = mapped_column(String(253), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    approval: Mapped[str] = mapped_column(String(16), nullable=False, default=PENDING)
    approval_reason: Mapped[str | None] = mapped_column(String(64))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    import_status: Mapped[str] = mapped_column(String(16), nullable=False, default=IMPORTING)
    import_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_successful_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_check_failed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    product_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = _now()

    brand: Mapped[Brand] = relationship()


class StoreHost(Base):
    """Every address that reaches a store. Lets a repeat add skip the check."""

    __tablename__ = "store_hosts"

    host: Mapped[str] = mapped_column(String(253), primary_key=True)
    store_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True, nullable=False)


class AccountStore(Base):
    __tablename__ = "account_stores"
    __table_args__ = (UniqueConstraint("account_id", "store_id", name="uq_account_stores_account_store"),)

    id: Mapped[uuid.UUID] = _id()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False)
    store_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True, nullable=False)
    added_at: Mapped[datetime] = _now()

    store: Mapped[Store] = relationship()


class StoreCheckFailure(Base):
    """Short memory of failed checks, by host. Stops one bad store from being checked again and again."""

    __tablename__ = "store_check_failures"

    host: Mapped[str] = mapped_column(String(253), primary_key=True)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("store_id", "shopify_id", name="uq_products_store_shopify"),)

    id: Mapped[uuid.UUID] = _id()
    store_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True, nullable=False)
    shopify_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    handle: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    vendor: Mapped[str | None] = mapped_column(String(120))
    product_type: Mapped[str | None] = mapped_column(String(120))
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(2048))
    image_alt: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    options: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Prices are integers in the store currency's minor unit (paise for INR).
    min_price: Mapped[int] = mapped_column(BigInteger, nullable=False)
    max_price: Mapped[int] = mapped_column(BigInteger, nullable=False)
    compare_at_price: Mapped[int | None] = mapped_column(BigInteger)
    in_stock: Mapped[bool] = mapped_column(Boolean, nullable=False)
    colour_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Set when a refresh no longer finds the product. Kept for alerts and history.
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    variants: Mapped[list["Variant"]] = relationship(back_populates="product", cascade="all, delete-orphan")


class Variant(Base):
    __tablename__ = "variants"
    __table_args__ = (UniqueConstraint("product_id", "shopify_id", name="uq_variants_product_shopify"),)

    id: Mapped[uuid.UUID] = _id()
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False)
    shopify_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    options: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    price: Mapped[int] = mapped_column(BigInteger, nullable=False)
    compare_at_price: Mapped[int | None] = mapped_column(BigInteger)
    available: Mapped[bool] = mapped_column(Boolean, nullable=False)
    sku: Mapped[str | None] = mapped_column(String(100))
    image_url: Mapped[str | None] = mapped_column(String(2048))
    # Copied from the product's size and colour options, for the catalogue filters.
    size: Mapped[str | None] = mapped_column(String(120), index=True)
    colour: Mapped[str | None] = mapped_column(String(120))
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    product: Mapped[Product] = relationship(back_populates="variants")


class PricePoint(Base):
    """A dated price. Rows with a variant are that variant's price. Rows without one are the product's lowest price.
    A row is added on the first import and on each change, so the list stays short."""

    __tablename__ = "price_points"

    id: Mapped[uuid.UUID] = _id()
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False)
    variant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("variants.id", ondelete="CASCADE"), index=True)
    price: Mapped[int] = mapped_column(BigInteger, nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Relationships let the ORM insert new products and variants before their price points.
    product: Mapped[Product] = relationship()
    variant: Mapped[Variant | None] = relationship()


# CatalogueUpdate.kind
PRICE_DROP = "price_drop"
PRICE_RISE = "price_rise"
RESTOCK = "restock"
SOLD_OUT = "sold_out"


class CatalogueUpdate(Base):
    """A change found by a refresh. No variant means the same change happened to every option of the product."""

    __tablename__ = "catalogue_updates"

    id: Mapped[uuid.UUID] = _id()
    store_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False)
    variant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("variants.id", ondelete="CASCADE"))
    variant_title: Mapped[str | None] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    old_price: Mapped[int | None] = mapped_column(BigInteger)
    new_price: Mapped[int | None] = mapped_column(BigInteger)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    product: Mapped[Product] = relationship()
    variant: Mapped[Variant | None] = relationship()

    __table_args__ = (Index("ix_catalogue_updates_store_at", "store_id", "at"),)
