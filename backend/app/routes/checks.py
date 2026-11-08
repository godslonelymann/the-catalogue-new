"""
The daily checks of one monitored store, one entry per day, for the check grid.

    GET /api/stores/{store_id}/checks

Days are UTC calendar days. A day with no entry had no check.
"""

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import utcnow
from ..sessions import Auth, require_auth
from ..stores.models import StoreCheck
from .products import monitored_entry

router = APIRouter(prefix="/api/stores/{store_id}/checks", tags=["checks"])

DAYS = 84  # Twelve weeks, the size of the grid.


@router.get("")
def list_checks(store_id: uuid.UUID, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    store = monitored_entry(db, auth.account.id, store_id).store
    today = utcnow().date()
    start = today - timedelta(days=DAYS - 1)
    day = cast(func.timezone("UTC", StoreCheck.at), Date)
    rows = db.execute(
        select(day, func.bool_or(StoreCheck.ok), func.sum(StoreCheck.changes))
        .where(StoreCheck.store_id == store.id, day >= start)
        .group_by(day)
        .order_by(day)
    )
    return {
        "from": start.isoformat(),
        "to": today.isoformat(),
        # A day passes when any check that day passed.
        "days": [{"day": value.isoformat(), "ok": ok, "changes": int(changes or 0)} for value, ok, changes in rows],
    }
