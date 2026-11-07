// Sample store registry and catalogue for the frontend review.
// Every store and product here is sample data. The mock API sends no network requests.

import type { CatalogueUpdate, PricePoint, ProductOption } from "@/api/types";
import { artUrl, type Palette, type Shape } from "@/lib/art";

export type StoreBehaviour =
  | "fresh" // Recent catalogue data exists, so the store is ready at once.
  | "import" // The store needs a first import.
  | "import_fails" // The first import fails, so the brand slot is released.
  | "last_check_failed"; // The latest daily check failed. Show the last successful data.

export interface SampleStore {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  host: string;
  aliases: string[];
  behaviour: StoreBehaviour;
  productCount: number;
}

export interface SampleVariant {
  id: string;
  options: string[];
  price: number;
  compareAtPrice: number | null;
  available: boolean;
  imageUrl: string;
  priceHistory: PricePoint[];
}

export interface SampleProduct {
  id: string;
  storeId: string;
  title: string;
  description: string;
  url: string;
  currency: string;
  imageUrl: string;
  imageAlt: string;
  options: ProductOption[];
  variants: SampleVariant[];
  priceHistory: PricePoint[];
}

const DAY = 86_400_000;

/** Sample hosts that simulate a network failure during the store check. */
export const unreachableHosts = new Set(["offline-shop.in", "www.offline-shop.in"]);

const storeRows: [id: string, brandId: string, brandName: string, name: string, host: string, behaviour: StoreBehaviour, count: number][] = [
  ["fugazee", "fugazee", "Fugazee", "Fugazee", "fugazee.com", "fresh", 14],
  ["fugazee-archive", "fugazee", "Fugazee", "Fugazee Archive", "archive.fugazee.com", "fresh", 6],
  ["northline", "northline", "Northline", "Northline", "northline.store", "import", 8],
  ["kiln", "kiln", "Kiln & Co", "Kiln & Co", "kilnandco.in", "fresh", 7],
  ["lowtide", "lowtide", "Low Tide", "Low Tide", "lowtide.in", "last_check_failed", 6],
  ["saltwork", "saltwork", "Saltwork", "Saltwork", "saltwork.co", "fresh", 6],
  ["oddmonday", "oddmonday", "Odd Monday", "Odd Monday", "oddmonday.in", "fresh", 6],
  ["mosswear", "mosswear", "Moss Wear", "Moss Wear", "mosswear.in", "fresh", 6],
  ["ferrous", "ferrous", "Ferrous Studio", "Ferrous Studio", "ferrous.studio", "fresh", 6],
  ["papermoon", "papermoon", "Paper Moon", "Paper Moon", "papermoon.in", "fresh", 6],
  ["quietday", "quietday", "Quiet Day", "Quiet Day", "quietday.co", "fresh", 6],
  ["tallgrass", "tallgrass", "Tallgrass", "Tallgrass", "tallgrass.in", "fresh", 6],
  ["ridgeback", "ridgeback", "Ridgeback", "Ridgeback", "ridgeback.co", "fresh", 6],
  ["halfmast", "halfmast", "Halfmast", "Halfmast", "halfmast.in", "import_fails", 0],
];

export const sampleStores: SampleStore[] = storeRows.map(([id, brandId, brandName, name, host, behaviour, productCount]) => ({
  id,
  brandId,
  brandName,
  name,
  host,
  aliases: [host, "www." + host, id + ".myshopify.com"],
  behaviour,
  productCount,
}));

const storesByHost = new Map(sampleStores.flatMap(store => store.aliases.map(alias => [alias, store] as const)));

/** Resolves a host or an approved alias to its canonical store. */
export const findStoreByHost = (host: string) => storesByHost.get(host.toLowerCase());
export const findStore = (id: string) => sampleStores.find(store => store.id === id);

interface Template {
  shape: Shape;
  names: [string, string, string];
  price: number;
  sizes: string[];
  colours: [string, string, string];
  description: string;
}

