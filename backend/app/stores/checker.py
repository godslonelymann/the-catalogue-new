"""The backend's link to the pipeline. Tests replace it with a fake through FastAPI dependency overrides."""

from typing import Protocol

from catalogue_pipeline import CatalogueResult, CheckResult, StoreIdentity, check_store, read_catalogue, recheck_store


class StoreChecker(Protocol):
    def check(self, url: str) -> CheckResult: ...

    def recheck(self, identity: StoreIdentity) -> CheckResult: ...

    def read(self, identity: StoreIdentity) -> CatalogueResult: ...


class PipelineChecker:
    """Real network checks. Each call gets its own time limit. The per-host pacer is shared by the process."""

    def check(self, url: str) -> CheckResult:
        return check_store(url)

    def recheck(self, identity: StoreIdentity) -> CheckResult:
        return recheck_store(identity)

    def read(self, identity: StoreIdentity) -> CatalogueResult:
        return read_catalogue(identity)


def get_store_checker() -> StoreChecker:
    return PipelineChecker()
