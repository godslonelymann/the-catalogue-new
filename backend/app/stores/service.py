"""
Adding, importing, and refreshing stores. The pipeline does the network work. This module saves the results.

Auto-approve: nobody reviews stores by hand. A store is approved when the pipeline's quick check
passes and then every product page loads. Later adds reuse that saved result and send no request.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from catalogue_pipeline import CheckFailed, CheckResult, Outcome, StoreIdentity, brand_key, normalise_product, storefront_homepage
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..db import get_sessionmaker
from ..errors import ApiError
from ..models import Account
from ..security import utcnow
from ..sessions import rate_limit
from .catalogue import save_catalogue
from .checker import StoreChecker
from .models import (
    APPROVED,
    IMPORT_FAILED,
    IMPORTING,
    PENDING,
    READY,
    REJECTED,
    REVOKED,
    AccountStore,
    Brand,
    CatalogueUpdate,
    Store,
    StoreCheck,
    StoreCheckFailure,
    StoreHost,
)

log = logging.getLogger(__name__)

BRAND_LIMIT = 10
# Checks that send requests. Adds that reuse a saved result are not counted.
ADDS_PER_HOUR = 20
FAILURE_MEMORY = {Outcome.REJECTED: timedelta(hours=1), Outcome.RETRY_LATER: timedelta(minutes=10)}
STUCK_IMPORT = timedelta(minutes=30)
UPDATE_RETENTION = timedelta(days=90)
UNSUPPORTED = "Only supported Shopify stores can be added."


# --- Errors ---------------------------------------------------------------------


def _invalid_url(message: str) -> ApiError:
    return ApiError(422, "invalid_url", message)


def _check_error(outcome: str, message: str) -> ApiError:
    if outcome == Outcome.RETRY_LATER:
        return ApiError(502, "check_failed", message)
    return ApiError(422, "unsupported_store", UNSUPPORTED)


# --- Lookups ----------------------------------------------------------------------


def store_for_host(db: Session, host: str) -> Store | None:
    return db.scalar(select(Store).join(StoreHost, StoreHost.store_id == Store.id).where(StoreHost.host == host))


def reusable(store: Store | None) -> bool:
    """A saved result that a new add can use without a check."""
    return store is not None and store.approval in (APPROVED, PENDING) and store.import_status != IMPORT_FAILED


def recent_failure(db: Session, host: str) -> StoreCheckFailure | None:
    return db.scalar(select(StoreCheckFailure).where(StoreCheckFailure.host == host, StoreCheckFailure.expires_at > utcnow()))


def remember_failure(db: Session, hosts: set[str], outcome: str, reason: str, message: str) -> None:
    expires = utcnow() + FAILURE_MEMORY[Outcome(outcome)]
    for host in hosts:
        statement = insert(StoreCheckFailure).values(
            host=host, outcome=str(outcome), reason=reason, message=message, expires_at=expires
        )
        db.execute(statement.on_conflict_do_update(index_elements=["host"], set_=statement.excluded))
    db.execute(delete(StoreCheckFailure).where(StoreCheckFailure.expires_at < utcnow() - timedelta(days=1)))


def account_brand_ids(db: Session, account_id: uuid.UUID) -> set[uuid.UUID]:
    """A pending first import counts toward the limit. A failed first import does not."""
    rows = db.scalars(
        select(Store.brand_id)
        .join(AccountStore, AccountStore.store_id == Store.id)
        .where(AccountStore.account_id == account_id, Store.import_status != IMPORT_FAILED)
    )
    return set(rows)


# --- Saving an approved identity --------------------------------------------------------


def save_hosts(db: Session, store: Store, identity: StoreIdentity, hosts: set[str]) -> None:
    """Every address that passed a check for this shop. A later add of any of them skips the check."""
    for host in hosts | {identity.storefront_host, identity.shop_domain}:
        statement = insert(StoreHost).values(host=host, store_id=store.id)
        db.execute(statement.on_conflict_do_update(index_elements=["host"], set_={"store_id": store.id}))
    db.execute(delete(StoreCheckFailure).where(StoreCheckFailure.host.in_(hosts | {identity.storefront_host})))


def _upsert_store(db: Session, identity: StoreIdentity, hosts: set[str]) -> tuple[Store, bool]:
    """Returns the store for this shop and whether an import must start."""
    key = brand_key(identity.storefront_host)
    db.execute(insert(Brand).values(id=uuid.uuid4(), key=key, name=identity.name[:120]).on_conflict_do_nothing())
    brand = db.scalars(select(Brand).where(Brand.key == key)).one()

    db.execute(
        insert(Store)
        .values(
            id=uuid.uuid4(),
            shop_domain=identity.shop_domain,
            brand_id=brand.id,
            name=identity.name[:120],
            primary_host=identity.storefront_host,
            currency=identity.currency,
            approval=PENDING,
            import_status=IMPORT_FAILED,  # Changed to IMPORTING below, in the same transaction.
            last_check_failed=False,
            product_count=0,
        )
        .on_conflict_do_nothing(index_elements=["shop_domain"])
    )
    store = db.scalars(select(Store).where(Store.shop_domain == identity.shop_domain).with_for_update()).one()

    save_hosts(db, store, identity, hosts)

    if reusable(store):
        return store, False
    # New, failed, rejected, or revoked: this check passed, so import again.
    store.brand_id = brand.id
    store.name = identity.name[:120]
    store.primary_host = identity.storefront_host
    store.currency = identity.currency
    store.approval = PENDING
    # A store with an earlier catalogue keeps showing it during the new import.
    store.import_status = IMPORTING if store.last_successful_check_at is None else READY
    store.import_started_at = None
    return store, True


# --- Add ------------------------------------------------------------------------------


@dataclass
class AddResult:
    entry: AccountStore
    created: bool
    import_store_id: uuid.UUID | None


def add_store(db: Session, account_id: uuid.UUID, url: str, checker: StoreChecker) -> AddResult:
    try:
        host = storefront_homepage(url).hostname
    except CheckFailed as error:
        raise _invalid_url(error.detail) from error

    store = store_for_host(db, host)
    identity: StoreIdentity | None = None
    hosts = {host}
    if reusable(store):
        identity = StoreIdentity(store.shop_domain, store.primary_host, store.currency, store.name)
    else:
        if failure := recent_failure(db, host):
            raise _check_error(failure.outcome, failure.message)
        try:
            rate_limit(db, f"store-add:{account_id}", ADDS_PER_HOUR, 3600)
        except ApiError as error:
            raise ApiError(
                429, "rate_limited", "You’ve added many stores in a short time. Try again later.", error.headers
            ) from error
        db.commit()  # No open transaction while the network check runs.
        result: CheckResult = checker.check(url)
        if not result.approved or result.identity is None:
            log.info("Store check for %s: %s (%s)", host, result.outcome, result.reason)
            remember_failure(db, {result.input_host or host}, result.outcome, str(result.reason), result.message)
            db.commit()
            raise _check_error(result.outcome, result.message)
        identity = result.identity

    # Lock the account row, so two adds at once can't pass the brand limit together.
    db.execute(select(Account.id).where(Account.id == account_id).with_for_update())
    store = db.scalar(select(Store).where(Store.shop_domain == identity.shop_domain))
    existing = (
        db.scalar(select(AccountStore).where(AccountStore.account_id == account_id, AccountStore.store_id == store.id))
        if store
        else None
    )
    if existing and reusable(store):
        save_hosts(db, store, identity, hosts)
        db.commit()
        return AddResult(existing, False, None)
    # The account already lists this store, and its catalogue still shows. Re-adding it is not a new entry.
    already_listed = existing is not None and store is not None and store.import_status != IMPORT_FAILED

    brands = account_brand_ids(db, account_id)
    brand = db.scalar(select(Brand).where(Brand.key == brand_key(identity.storefront_host)))
    if (brand is None or brand.id not in brands) and len(brands) >= BRAND_LIMIT:
        db.rollback()
        raise ApiError(409, "brand_limit", f"You can monitor up to {BRAND_LIMIT} brands. Remove a brand to add a new one.")

    store, needs_import = _upsert_store(db, identity, hosts)
    if existing is None:
        existing = AccountStore(account_id=account_id, store_id=store.id)
        db.add(existing)
    elif not already_listed:
        existing.added_at = utcnow()
    db.commit()
    return AddResult(existing, not already_listed, store.id if needs_import else None)


def remove_store(db: Session, account_id: uuid.UUID, store_id: uuid.UUID) -> bool:
    from ..alerts.service import cancel_store_alerts
    from ..wishlist.service import remove_store_items

    cancel_store_alerts(db, account_id, store_id)
    remove_store_items(db, account_id, store_id)
    deleted = db.execute(delete(AccountStore).where(AccountStore.account_id == account_id, AccountStore.store_id == store_id))
    db.commit()
    return deleted.rowcount > 0


# --- Import -------------------------------------------------------------------------------


def identity_of(store: Store) -> StoreIdentity:
    return StoreIdentity(store.shop_domain, store.primary_host, store.currency, store.name)


def run_import(store_id: uuid.UUID, checker: StoreChecker) -> None:
    """Reads every product page and saves the catalogue. Runs after the response, in its own session."""
    with get_sessionmaker()() as db:
        store = db.get(Store, store_id)
        if store is None:
            return
        store.import_started_at = utcnow()
        identity = identity_of(store)
        db.commit()
    try:
        result = checker.read(identity)
    except Exception:  # A bug must not leave the store stuck in "importing".
        log.exception("Import of %s crashed", identity.shop_domain)
        result = None

    with get_sessionmaker()() as db:
        store = db.get(Store, store_id, with_for_update=True)
        if store is None:
            return
        now = utcnow()
        store.last_checked_at = now
        if result is not None and result.approved:
            records = [normalise_product(product, store.primary_host, store.currency) for product in result.products]
            # The first import has nothing to compare with, so it records no updates.
            changes = save_catalogue(db, store, records, now, record_updates=store.last_successful_check_at is not None)
            db.add(StoreCheck(store_id=store.id, at=now, ok=True, changes=changes))
            db.execute(
                delete(CatalogueUpdate).where(CatalogueUpdate.store_id == store.id, CatalogueUpdate.at < now - UPDATE_RETENTION)
            )
            db.execute(delete(StoreCheck).where(StoreCheck.store_id == store.id, StoreCheck.at < now - UPDATE_RETENTION))
            store.approval = APPROVED
            store.approved_at = store.approved_at or now
            store.approval_reason = None
            store.import_status = READY
            store.last_successful_check_at = now
            store.last_check_failed = False
            store.product_count = len(records)
        else:
            outcome = result.outcome if result else Outcome.RETRY_LATER
            store.approval_reason = str(result.reason) if result else "crashed"
            if store.last_successful_check_at is None:
                # A failed first import frees the brand slot. A rejected one is not approved.
                store.import_status = IMPORT_FAILED
                store.approval = REJECTED if outcome == Outcome.REJECTED else PENDING
                hosts = set(db.scalars(select(StoreHost.host).where(StoreHost.store_id == store.id)))
                remember_failure(db, hosts, outcome, store.approval_reason, result.message if result else UNSUPPORTED)
            else:
                store.import_status = READY
                store.last_check_failed = True
                db.add(StoreCheck(store_id=store.id, at=now, ok=False))
        db.commit()
        log.info("Import of %s: %s", store.shop_domain, store.import_status)


# --- Daily refresh -------------------------------------------------------------------------


def stores_to_refresh(db: Session, now: datetime) -> list[uuid.UUID]:
    """Stores that an account monitors: approved, revoked (it may come back), or an import stuck after a crash."""
    monitored = select(AccountStore.store_id).distinct()
    stuck = (Store.import_status == IMPORTING) & (
        (Store.import_started_at.is_(None) & (Store.created_at < now - STUCK_IMPORT))
        | (Store.import_started_at < now - STUCK_IMPORT)
    )
    return list(
        db.scalars(
            select(Store.id)
            .where(Store.id.in_(monitored), Store.approval.in_((APPROVED, REVOKED)) | stuck)
            .order_by(Store.primary_host)
        )
    )


def refresh_store(store_id: uuid.UUID, checker: StoreChecker) -> str:
    """Re-checks one store, then reads its catalogue. Returns what happened."""
    with get_sessionmaker()() as db:
        store = db.get(Store, store_id)
        if store is None:
            return "missing"
        identity = identity_of(store)
        first_import = store.last_successful_check_at is None

    result = checker.recheck(identity)
    if not result.approved or result.identity is None:
        with get_sessionmaker()() as db:
            store = db.get(Store, store_id, with_for_update=True)
            store.last_checked_at = utcnow()
            store.last_check_failed = True
            if not first_import:
                db.add(StoreCheck(store_id=store.id, at=store.last_checked_at, ok=False))
            store.approval_reason = str(result.reason)
            if result.outcome == Outcome.REJECTED:
                store.approval = REVOKED
                if first_import:
                    store.import_status = IMPORT_FAILED
            db.commit()
        return f"{result.outcome}: {result.reason}"

    with get_sessionmaker()() as db:
        store = db.get(Store, store_id, with_for_update=True)
        fresh = result.identity
        if fresh.storefront_host != store.primary_host:
            statement = insert(StoreHost).values(host=fresh.storefront_host, store_id=store.id)
            db.execute(statement.on_conflict_do_update(index_elements=["host"], set_={"store_id": store.id}))
        store.primary_host = fresh.storefront_host
        store.currency = fresh.currency
        db.commit()
    run_import(store_id, checker)
    with get_sessionmaker()() as db:
        return str(db.scalar(select(Store.import_status).where(Store.id == store_id)))
