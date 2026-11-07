"""
The gatekeeper. Two steps:

1. `check_store(url)`: a quick check when someone adds a store. It reads the home page, the shop
   name, the currency, and the first product page. Pass gives a StoreIdentity.
2. `read_catalogue(identity)`: reads every product page. Every page must load.
   The store is approved only when both steps pass.

Both return a result object. They never print, and they never raise for a store problem.
"""

from urllib.parse import SplitResult

from .detect import ShopMeta, read_homepage, read_meta
from .feed import fetch_page, read_all_pages
from .net import Fetcher
from .result import MESSAGES, CatalogueResult, CheckFailed, CheckResult, Outcome, Reason, StoreIdentity, outcome_for
from .urls import parse_url, storefront_homepage

BLOCKED_STATUSES = frozenset({401, 403, 430, 451})
BUSY_STATUSES = frozenset({408, 500, 502, 503, 504})
HOMEPAGE_BYTES = 2 * 1024 * 1024
META_BYTES = 64 * 1024

EMPTY_META = ShopMeta(None, None, None)


def _identify(fetcher: Fetcher, homepage: SplitResult) -> StoreIdentity:
    response = fetcher.get(homepage, accept="text/html", max_bytes=HOMEPAGE_BYTES, allow_truncated=True)
    final = response.final
    if response.status in BUSY_STATUSES:
        raise CheckFailed(Reason.SERVER_BUSY)
    if response.status in BLOCKED_STATUSES or final.path.rstrip("/") == "/password":
        raise CheckFailed(Reason.RESTRICTED)
    if response.status != 200:
        raise CheckFailed(Reason.HOMEPAGE_ERROR, f"The store’s home page did not load (HTTP {response.status}).")

    host = final.hostname
    signals = read_homepage([hop.hostname for hop in response.chain], response.body)
    meta = EMPTY_META
    if signals.shop_domain is None or signals.currency is None or signals.name is None:
        meta = _read_meta(fetcher, host)

    shop = signals.shop_domain or meta.shop_domain
    if shop is None:
        raise CheckFailed(Reason.NOT_SHOPIFY)
    # The shop's own currency comes first. The page may show a converted currency for the visitor.
    currency = meta.currency or signals.currency
    if currency is None:
        raise CheckFailed(Reason.NO_CURRENCY)
    name = meta.name or signals.name or host.removeprefix("www.").split(".")[0].replace("-", " ").title()
    return StoreIdentity(shop_domain=shop, storefront_host=host, currency=currency, name=name)


def _read_meta(fetcher: Fetcher, host: str) -> ShopMeta:
    """/meta.json is optional. A bad answer is ignored, but "slow down" or a time-out still stops the check."""
    try:
        response = fetcher.get(parse_url(f"https://{host}/meta.json"), accept="application/json", max_bytes=META_BYTES)
    except CheckFailed as error:
        if outcome_for(error.reason) is Outcome.RETRY_LATER:
            raise
        return EMPTY_META
    if response.status != 200 or response.final.hostname != host:
        return EMPTY_META
    return read_meta(response.body)


def check_store(value: str, fetcher: Fetcher | None = None) -> CheckResult:
    fetcher = fetcher or Fetcher(deadline_seconds=45)
    input_host: str | None = None
    try:
        homepage = storefront_homepage(value)
        input_host = homepage.hostname
        identity = _identify(fetcher, homepage)
        if not fetch_page(fetcher, identity.storefront_host, 1, limit=1):
            raise CheckFailed(Reason.FEED_EMPTY)
    except CheckFailed as error:
        return CheckResult.failed(error, input_host)
    return CheckResult(Outcome.APPROVED, None, "Shopify store confirmed. The first product page passed.", input_host, identity)


def read_catalogue(identity: StoreIdentity, fetcher: Fetcher | None = None) -> CatalogueResult:
    fetcher = fetcher or Fetcher(deadline_seconds=15 * 60)
    try:
        products, pages = read_all_pages(fetcher, identity.storefront_host)
    except CheckFailed as error:
        return CatalogueResult(outcome_for(error.reason), error.reason, error.detail)
    return CatalogueResult(Outcome.APPROVED, None, f"Read {len(products)} products on {pages} pages.", products, pages)


def recheck_store(identity: StoreIdentity, fetcher: Fetcher | None = None) -> CheckResult:
    """The daily re-check. The address must still be a Shopify store, and it must be the same shop."""
    result = check_store(identity.storefront_url, fetcher)
    if result.approved and result.identity and result.identity.shop_domain != identity.shop_domain:
        return CheckResult(Outcome.REJECTED, Reason.SHOP_CHANGED, MESSAGES[Reason.SHOP_CHANGED], result.input_host)
    return result
