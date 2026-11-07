"""save alerted products: alerts now live on saved products

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Every active or sent alert's product becomes a saved product, so the alert shows on the Saved page.
    op.execute(
        """
        INSERT INTO wishlist_items (id, account_id, store_id, product_id, created_at)
        SELECT gen_random_uuid(), a.account_id, a.store_id, a.product_id, min(a.created_at)
        FROM restock_alerts a
        WHERE a.status IN ('active', 'sent')
        GROUP BY a.account_id, a.store_id, a.product_id
        ON CONFLICT (account_id, product_id) DO NOTHING
        """
    )


def downgrade() -> None:
    # Saved products stay. They are valid entries without the alerts.
    pass
