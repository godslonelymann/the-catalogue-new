"""Catalogue routes, with products imported through the fake pipeline."""

import pytest
from catalogue_pipeline import CatalogueResult, Outcome
from sqlalchemy import text

from app.db import get_engine
from app.routes.products import size_sort_key

from .conftest import signup
from .store_fixtures import add, approved_catalogue


def tee(pid: int, title: str, price: str, stock: dict[tuple[str, str], bool]) -> dict:
    """A product with Colour and Size options. `stock` maps (colour, size) to availability."""
    colours = sorted({colour for colour, _ in stock})
    sizes = sorted({size for _, size in stock}, key=size_sort_key)
    return {
        "id": pid,
        "handle": f"p-{pid}",
        "title": title,
        "body_html": "<p>Heavy cotton.</p>",
        "options": [{"name": "Colour", "values": colours}, {"name": "Size", "values": sizes}],
        "images": [{"id": 1, "src": f"https://cdn.shopify.com/{pid}.jpg", "alt": f"{title} photo"}],
        "variants": [
            {
                "id": pid * 100 + number,
                "title": f"{colour} / {size}",
                "option1": colour,
                "option2": size,
                "price": price,
                "compare_at_price": None,
                "available": available,
            }
            for number, ((colour, size), available) in enumerate(stock.items())
        ],
    }


CATALOGUE = [
    tee(1, "Racer Tee", "999.00", {("Black", "S"): True, ("Black", "M"): False}),
    tee(2, "Boxy Shirt", "1999.00", {("Olive", "M"): False, ("Olive", "L"): False}),
    tee(3, "Field Jacket", "4999.00", {("Black", "XL"): True}),
]


@pytest.fixture
def store_id(user, checker):
    checker.catalogues["fugazee.myshopify.com"] = approved_catalogue(*CATALOGUE)
    return add(user, "fugazee.com").json()["store"]["id"]


def products(client, store_id, **params):
    response = client.get(f"/api/stores/{store_id}/products", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def titles(body) -> list[str]:
    return [item["title"] for item in body["items"]]


def test_lists_the_imported_catalogue(user, store_id):
    body = products(user, store_id)
    assert body["store"]["id"] == store_id
    assert titles(body) == ["Field Jacket", "Boxy Shirt", "Racer Tee"]  # Newest Shopify ID first.
    assert body["total"] == 3 and body["nextCursor"] is None
    assert body["sizes"] == ["S", "M", "L", "XL"]
    racer = body["items"][2]
    assert racer == {
        "id": racer["id"],
        "storeId": store_id,
        "title": "Racer Tee",
        "imageUrl": "https://cdn.shopify.com/1.jpg",
        "imageAlt": "Racer Tee photo",
        "currency": "INR",
        "price": 99900,
        "maxPrice": 99900,
        "compareAtPrice": None,
        "inStock": True,
        "colourCount": 1,
        "saved": False,
    }


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"q": "tee"}, ["Racer Tee"]),
        ({"q": "olive"}, ["Boxy Shirt"]),  # Colour values match too.
        ({"q": "100%"}, []),  # LIKE wildcards are plain text.
        ({"size": "M"}, ["Boxy Shirt", "Racer Tee"]),
        ({"availability": "in"}, ["Field Jacket", "Racer Tee"]),
        ({"availability": "out"}, ["Boxy Shirt"]),
        ({"size": "M", "availability": "in"}, []),  # Racer Tee is in stock, but not in M.
        ({"size": "M", "availability": "out"}, ["Boxy Shirt", "Racer Tee"]),
        ({"price": "low"}, ["Racer Tee"]),
        ({"price": "mid"}, ["Boxy Shirt"]),
        ({"price": "high"}, ["Field Jacket"]),
    ],
)
def test_filters(user, store_id, params, expected):
    assert titles(products(user, store_id, **params)) == expected


def test_bad_filter_values_are_refused(user, store_id):
    response = user.get(f"/api/stores/{store_id}/products", params={"availability": "maybe"})
    assert (response.status_code, response.json()["detail"]["code"]) == (422, "invalid_request")


