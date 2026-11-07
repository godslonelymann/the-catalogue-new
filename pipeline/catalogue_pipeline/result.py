"""The answers the pipeline gives. The backend reads these. It never parses printed text."""

from dataclasses import dataclass, field
from enum import StrEnum


class Outcome(StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"
    RETRY_LATER = "retry_later"


class Reason(StrEnum):
    # Rejected: the address or the store is not one we support.
    INVALID_URL = "invalid_url"
    PRODUCT_PAGE = "product_page"
    NOT_SHOPIFY = "not_shopify"
    NO_CURRENCY = "no_currency"
    RESTRICTED = "restricted"
    HOMEPAGE_ERROR = "homepage_error"
    FEED_UNREADABLE = "feed_unreadable"
    FEED_INVALID = "feed_invalid"
    FEED_EMPTY = "feed_empty"
    REDIRECT_ELSEWHERE = "redirect_elsewhere"
    TOO_MANY_REDIRECTS = "too_many_redirects"
    CATALOGUE_TOO_LARGE = "catalogue_too_large"
    RESPONSE_TOO_LARGE = "response_too_large"
    TLS_FAILED = "tls_failed"
    PRIVATE_ADDRESS = "private_address"
    SHOP_CHANGED = "shop_changed"
    # Retry later: the store may work, but not now.
    UNREACHABLE = "unreachable"
    TIMEOUT = "timeout"
    RATE_LIMITED = "rate_limited"
    SERVER_BUSY = "server_busy"


RETRY_REASONS = frozenset({Reason.UNREACHABLE, Reason.TIMEOUT, Reason.RATE_LIMITED, Reason.SERVER_BUSY})

MESSAGES: dict[Reason, str] = {
    Reason.INVALID_URL: "Enter a full store address, such as https://fugazee.com.",
    Reason.PRODUCT_PAGE: "Enter the store’s home page, not a product page.",
    Reason.NOT_SHOPIFY: "We could not confirm that this is a Shopify store.",
    Reason.NO_CURRENCY: "We could not find the store’s currency.",
    Reason.RESTRICTED: "The store is password-protected or blocks access.",
    Reason.HOMEPAGE_ERROR: "The store’s home page did not load.",
    Reason.FEED_UNREADABLE: "The store’s product list could not be read.",
    Reason.FEED_INVALID: "The store’s product list has missing or invalid data.",
    Reason.FEED_EMPTY: "The store has no products to import.",
    Reason.REDIRECT_ELSEWHERE: "The store’s product list moved to a different website.",
    Reason.TOO_MANY_REDIRECTS: "The store sent too many redirects.",
    Reason.CATALOGUE_TOO_LARGE: "The store has more products than we support.",
    Reason.RESPONSE_TOO_LARGE: "The store sent a response that is too large.",
    Reason.TLS_FAILED: "The store’s secure connection could not be verified.",
    Reason.PRIVATE_ADDRESS: "The store address does not point to a public website.",
    Reason.SHOP_CHANGED: "This address now belongs to a different Shopify store.",
    Reason.UNREACHABLE: "We couldn’t reach this store. Try again later.",
    Reason.TIMEOUT: "The store took too long to answer. Try again later.",
    Reason.RATE_LIMITED: "The store asked us to slow down. Try again later.",
    Reason.SERVER_BUSY: "The store is having problems. Try again later.",
}


def outcome_for(reason: Reason) -> Outcome:
    return Outcome.RETRY_LATER if reason in RETRY_REASONS else Outcome.REJECTED


class CheckFailed(Exception):
    """Stops a check. Carries the reason, so callers turn it into a result."""

    def __init__(self, reason: Reason, detail: str | None = None):
        super().__init__(detail or MESSAGES[reason])
        self.reason = reason
        self.detail = detail or MESSAGES[reason]


@dataclass(frozen=True)
class StoreIdentity:
    """Who the store is. `shop_domain` (such as fugazee.myshopify.com) never changes, so it is the store ID."""

    shop_domain: str
    storefront_host: str
    currency: str
    name: str

    @property
    def storefront_url(self) -> str:
        return f"https://{self.storefront_host}/"


@dataclass(frozen=True)
class CheckResult:
    outcome: Outcome
    reason: Reason | None
    message: str
    # The host the person typed, normalised. Set when the address was valid.
    input_host: str | None = None
    identity: StoreIdentity | None = None

    @property
    def approved(self) -> bool:
        return self.outcome is Outcome.APPROVED

    @classmethod
    def failed(cls, error: CheckFailed, input_host: str | None = None) -> "CheckResult":
        return cls(outcome_for(error.reason), error.reason, error.detail, input_host)


@dataclass(frozen=True)
class CatalogueResult:
    outcome: Outcome
    reason: Reason | None
    message: str
    # Raw, validated Shopify products. Empty unless the outcome is APPROVED.
    products: list[dict] = field(default_factory=list)
    pages: int = 0

    @property
    def approved(self) -> bool:
        return self.outcome is Outcome.APPROVED
