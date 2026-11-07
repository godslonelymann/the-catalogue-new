"""Store routes: list, add (checked by the pipeline), and remove."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..errors import not_found
from ..sessions import Auth, require_auth
from ..stores.checker import StoreChecker, get_store_checker
from ..stores.models import AccountStore, Store
from ..stores.service import BRAND_LIMIT, account_brand_ids, add_store, remove_store, run_import

router = APIRouter(prefix="/api/stores", tags=["stores"])


class AddStoreIn(BaseModel):
    url: str = Field(max_length=2048)


def iso(value) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def store_view(entry: AccountStore) -> dict:
    store = entry.store
    return {
        "id": str(store.id),
        "brandId": str(store.brand_id),
        "brandName": store.brand.name,
        "name": store.name,
        "url": f"https://{store.primary_host}/",
        "host": store.primary_host,
        "status": store.import_status,
        "lastCheckFailed": store.last_check_failed,
        "lastSuccessfulCheckAt": iso(store.last_successful_check_at),
        "productCount": store.product_count,
        "addedAt": iso(entry.added_at),
    }


def _entries(db: Session, account_id: uuid.UUID):
    return db.scalars(
        select(AccountStore)
        .where(AccountStore.account_id == account_id)
        .options(joinedload(AccountStore.store).joinedload(Store.brand))
        .order_by(AccountStore.added_at)
    ).all()


@router.get("")
def list_stores(auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    stores = [store_view(entry) for entry in _entries(db, auth.account.id)]
    return {"stores": stores, "brandCount": len(account_brand_ids(db, auth.account.id)), "brandLimit": BRAND_LIMIT}


@router.post("")
def add(
    body: AddStoreIn,
    background: BackgroundTasks,
    auth: Auth = Depends(require_auth),
    db: Session = Depends(get_db),
    checker: StoreChecker = Depends(get_store_checker),
):
    result = add_store(db, auth.account.id, body.url, checker)
    if result.import_store_id is not None:
        background.add_task(run_import, result.import_store_id, checker)
    entry = db.scalars(
        select(AccountStore)
        .where(AccountStore.id == result.entry.id)
        .options(joinedload(AccountStore.store).joinedload(Store.brand))
    ).one()
    return {"store": store_view(entry), "created": result.created}


@router.delete("/{store_id}", status_code=204)
def remove(store_id: uuid.UUID, auth: Auth = Depends(require_auth), db: Session = Depends(get_db)):
    if not remove_store(db, auth.account.id, store_id):
        raise not_found()
    return Response(status_code=204)
