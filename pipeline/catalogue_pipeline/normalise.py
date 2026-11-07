"""Turns validated Shopify products into plain records. Prices become integers in the currency's minor unit."""

import html
import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from .detect import clean_label

ZERO_DECIMAL = frozenset("BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF".split())
THREE_DECIMAL = frozenset("BHD IQD JOD KWD LYD OMR TND".split())
COLOUR_NAMES = frozenset({"colour", "color"})
TAG = re.compile(r"<[^>]+>")
BLOCK_TAG = re.compile(r"</?(?:p|br|li|div|h[1-6])\b[^>]*>", re.IGNORECASE)


def minor_digits(currency: str) -> int:
    return 0 if currency in ZERO_DECIMAL else 3 if currency in THREE_DECIMAL else 2


def to_minor(value: object, currency: str) -> int | None:
    if value is None or value == "":
        return None
    amount = Decimal(str(value)) * (10 ** minor_digits(currency))
    return int(amount.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def plain_text(body_html: object, limit: int = 5000) -> str:
    if not isinstance(body_html, str):
        return ""
    text = html.unescape(TAG.sub("", BLOCK_TAG.sub("\n", body_html)))
    lines = (" ".join(line.split()) for line in text.splitlines())
    return "\n".join(line for line in lines if line)[:limit]


def https_url(value: object) -> str | None:
    if isinstance(value, str) and value.startswith("//"):
        value = "https:" + value
    return value if isinstance(value, str) and value.startswith("https://") and len(value) <= 2048 else None


@dataclass(frozen=True)
class VariantRecord:
    shopify_id: int
    title: str
    options: list[str]
    price: int
    compare_at_price: int | None
    available: bool
    sku: str | None
    image_url: str | None
    # The values of the product's size and colour options, when it has them.
    size: str | None = None
    colour: str | None = None


@dataclass(frozen=True)
class ProductRecord:
    shopify_id: int
    handle: str
    title: str
    description: str
    vendor: str | None
    product_type: str | None
    tags: list[str]
    url: str
    image_url: str | None
    image_alt: str
    options: list[dict]
    variants: list[VariantRecord]

    @property
    def min_price(self) -> int:
        return min(v.price for v in self.variants)

    @property
    def max_price(self) -> int:
        return max(v.price for v in self.variants)

    @property
    def compare_at_price(self) -> int | None:
        cheapest = min(self.variants, key=lambda v: v.price)
        return cheapest.compare_at_price

    @property
    def in_stock(self) -> bool:
        return any(v.available for v in self.variants)

    @property
    def colour_count(self) -> int:
        colours = next((o["values"] for o in self.options if o["name"].lower() in COLOUR_NAMES), None)
        return len(colours) if colours else 1


def _options(product: dict) -> list[tuple[int, str, list[str]]]:
    """(index, name, values) for each real option. Shopify's placeholder "Title" option is left out."""
    result = []
    for index, option in enumerate((product.get("options") or [])[:3]):
        if not isinstance(option, dict):
            continue
        name = clean_label(option.get("name"), 60)
        values = [label for value in option.get("values") or [] if (label := clean_label(value, 120))]
        if name and values and name.lower() != "title":
            result.append((index, name, values))
    return result


def _option_index(options: list[tuple[int, str, list[str]]], match) -> int | None:
    return next((position for position, (_, name, _) in enumerate(options) if match(name.lower())), None)


def _tags(value: object) -> list[str]:
    items = value if isinstance(value, list) else str(value or "").split(",")
    return [tag for item in items if (tag := clean_label(item, 60))][:50]


def normalise_product(product: dict, storefront_host: str, currency: str) -> ProductRecord:
    images = [image for image in product.get("images") or [] if isinstance(image, dict)]
    images_by_id = {image.get("id"): https_url(image.get("src")) for image in images}
    first = images[0] if images else {}
    product_options = _options(product)
    size_at = _option_index(product_options, lambda name: "size" in name)
    colour_at = _option_index(product_options, lambda name: name in COLOUR_NAMES)
    variants = []
    for variant in product["variants"]:
        price = to_minor(variant["price"], currency) or 0
        compare = to_minor(variant.get("compare_at_price"), currency)
        # One value per product option, in the same order as ProductRecord.options.
        options = [clean_label(variant.get(f"option{index + 1}"), 120) or "" for index, _, _ in product_options]
        featured = variant.get("featured_image")
        image = https_url(featured.get("src")) if isinstance(featured, dict) else images_by_id.get(variant.get("image_id"))
        variants.append(
            VariantRecord(
                shopify_id=variant["id"],
                title=clean_label(variant.get("title")) or " / ".join(options) or "Default",
                options=options,
                price=price,
                compare_at_price=compare if compare is not None and compare > price else None,
                available=variant["available"],
                sku=clean_label(variant.get("sku"), 100),
                image_url=image,
                size=options[size_at] or None if size_at is not None else None,
                colour=options[colour_at] or None if colour_at is not None else None,
            )
        )
    title = clean_label(product.get("title"), 300) or f"Product {product['id']}"
    return ProductRecord(
        shopify_id=product["id"],
        handle=product["handle"][:255],
        title=title,
        description=plain_text(product.get("body_html")),
        vendor=clean_label(product.get("vendor")),
        product_type=clean_label(product.get("product_type")),
        tags=_tags(product.get("tags")),
        url=f"https://{storefront_host}/products/{product['handle']}"[:2048],
        image_url=https_url(first.get("src")),
        image_alt=clean_label(first.get("alt"), 300) or title,
        options=[{"name": name, "values": values} for _, name, values in product_options],
        variants=variants,
    )
