/**
 * Real products from fugazee.com, used as landing page examples.
 *
 * Snapshot of https://fugazee.com/products.json on 9 November 2026 (466 products, INR).
 * Prices are the store's own: `price` is the sale price, `compareAt` is its listed original price.
 * Images load from Shopify's CDN. Re-check these values when you update the page:
 * stock and prices change daily.
 */

export const STORE = {
  domain: "fugazee.com",
  productCount: 466,
  currency: "INR",
} as const;

const CDN = "https://cdn.shopify.com/s/files/1/2343/5149/files/";

/** A Shopify CDN image URL at a fixed width. */
export function shopifyImage(file: string, width: number): string {
  return `${CDN}${file}&width=${width}`;
}

export interface FugazeeProduct {
  title: string;
  /** File name and version on the Shopify CDN. */
  image: string;
  price: number;
  compareAt: number;
}

/** Sizes S/28, M/30 and L/32 were sold out in the snapshot. XL/34 and up were in stock. */
export const soldOut = {
  title: "Black Barrel Korean Trousers",
  image: "2_83f7fb1d-dcbc-4863-8a5d-4895f93f7df6.jpg?v=1792597544",
  sizes: [
    { size: "S/28", available: false },
    { size: "M/30", available: false },
    { size: "L/32", available: false },
    { size: "XL/34", available: true },
  ],
  pick: "L/32",
} as const;

export const catalogue: FugazeeProduct[] = [
  { title: "Royal Blue Pleated Corduroy Jacket", image: "1_d531b50f-0760-46b6-8b0e-c9b2bea75103.jpg?v=1793971320", price: 2499, compareAt: 4999 },
  { title: "Grey & Black Raw Edge Boxy Shirt", image: "6_410e57f7-a574-49b9-a175-cee2da74ce79.jpg?v=1793374226", price: 1299, compareAt: 2499 },
  { title: "Beige Waffle Relaxed Henley Tshirt", image: "10_787181b7-bf7a-4a23-8ee3-394c977db2f5.jpg?v=1793291714", price: 1299, compareAt: 2499 },
  { title: "Tan Croc Textured Fireman Clasp Harrington Jacket", image: "4_04ec93f1-21ca-47b2-a348-80addaa22cc1.jpg?v=1792324458", price: 3999, compareAt: 4999 },
  { title: "Red Heavy Knit Polo Sweater", image: "1_853a99de-14f1-499a-9d3f-35bd469ad0b0.jpg?v=1792080132", price: 1999, compareAt: 3999 },
  { title: "Navy Striped Pleated Trousers", image: "4_b833a5f2-04a3-4133-8eb8-d21d465d80aa.jpg?v=1793482132", price: 1699, compareAt: 3999 },
];

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** ₹2,499 */
export const rupees = (amount: number) => inr.format(amount);
