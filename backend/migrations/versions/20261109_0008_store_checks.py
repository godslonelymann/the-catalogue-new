"""store checks: one row per catalogue read, for the daily-check grid

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "store_checks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("changes", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_store_checks_store_at", "store_checks", ["store_id", "at"], unique=False)

    # Earlier checks left no record. Days with updates show that a check passed, so start the grid from them.
    op.execute(
        """
        INSERT INTO store_checks (id, store_id, at, ok, changes)
        SELECT gen_random_uuid(), store_id, max(at), true, count(*)
        FROM catalogue_updates
        GROUP BY store_id, date_trunc('day', at)
        """
    )
    # The latest successful check, when no update marked that day.
    op.execute(
        """
        INSERT INTO store_checks (id, store_id, at, ok, changes)
        SELECT gen_random_uuid(), s.id, s.last_successful_check_at, true, 0
        FROM stores s
        WHERE s.last_successful_check_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM store_checks c
            WHERE c.store_id = s.id AND date_trunc('day', c.at) = date_trunc('day', s.last_successful_check_at)
          )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_store_checks_store_at", table_name="store_checks")
    op.drop_table("store_checks")
