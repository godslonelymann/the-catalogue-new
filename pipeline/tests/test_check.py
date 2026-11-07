import json

import pytest

from catalogue_pipeline import Outcome, RawResponse, Reason, StoreIdentity, brand_key, check_store, read_catalogue, recheck_store
from catalogue_pipeline.normalise import normalise_product, to_minor

from .fakes import SHOP_HTML, FakeClock, FakeNet, fetcher, product, shop

IDENTITY = StoreIdentity("fugazee.myshopify.com", "fugazee.com", "INR", "Fugazee")


# --- Addresses ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "reason"),
    [
        ("https://fugazee.com/products/racer-tee", Reason.PRODUCT_PAGE),
        ("fugazee.com/collections/all/products/racer-tee", Reason.PRODUCT_PAGE),
        ("http://fugazee.com", Reason.INVALID_URL),
        ("https://127.0.0.1", Reason.INVALID_URL),
        ("https://localhost", Reason.INVALID_URL),
        ("https://user@fugazee.com", Reason.INVALID_URL),
        ("https://fugazee.com:8443", Reason.INVALID_URL),
        ("", Reason.INVALID_URL),
    ],
)
def test_rejects_bad_addresses_without_a_request(value, reason):
    net = FakeNet()
    result = check_store(value, fetcher(net))
    assert (result.outcome, result.reason) == (Outcome.REJECTED, reason)
    assert net.calls == []


def test_collection_link_checks_the_home_page():
    net = shop()
    result = check_store("https://FUGAZEE.com/collections/all?sort=new", fetcher(net))
    assert result.approved
    assert net.calls[0] == "fugazee.com/"


# --- Identity ---------------------------------------------------------------------


def test_approves_a_shopify_store_and_reads_its_identity():
    net = shop()
    result = check_store("fugazee.com", fetcher(net))
    assert result.outcome is Outcome.APPROVED
    assert result.input_host == "fugazee.com"
    assert result.identity == IDENTITY
    assert "fugazee.com/meta.json" not in net.calls  # The page had every value.


def test_www_and_bare_domain_give_the_same_shop():
    net = shop()
    net.routes["www.fugazee.com/"] = RawResponse(301, {"location": "https://fugazee.com/"}, b"")
    result = check_store("www.fugazee.com", fetcher(net))
    assert result.input_host == "www.fugazee.com"
    assert result.identity.shop_domain == "fugazee.myshopify.com"
    assert result.identity.storefront_host == "fugazee.com"


def test_meta_json_fills_missing_values_and_its_currency_wins():
    html = "<script>Shopify.routes = {}; Shopify.currency = {'active':'USD'};</script> cdn.shopify.com/"
    net = shop(html=html)
    meta = {"myshopify_domain": "fugazee.myshopify.com", "currency": "INR", "name": "Fugazee Official"}
    net.routes["fugazee.com/meta.json"] = RawResponse(200, {}, json.dumps(meta).encode())
    result = check_store("fugazee.com", fetcher(net))
    assert result.identity == StoreIdentity("fugazee.myshopify.com", "fugazee.com", "INR", "Fugazee Official")


def test_rejects_a_site_without_a_shop_name():
    net = shop(html="<html>Shopify.routes cdn.shopify.com/</html>")
    result = check_store("fugazee.com", fetcher(net))
    assert (result.outcome, result.reason) == (Outcome.REJECTED, Reason.NOT_SHOPIFY)


def test_rejects_a_store_without_a_currency():
    net = shop(html=SHOP_HTML.replace("Shopify.currency", "Shopify.other"))
    result = check_store("fugazee.com", fetcher(net))
    assert result.reason is Reason.NO_CURRENCY


def test_password_page_is_restricted():
    net = shop()
    net.routes["fugazee.com/"] = RawResponse(302, {"location": "/password"}, b"")
    net.routes["fugazee.com/password"] = RawResponse(200, {}, SHOP_HTML.encode())
    assert check_store("fugazee.com", fetcher(net)).reason is Reason.RESTRICTED


def test_redirect_to_http_is_refused():
    net = shop()
    net.routes["fugazee.com/"] = RawResponse(301, {"location": "http://fugazee.com/"}, b"")
    assert check_store("fugazee.com", fetcher(net)).outcome is Outcome.REJECTED


def test_redirect_loop_is_refused():
    net = FakeNet(
        {
            "a.com/": RawResponse(302, {"location": "https://b.com/"}, b""),
            "b.com/": RawResponse(302, {"location": "https://a.com/"}, b""),
        }
    )
    assert check_store("a.com", fetcher(net)).reason is Reason.TOO_MANY_REDIRECTS


def test_server_error_means_try_later():
    net = shop()
    net.routes["fugazee.com/"] = RawResponse(503, {}, b"")
    result = check_store("fugazee.com", fetcher(net))
    assert (result.outcome, result.reason) == (Outcome.RETRY_LATER, Reason.SERVER_BUSY)


def test_empty_first_page_is_rejected():
    net = shop([[]])
    assert check_store("fugazee.com", fetcher(net)).reason is Reason.FEED_EMPTY


def test_invalid_variant_is_rejected():
    bad = product(1)
    bad["variants"][0]["available"] = "yes"
    net = shop([[bad]])
    assert check_store("fugazee.com", fetcher(net)).reason is Reason.FEED_INVALID


# --- Politeness -------------------------------------------------------------------


def test_slow_down_reply_waits_and_retries():
    clock = FakeClock()
    net = shop()
    net.routes["fugazee.com/"] = [RawResponse(429, {"retry-after": "3"}, b""), RawResponse(200, {}, SHOP_HTML.encode())]
    result = check_store("fugazee.com", fetcher(net, clock))
    assert result.approved
    assert clock.sleeps == [3.0]


