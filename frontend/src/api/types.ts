// Response shapes for the planned FastAPI routes. The mock API returns the same shapes.
// Prices are integers in the currency's minor unit (paise for INR).

export interface Account {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  twoFactorEnabled: boolean;
  recoveryCodesLeft: number;
}

export type StoreStatus = "importing" | "ready" | "import_failed";

export interface MonitoredStore {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  url: string;
  host: string;
  status: StoreStatus;
  /** True when the latest daily check failed. The catalogue still shows the last successful result. */
  lastCheckFailed: boolean;
  lastSuccessfulCheckAt: string | null;
  productCount: number;
  addedAt: string;
}

export interface StoresResponse {
  stores: MonitoredStore[];
  brandCount: number;
  brandLimit: number;
}

export interface AddStoreResponse {
  store: MonitoredStore;
  /** False when the account already monitors this store (or an alias of it). */
  created: boolean;
}

export interface ProductSummary {
  id: string;
  storeId: string;
  title: string;
  imageUrl: string;
  imageAlt: string;
  currency: string;
  /** The lowest variant price. */
  price: number;
  /** The highest variant price. When it is above `price`, the UI shows "From". Optional for older responses. */
  maxPrice?: number;
  compareAtPrice: number | null;
  inStock: boolean;
  colourCount: number;
  /** True when the signed-in account saved this product to its wishlist. */
  saved: boolean;
}

/** A size the account watches on a saved product. One per size: the active alert, or else the latest sent one. */
export interface SavedAlert {
  id: string;
  variantId: string;
  variantTitle: string;
  status: "active" | "sent";
  createdAt: string;
  sentAt: string | null;
}

/**
 * A saved product, shown on the Saved page with the sizes it watches.
 * Only products still listed in a monitored store are returned.
 */
export interface WishlistItem {
  id: string;
  savedAt: string;
  storeName: string;
  product: ProductSummary;
  alerts: SavedAlert[];
}

export type Availability = "" | "in" | "out";
export type PriceBand = "" | "low" | "mid" | "high";

export interface ProductQuery {
  q?: string;
  size?: string;
  availability?: Availability;
  price?: PriceBand;
  cursor?: string | null;
}

export interface ProductsResponse {
  store: MonitoredStore;
  items: ProductSummary[];
  total: number;
  nextCursor: string | null;
  sizes: string[];
}

export interface ProductOption {
  name: string;
  values: string[];
}

export interface Variant {
  id: string;
  title: string;
  /** Values in the same order as ProductDetail.options. */
  options: string[];
  price: number;
  compareAtPrice: number | null;
  available: boolean;
  imageUrl: string | null;
  /** Dated prices for this variant. When absent, the UI uses the product history. */
  priceHistory?: PricePoint[];
}

export interface PricePoint {
  at: string;
  price: number;
}

export interface ProductDetail extends ProductSummary {
  storeName: string;
  description: string;
  url: string;
  options: ProductOption[];
  variants: Variant[];
  priceHistory: PricePoint[];
  lastSuccessfulCheckAt: string | null;
  lastCheckFailed: boolean;
  /** Active alerts that belong to the signed-in account. */
  alerts: { id: string; variantId: string }[];
}

export type UpdateKind = "price_drop" | "price_rise" | "restock" | "sold_out";

export interface CatalogueUpdate {
  id: string;
  kind: UpdateKind;
  storeId: string;
  storeName: string;
  productId: string;
  productTitle: string;
  imageUrl: string;
  variantTitle: string | null;
  currency: string;
  oldPrice: number | null;
  newPrice: number | null;
  at: string;
}

export type AlertStatus = "active" | "sent" | "cancelled";

export interface RestockAlert {
  id: string;
  storeId: string;
  storeName: string;
  productId: string;
  productTitle: string;
  imageUrl: string;
  variantId: string;
  variantTitle: string;
  status: AlertStatus;
  createdAt: string;
  sentAt: string | null;
}

export interface SessionInfo {
  id: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export type SignInResult =
  | { status: "signed_in"; account: Account }
  | { status: "two_factor_required" };

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
}
