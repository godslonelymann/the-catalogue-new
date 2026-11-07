"""
Check one store from the terminal. The backend does not use this file.

    uv run python -m catalogue_pipeline https://fugazee.com
    uv run python -m catalogue_pipeline fugazee.com --quick --json

Exit codes: 0 approved, 1 rejected, 2 try later.
"""

import argparse
import json
import sys
from dataclasses import asdict

from .check import check_store, read_catalogue
from .result import Outcome

EXIT_CODES = {Outcome.APPROVED: 0, Outcome.REJECTED: 1, Outcome.RETRY_LATER: 2}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="catalogue_pipeline", description="Check a Shopify storefront for The Catalogue.")
    parser.add_argument("url", help="The store's main address, such as fugazee.com")
    parser.add_argument("--quick", action="store_true", help="Check the first product page only")
    parser.add_argument("--json", action="store_true", help="Print the result as JSON")
    args = parser.parse_args(argv)

    result = check_store(args.url)
    report: dict = {"outcome": result.outcome, "reason": result.reason, "message": result.message}
    if result.identity:
        report["store"] = asdict(result.identity)
    outcome = result.outcome
    if result.approved and result.identity and not args.quick:
        catalogue = read_catalogue(result.identity)
        outcome = catalogue.outcome
        report.update(outcome=catalogue.outcome, reason=catalogue.reason, message=catalogue.message)
        report["products"] = len(catalogue.products)
        report["pages"] = catalogue.pages

    if args.json:
        json.dump(report, sys.stdout, indent=2, default=str)
        print()
    else:
        print(f"Result:  {report['outcome']}")
        print(f"Reason:  {report['message']}")
        for key, value in report.get("store", {}).items():
            print(f"  {key:<16} {value}")
        if "products" in report:
            print(f"  {'products':<16} {report['products']} on {report['pages']} pages")
    return EXIT_CODES[outcome]


if __name__ == "__main__":
    raise SystemExit(main())
