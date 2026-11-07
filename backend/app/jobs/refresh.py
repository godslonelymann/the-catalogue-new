"""
The daily refresh. Run it once a day, for example from cron or a systemd timer:

    cd backend && uv run python -m app.jobs.refresh

For each monitored store it re-checks the address (a store can leave Shopify or change shop),
then reads every product page again. Stores run one at a time, and the pipeline spaces out requests.
After all stores, it sends restock emails for alerts whose option is back in stock.
"""

import argparse
import logging

from ..alerts.service import send_restock_emails
from ..db import get_sessionmaker
from ..emails import EmailSender, get_email_sender
from ..security import utcnow
from ..stores.checker import PipelineChecker, StoreChecker
from ..stores.service import refresh_store, stores_to_refresh

log = logging.getLogger("app.jobs.refresh")


def refresh_all(checker: StoreChecker, sender: EmailSender | None = None) -> dict[str, str]:
    """Refreshes every monitored store. With a sender, it then sends the restock emails that are due."""
    with get_sessionmaker()() as db:
        store_ids = stores_to_refresh(db, utcnow())
    results: dict[str, str] = {}
    for store_id in store_ids:
        try:
            results[str(store_id)] = refresh_store(store_id, checker)
        except Exception:  # One store must not stop the others.
            log.exception("Refresh of store %s crashed", store_id)
            results[str(store_id)] = "crashed"
    if sender is not None:
        counts = send_restock_emails(sender)
        log.info("Restock emails: %d sent, %d failed", counts["sent"], counts["failed"])
    return results


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter).parse_args()
    results = refresh_all(PipelineChecker(), get_email_sender())
    for store_id, outcome in results.items():
        log.info("%s %s", store_id, outcome)
    log.info("Refreshed %d stores", len(results))
    return 1 if any(outcome == "crashed" for outcome in results.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
