"""Restock alerts: one account watches one exact sold-out variant and gets one email when it is back."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base
from ..models import Account
from ..stores.models import Product, Store, Variant

ACTIVE = "active"
SENT = "sent"
CANCELLED = "cancelled"


class RestockAlert(Base):
    __tablename__ = "restock_alerts"
    __table_args__ = (
        # One active alert per account and exact variant. Sent and cancelled alerts don't block a new one.
        Index(
            "uq_restock_alerts_active_variant",
            "account_id",
            "variant_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index("ix_restock_alerts_variant_status", "variant_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False)
    store_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("variants.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=ACTIVE)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Failed sends stay active and are tried again on the next run.
    send_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(255))

    account: Mapped[Account] = relationship()
    store: Mapped[Store] = relationship()
    product: Mapped[Product] = relationship()
    variant: Mapped[Variant] = relationship()
