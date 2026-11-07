"""Store checks and catalogue reads for The Catalogue. No database and no web framework: the backend saves the results."""

from .check import check_store, read_catalogue, recheck_store
from .net import Fetcher, HostPacer, RawResponse, Transport
from .normalise import ProductRecord, VariantRecord, normalise_product
from .result import MESSAGES, CatalogueResult, CheckFailed, CheckResult, Outcome, Reason, StoreIdentity
from .urls import brand_key, storefront_homepage

__all__ = [
    "MESSAGES",
    "CatalogueResult",
    "CheckFailed",
    "CheckResult",
    "Fetcher",
    "HostPacer",
    "Outcome",
    "ProductRecord",
    "RawResponse",
    "Reason",
    "StoreIdentity",
    "Transport",
    "VariantRecord",
    "brand_key",
    "check_store",
    "normalise_product",
    "read_catalogue",
    "recheck_store",
    "storefront_homepage",
]
