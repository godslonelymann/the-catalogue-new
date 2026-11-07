"""A fake storefront network. Tests never send real requests."""

import json
from dataclasses import dataclass, field

from catalogue_pipeline import Fetcher, HostPacer, RawResponse

SHOP_HTML = (
    "<html><head><meta property='og:site_name' content='Fugazee'>"
    '<script>Shopify.shop = "fugazee.myshopify.com"; Shopify.currency = {"active":"INR","rate":"1.0"};'
    "Shopify.routes = {};</script><link href='//cdn.shopify.com/s/files/x.css'></head></html>"
)


def product(pid: int, price: str = "1499.00", available: bool = True) -> dict:
    return {
        "id": pid,
        "handle": f"tee-{pid}",
        "title": f"Tee {pid}",
        "body_html": "<p>Soft <b>cotton</b></p>",
        "vendor": "Fugazee",
        "product_type": "Tee",
        "tags": ["new", "tees"],
        "options": [{"name": "Colour", "values": ["Black", "White"]}, {"name": "Size", "values": ["S", "M"]}],
        "images": [{"id": 1, "src": "https://cdn.shopify.com/a.jpg", "alt": None}],
        "variants": [
            {
                "id": pid * 10 + 1,
                "title": "Black / S",
                "option1": "Black",
                "option2": "S",
                "price": price,
                "compare_at_price": "1999.00",
                "available": available,
                "sku": "B-S",
                "featured_image": None,
                "image_id": 1,
            },
            {
                "id": pid * 10 + 2,
                "title": "White / M",
                "option1": "White",
                "option2": "M",
                "price": "1599.00",
                "compare_at_price": None,
                "available": False,
                "sku": "W-M",
                "featured_image": None,
            },
        ],
    }


def page(products: list[dict]) -> RawResponse:
    return RawResponse(200, {"content-type": "application/json"}, json.dumps({"products": products}).encode())


@dataclass
class FakeNet:
    """Maps "host/target" to a response. A list of responses is used in order, one per call."""

    routes: dict[str, object] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)

    def request(self, host, target, headers, timeout, max_bytes):
        key = host + target
        self.calls.append(key)
        route = self.routes.get(key)
        if isinstance(route, list):
            route = route.pop(0) if len(route) > 1 else route[0]
        if callable(route):
            route = route()
        if route is None:
            return RawResponse(404, {}, b"")
        return route


def shop(products_pages: list[list[dict]] | None = None, host: str = "fugazee.com", html: str = SHOP_HTML) -> FakeNet:
    pages = products_pages if products_pages is not None else [[product(1), product(2)]]
    net = FakeNet()
    net.routes[f"{host}/"] = RawResponse(200, {}, html.encode())
    first = pages[0][:1] if pages else []
    net.routes[f"{host}/products.json?limit=1&page=1"] = page(first)
    for number, items in enumerate(pages + [[]], start=1):
        net.routes[f"{host}/products.json?limit=250&page={number}"] = page(items)
    return net


@dataclass
class FakeClock:
    now: float = 1000.0
    sleeps: list[float] = field(default_factory=list)

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def fetcher(net: FakeNet, clock: FakeClock | None = None, interval: float = 0.0, **kwargs) -> Fetcher:
    clock = clock or FakeClock()
    return Fetcher(
        transport=net, pacer=HostPacer(interval, clock=clock, sleep=clock.sleep), clock=clock, wall_clock=clock, **kwargs
    )