def test_pages_use_a_cursor(user, checker):
    many = [tee(pid, f"Tee {pid:02d}", "999.00", {("Black", "S"): True}) for pid in range(1, 16)]
    checker.catalogues["fugazee.myshopify.com"] = approved_catalogue(*many)
    store_id = add(user, "fugazee.com").json()["store"]["id"]
    first = products(user, store_id)
    assert (len(first["items"]), first["total"], first["nextCursor"]) == (12, 15, "12")
    second = products(user, store_id, cursor=first["nextCursor"])
    assert titles(second) == ["Tee 03", "Tee 02", "Tee 01"] and second["nextCursor"] is None
    assert len(products(user, store_id, cursor="junk")["items"]) == 12


def test_product_detail(user, store_id):
    racer = next(item for item in products(user, store_id)["items"] if item["title"] == "Racer Tee")
    response = user.get(f"/api/stores/{store_id}/products/{racer['id']}")
    assert response.status_code == 200, response.text
    detail = response.json()
    assert detail["storeName"] == "Fugazee"
    assert detail["description"] == "Heavy cotton."
    assert detail["url"] == "https://fugazee.com/products/p-1"
    assert detail["options"] == [{"name": "Colour", "values": ["Black"]}, {"name": "Size", "values": ["S", "M"]}]
    assert [(v["options"], v["available"], v["price"]) for v in detail["variants"]] == [
        (["Black", "S"], True, 99900),
        (["Black", "M"], False, 99900),
    ]
    assert detail["alerts"] == [] and detail["lastCheckFailed"] is False
    assert detail["priceHistory"] == [{"at": detail["lastSuccessfulCheckAt"], "price": 99900}]


def test_removed_products_are_hidden(user, checker, store_id):
    from app.jobs.refresh import refresh_all

    racer_id = next(item["id"] for item in products(user, store_id)["items"] if item["title"] == "Racer Tee")
    checker.catalogues["fugazee.myshopify.com"] = approved_catalogue(*CATALOGUE[1:])
    refresh_all(checker)
    assert titles(products(user, store_id)) == ["Field Jacket", "Boxy Shirt"]
    assert products(user, store_id)["sizes"] == ["M", "L", "XL"]
    assert user.get(f"/api/stores/{store_id}/products/{racer_id}").status_code == 404


def test_other_accounts_and_unknown_ids_get_404(user, store_id, new_client, sender):
    other = new_client()
    signup(other, sender, email="b@example.com")
    assert other.get(f"/api/stores/{store_id}/products").status_code == 404
    racer_id = products(user, store_id)["items"][0]["id"]
    assert other.get(f"/api/stores/{store_id}/products/{racer_id}").status_code == 404
    assert user.get("/api/stores/00000000-0000-0000-0000-000000000000/products").status_code == 404
    assert user.get(f"/api/stores/{store_id}/products/00000000-0000-0000-0000-000000000000").status_code == 404
    assert user.get(f"/api/stores/{store_id}/products/not-a-uuid").status_code == 422


def test_store_still_importing_shows_an_empty_list(user, checker):
    checker.catalogues["fugazee.myshopify.com"] = CatalogueResult(Outcome.RETRY_LATER, None, "busy")
    store_id = add(user, "fugazee.com").json()["store"]["id"]
    with get_engine().begin() as connection:
        connection.execute(text("UPDATE stores SET import_status = 'importing'"))
    body = products(user, store_id)
    assert (body["store"]["status"], body["items"], body["sizes"]) == ("importing", [], [])


def test_products_need_a_session(client, checker):
    assert client.get("/api/stores/00000000-0000-0000-0000-000000000000/products").status_code == 401


def test_size_order():
    assert sorted(["XL", "10", "S", "One Size", "M", "8", "XXS"], key=size_sort_key) == [
        "XXS",
        "S",
        "M",
        "XL",
        "8",
        "10",
        "One Size",
    ]
