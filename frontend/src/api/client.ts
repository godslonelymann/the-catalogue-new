import type {
  Account,
  AddStoreResponse,
  CatalogueUpdate,
  ProductDetail,
  ProductQuery,
  ProductsResponse,
  RestockAlert,
  SessionInfo,
  SignInResult,
  StoreChecks,
  StoresResponse,
  TwoFactorSetup,
  UpdateKind,
  WishlistItem,
} from "./types";

/** Error codes that the UI handles. The API sends them in the `code` field. */
export type ApiErrorCode =
  | "unauthenticated"
  | "not_found"
  | "invalid_url"
  | "unsupported_store"
  | "brand_limit"
  | "check_failed"
  | "invalid_credentials"
  | "invalid_code"
  | "invalid_token"
  | "not_sold_out"
  | "reauthentication_required"
  | "conflict"
  | "rate_limited"
  | "csrf_failed"
  | "invalid_request"
  | "network"
  | "unknown";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const isApiError = (error: unknown, code?: ApiErrorCode): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code);

/** The most updates one listUpdates call returns. A full page means older updates can exist. */
export const UPDATES_PAGE_SIZE = 200;

/** The API deletes updates after this many days. */
export const UPDATE_RETENTION_DAYS = 90;

export interface Api {
  readonly mode: "mock" | "http";

  // Authentication
  me(): Promise<Account>;
  signIn(email: string, password: string): Promise<SignInResult>;
  startGoogleSignIn(): Promise<SignInResult>;
  verifyTwoFactor(code: string): Promise<Account>;
  requestSignup(email: string): Promise<void>;
  completeSignup(token: string, name: string, password: string): Promise<Account>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  // Account
  listSessions(): Promise<SessionInfo[]>;
  revokeSession(id: string): Promise<void>;
  revokeAllSessions(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  startTwoFactorSetup(): Promise<TwoFactorSetup>;
  confirmTwoFactor(code: string): Promise<{ recoveryCodes: string[] }>;
  disableTwoFactor(code: string): Promise<void>;
  linkGoogle(): Promise<Account>;

  // Stores and catalogue
  listStores(): Promise<StoresResponse>;
  addStore(url: string): Promise<AddStoreResponse>;
  removeStore(id: string): Promise<void>;
  listProducts(storeId: string, query: ProductQuery): Promise<ProductsResponse>;
  getProduct(storeId: string, productId: string): Promise<ProductDetail>;
  listStoreChecks(storeId: string): Promise<StoreChecks>;
  /** Newest first, up to UPDATES_PAGE_SIZE. Pass the last id as `before` for older updates. */
  listUpdates(kind?: UpdateKind, before?: string): Promise<CatalogueUpdate[]>;

  // Alerts. Each alert watches one sold-out size. Creating one also saves the product.
  listAlerts(): Promise<RestockAlert[]>;
  createAlert(input: { productId: string; variantId: string }): Promise<RestockAlert>;
  cancelAlert(id: string): Promise<void>;

  // Saved products (the wishlist), each with its watched sizes
  listWishlist(): Promise<WishlistItem[]>;
  /** Saves a product. Saving it again keeps one entry. */
  saveProduct(productId: string): Promise<WishlistItem>;
  /** Removes a saved product and cancels its active alerts. */
  unsaveProduct(productId: string): Promise<{ cancelledAlerts: number }>;
}
