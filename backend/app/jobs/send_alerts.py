"""
Sends restock emails that are due, without a refresh. The daily refresh also does this.
Run it more often (for example every hour) so a failed send is tried again sooner:

    cd backend && uv run python -m app.jobs.send_alerts

An alert is tried up to 5 times. It is marked sent only after the SMTP server accepts the email.
"""

import logging

from ..alerts.service import send_restock_emails
from ..emails import get_email_sender


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    counts = send_restock_emails(get_email_sender())
    logging.getLogger("app.jobs.send_alerts").info("Restock emails: %d sent, %d failed", counts["sent"], counts["failed"])
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