const apparelSizes = ["S", "M", "L", "XL"];
const templates: Template[] = [
  { shape: "tee", names: ["Racer Club Oversized Tee", "Archive Logo Tee", "Heavyweight Pocket Tee"], price: 1299, sizes: apparelSizes, colours: ["Washed charcoal", "Bone", "Faded black"], description: "A washed graphic tee with dropped shoulders and a roomy fit." },
  { shape: "cargo", names: ["Utility Cargo Trousers", "Parachute Cargo Pants", "Carpenter Trousers"], price: 2499, sizes: ["28", "30", "32", "34"], colours: ["Olive", "Stone", "Black"], description: "Straight-leg cargos in cotton twill with patch pockets and a relaxed fit." },
  { shape: "hoodie", names: ["Studio Zip Hoodie", "Loopback Pullover Hoodie", "Boxy Crest Hoodie"], price: 2799, sizes: apparelSizes, colours: ["Brick", "Heather grey", "Navy"], description: "A heavyweight hoodie with a double-layer hood and ribbed cuffs." },
  { shape: "cap", names: ["Weekend 6-Panel Cap", "Washed Twill Cap", "Corduroy Dad Cap"], price: 799, sizes: ["One size"], colours: ["Faded indigo", "Sand", "Forest"], description: "A low-profile cotton cap with an adjustable strap and stitched lettering." },
  { shape: "shirt", names: ["Courtside Camp Shirt", "Seersucker Resort Shirt", "Linen Overshirt"], price: 1899, sizes: apparelSizes, colours: ["Butter", "Sky", "Ecru"], description: "A lightweight shirt with a boxy cut and a single chest pocket." },
  { shape: "shorts", names: ["Trackside Mesh Shorts", "Nylon Run Shorts", "Fleece Lounge Shorts"], price: 1499, sizes: apparelSizes, colours: ["Deep plum", "Grey marl", "Black"], description: "Pull-on shorts with contrast piping and a drawstring waist." },
];

const palettes: Palette[] = [
  { fill: "#303030", light: "#555", ink: "#f1f1f1", backdrop: "#eee" },
  { fill: "#939393", light: "#ccc", ink: "#f3f3f3", backdrop: "#f1f1f1" },
  { fill: "#515151", light: "#919191", ink: "#ddd", backdrop: "#eaeaea" },
];

/** Small stable hash, so the sample catalogue is the same on every load. */
function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The time of the last daily check: 06:00 today, or yesterday if 06:00 is still in the future. */
function lastDailyCheck(now: number): number {
  const check = new Date(now);
  check.setHours(6, 0, 0, 0);
  return check.getTime() > now ? check.getTime() - DAY : check.getTime();
}

export interface SampleCatalogue {
  products: SampleProduct[];
  updates: CatalogueUpdate[];
  lastCheckAt: Map<string, string>;
}