def test_long_slow_down_reply_means_try_later_without_waiting():
    clock = FakeClock()
    net = shop()
    net.routes["fugazee.com/"] = RawResponse(429, {"retry-after": "600"}, b"")
    result = check_store("fugazee.com", fetcher(net, clock))
    assert (result.outcome, result.reason) == (Outcome.RETRY_LATER, Reason.RATE_LIMITED)
    assert clock.sleeps == []


def test_requests_to_one_host_are_spaced_out():
    clock = FakeClock()
    net = shop()
    check_store("fugazee.com", fetcher(net, clock, interval=1.0))
    assert len(net.calls) == 2
    assert clock.sleeps == [1.0]


def test_whole_check_has_a_time_limit():
    clock = FakeClock()
    net = shop()
    net.routes["fugazee.com/products.json?limit=1&page=1"] = lambda: (clock.sleep(100), RawResponse(200, {}, b""))[1]
    net.routes["fugazee.com/"] = lambda: (clock.sleep(50), RawResponse(200, {}, SHOP_HTML.encode()))[1]
    result = check_store("fugazee.com", fetcher(net, clock, deadline_seconds=45))
    assert result.reason is Reason.TIMEOUT


def test_response_size_is_limited():
    net = shop()
    net.routes["fugazee.com/products.json?limit=1&page=1"] = RawResponse(200, {}, b"x" * (16 * 1024 * 1024 + 1))
    assert check_store("fugazee.com", fetcher(net)).reason is Reason.RESPONSE_TOO_LARGE


# --- Full catalogue -----------------------------------------------------------------


def test_reads_every_page_until_an_empty_one():
    first = [product(i) for i in range(1, 251)]
    net = shop([first, [product(251), product(1)]])
    result = read_catalogue(IDENTITY, fetcher(net))
    assert result.approved
    assert (len(result.products), result.pages) == (251, 2)  # Product 1 repeats on page 2 and is kept once.
    assert "fugazee.com/products.json?limit=250&page=3" in net.calls


def test_a_page_that_fails_rejects_the_catalogue():
    net = shop([[product(1)], [product(2)]])
    net.routes["fugazee.com/products.json?limit=250&page=2"] = RawResponse(404, {}, b"")
    result = read_catalogue(IDENTITY, fetcher(net))
    assert (result.outcome, result.reason, result.products) == (Outcome.REJECTED, Reason.FEED_UNREADABLE, [])


def test_a_busy_page_means_try_later():
    net = shop([[product(1)], [product(2)]])
    net.routes["fugazee.com/products.json?limit=250&page=2"] = RawResponse(502, {}, b"")
    assert read_catalogue(IDENTITY, fetcher(net)).outcome is Outcome.RETRY_LATER


def test_page_redirect_to_another_site_is_refused():
    net = shop()
    net.routes["fugazee.com/products.json?limit=250&page=1"] = RawResponse(302, {"location": "https://other.com/p.json"}, b"")
    net.routes["other.com/p.json"] = RawResponse(200, {}, b'{"products": []}')
    assert read_catalogue(IDENTITY, fetcher(net)).reason is Reason.REDIRECT_ELSEWHERE


def test_too_many_pages_is_refused():
    from catalogue_pipeline.feed import read_all_pages
    from catalogue_pipeline.result import CheckFailed

    net = shop([[product(1)], [product(2)], [product(3)]])
    with pytest.raises(CheckFailed) as error:
        read_all_pages(fetcher(net), "fugazee.com", max_pages=2)
    assert error.value.reason is Reason.CATALOGUE_TOO_LARGE


# --- Daily re-check -------------------------------------------------------------------


def test_recheck_rejects_a_store_that_became_another_shop():
    net = shop(html=SHOP_HTML.replace("fugazee.myshopify.com", "someone-else.myshopify.com"))
    result = recheck_store(IDENTITY, fetcher(net))
    assert (result.outcome, result.reason) == (Outcome.REJECTED, Reason.SHOP_CHANGED)


def test_recheck_rejects_a_store_that_left_shopify():
    net = shop(html="<html>A new website</html>")
    assert recheck_store(IDENTITY, fetcher(net)).reason is Reason.NOT_SHOPIFY


# --- Records ----------------------------------------------------------------------------


def test_normalise_uses_minor_units():
    record = normalise_product(product(7), "fugazee.com", "INR")
    assert (record.min_price, record.max_price, record.compare_at_price) == (149900, 159900, 199900)
    assert record.in_stock and record.colour_count == 2
    assert record.description == "Soft cotton"
    assert record.url == "https://fugazee.com/products/tee-7"
    assert record.variants[0].image_url == "https://cdn.shopify.com/a.jpg"
    assert record.variants[0].options == ["Black", "S"]
    assert (record.variants[1].size, record.variants[1].colour) == ("M", "White")


def test_default_title_option_is_dropped_from_products_and_variants():
    raw = product(8)
    raw["options"] = [{"name": "Title", "values": ["Default Title"]}]
    for variant in raw["variants"]:
        variant.update(option1="Default Title", option2=None)
    record = normalise_product(raw, "fugazee.com", "INR")
    assert record.options == [] and record.variants[0].options == []
    assert record.variants[0].size is None
    assert to_minor("1500", "JPY") == 1500 and to_minor("1.234", "KWD") == 1234


@pytest.mark.parametrize(
    ("host", "key"),
    [
        ("www.fugazee.com", "fugazee.com"),
        ("archive.fugazee.com", "fugazee.com"),
        ("shop.kiln.co.in", "kiln.co.in"),
        ("fugazee.myshopify.com", "fugazee.myshopify.com"),
    ],
)
def test_brand_key(host, key):
    assert brand_key(host) == key