export function buildCatalogue(now = Date.now()): SampleCatalogue {
  const products: SampleProduct[] = [];
  const updates: CatalogueUpdate[] = [];
  const lastCheckAt = new Map<string, string>();
  const daily = lastDailyCheck(now);

  sampleStores.forEach((store, storeIndex) => {
    const checkedAt = store.behaviour === "last_check_failed" ? daily - 2 * DAY : daily;
    lastCheckAt.set(store.id, new Date(checkedAt).toISOString());

    for (let index = 0; index < store.productCount; index++) {
      const template = templates[(index + storeIndex) % templates.length];
      const title = template.names[Math.floor(index / templates.length) % 3];
      const id = String(7_100_000_000 + storeIndex * 1000 + index);
      const seed = hash(store.id + id);
      const colourCount = template.shape === "cap" && seed % 2 ? 1 : 1 + (seed % 3);
      const colours = template.colours.slice(0, colourCount);
      const price = (template.price + (index < 6 ? 0 : (seed % 5) * 100)) * 100;
      const compareAtPrice = seed % 3 === 0 || index === 0 ? price + 40_000 : null;
      const allSoldOut = index % 7 === 2;
      const handle = slug(title);
      const variants: SampleVariant[] = [];
      const changedAt = daily - (1 + (seed % 6)) * DAY;
      // Larger sizes of some products cost more, so the catalogue shows "From".
      const upcharge = (template.shape === "cargo" || template.shape === "hoodie") && index % 2 === 1 ? 20_000 : 0;

      colours.forEach((colour, colourIndex) => {
        const imageUrl = artUrl(template.shape, palettes[colourIndex % palettes.length]);
        template.sizes.forEach((size, sizeIndex) => {
          const variantId = `${id}${colourIndex}${sizeIndex}`;
          const extra = sizeIndex === template.sizes.length - 1 ? upcharge : 0;
          const variantPrice = price + extra;
          const variantCompareAt = compareAtPrice ? compareAtPrice + extra : null;
          variants.push({
            id: variantId,
            options: [colour, size],
            price: variantPrice,
            compareAtPrice: variantCompareAt,
            available: !allSoldOut && hash(variantId) % 10 < 7,
            imageUrl,
            priceHistory: variantCompareAt
              ? [
                  { at: new Date(daily - 30 * DAY).toISOString(), price: variantCompareAt },
                  { at: new Date(daily - 16 * DAY).toISOString(), price: variantCompareAt },
                  { at: new Date(changedAt).toISOString(), price: variantPrice },
                ]
              : [
                  { at: new Date(daily - 30 * DAY).toISOString(), price: variantPrice },
                  { at: new Date(daily - 16 * DAY).toISOString(), price: variantPrice },
                  { at: new Date(checkedAt).toISOString(), price: variantPrice },
                ],
          });
        });
      });

      // Each product has at least one sold-out option, so every product page can show "Alert me".
      if (!allSoldOut && variants.every(variant => variant.available)) variants[variants.length - 1].available = false;


      const priceHistory: PricePoint[] = compareAtPrice
        ? [
            { at: new Date(daily - 30 * DAY).toISOString(), price: compareAtPrice },
            { at: new Date(daily - 16 * DAY).toISOString(), price: compareAtPrice },
            { at: new Date(changedAt).toISOString(), price },
          ]
        : [
            { at: new Date(daily - 30 * DAY).toISOString(), price },
            { at: new Date(daily - 16 * DAY).toISOString(), price },
            { at: new Date(checkedAt).toISOString(), price },
          ];

      const product: SampleProduct = {
        id,
        storeId: store.id,
        title,
        description: template.description,
        url: `https://${store.host}/products/${handle}`,
        currency: "INR",
        imageUrl: variants[0].imageUrl,
        imageAlt: `${title} in ${colours[0].toLowerCase()}`,
        options: [
          { name: "Colour", values: colours },
          { name: "Size", values: template.sizes },
        ],
        variants,
        priceHistory,
      };
      products.push(product);

      const base = { storeId: store.id, storeName: store.name, productId: id, productTitle: title, imageUrl: product.imageUrl, currency: "INR" };
      if (compareAtPrice) {
        updates.push({ ...base, id: "u-drop-" + id, kind: "price_drop", variantTitle: null, oldPrice: compareAtPrice, newPrice: price, at: new Date(changedAt).toISOString() });
      }
      const restocked = variants.find(variant => variant.available && hash("restock" + variant.id) % 4 === 0);
      if (restocked) {
        updates.push({
          ...base,
          id: "u-restock-" + restocked.id,
          kind: "restock",
          variantTitle: restocked.options.join(" / "),
          oldPrice: null,
          newPrice: null,
          at: new Date(daily - (seed % 4) * DAY - 3_600_000).toISOString(),
        });
      }
      const soldOut = variants.find(variant => !variant.available && hash("sold" + variant.id) % 5 === 0);
      if (soldOut) {
        updates.push({
          ...base,
          id: "u-sold-" + soldOut.id,
          kind: "sold_out",
          variantTitle: soldOut.options.join(" / "),
          oldPrice: null,
          newPrice: null,
          at: new Date(daily - (seed % 5) * DAY - 7_200_000).toISOString(),
        });
      }
      if (!compareAtPrice && seed % 9 === 4) {
        const rise = variants[0];
        updates.push({
          ...base,
          id: "u-rise-" + rise.id,
          kind: "price_rise",
          variantTitle: rise.options.join(" / "),
          oldPrice: rise.price - 10_000,
          newPrice: rise.price,
          at: new Date(daily - (seed % 3) * DAY - 5_400_000).toISOString(),
        });
      }
    }
  });

  updates.sort((a, b) => b.at.localeCompare(a.at));
  return { products, updates, lastCheckAt };
}
