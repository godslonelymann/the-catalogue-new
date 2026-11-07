// HTTP client for the FastAPI routes behind /api. It implements the same `Api`
// interface as the mock, so screens and tests use one contract.

import { ApiError, type Api, type ApiErrorCode } from "./client";
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
  StoresResponse,
  TwoFactorSetup,
  UpdateKind,
  WishlistItem,
} from "./types";

const knownCodes = new Set<ApiErrorCode>([
  "unauthenticated",
  "not_found",
  "invalid_url",
  "unsupported_store",
  "brand_limit",
  "check_failed",
  "invalid_credentials",
  "invalid_code",
  "invalid_token",
  "not_sold_out",
  "reauthentication_required",
  "conflict",
  "rate_limited",
  "csrf_failed",
  "invalid_request",
]);

function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return "unauthenticated";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "unknown";
}

/** Reads the CSRF token that the API sets in a readable cookie. */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function toError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The body is not JSON.
  }
  // FastAPI sends errors as {"detail": {...}} or {"detail": "text"}.
  const detail = (body as { detail?: unknown } | null)?.detail ?? body;
  const fields = typeof detail === "object" && detail ? (detail as { code?: string; message?: string }) : {};
  const code = fields.code && knownCodes.has(fields.code as ApiErrorCode) ? (fields.code as ApiErrorCode) : codeForStatus(response.status);
  const message = fields.message ?? (typeof detail === "string" ? detail : "Something went wrong. Try again.");
  return new ApiError(response.status, code, message);
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

export function createHttpApi(base = "/api", fetcher: typeof fetch = (...args) => fetch(...args)): Api {
  async function send(method: Method, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET") {
      const token = csrfToken();
      if (token) headers["X-CSRF-Token"] = token;
    }
    try {
      return await fetcher(base + path, {
        method,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "network", "We couldn’t reach The Catalogue. Check your connection and try again.");
    }
  }

  // One renewal at a time. Parallel requests (and tabs, through the shared cookie) wait for it.
  let renewal: Promise<boolean> | null = null;
  function renewSession(): Promise<boolean> {
    renewal ??= send("POST", "/auth/refresh")
      .then(response => response.ok)
      .catch(() => false)
      .finally(() => {
        renewal = null;
      });
    return renewal;
  }

  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    let response = await send(method, path, body);
    // The access token lasts 15 minutes. Renew it once with the renewal token, then retry.
    if (response.status === 401 && !path.startsWith("/auth/")) {
      if (await renewSession()) response = await send(method, path, body);
    }
    // The first write of a visit may arrive before the CSRF cookie exists. The 403 sets it.
    if (response.status === 403 && method !== "GET") {
      const error = await toError(response.clone());
      if (error.code === "csrf_failed" && csrfToken()) response = await send(method, path, body);
    }
    if (!response.ok) throw await toError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Full-page navigation for Google sign-in and linking. The promise never settles. */
  function redirect(path: string): Promise<never> {
    window.location.assign(base + path);
    return new Promise<never>(() => {});
  }

  const query = (params: Record<string, string | null | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    const text = search.toString();
    return text ? "?" + text : "";
  };

  const id = encodeURIComponent;

  return {
    mode: "http",

    me: () => request<Account>("GET", "/me"),
    signIn: (email, password) => request<SignInResult>("POST", "/auth/sign-in", { email, password }),
    startGoogleSignIn: () => {
      const from = (window.history.state as { usr?: { from?: string } } | null)?.usr?.from;
      return redirect("/auth/google/start" + query({ return_to: from ?? "/stores" }));
    },
    verifyTwoFactor: code => request<Account>("POST", "/auth/two-factor", { code }),
    requestSignup: email => request<void>("POST", "/auth/signup", { email }),
    completeSignup: (token, name, password) => request<Account>("POST", "/auth/signup/complete", { token, name, password }),
    requestPasswordReset: email => request<void>("POST", "/auth/password-reset", { email }),
    resetPassword: (token, password) => request<void>("POST", "/auth/password-reset/complete", { token, password }),
    signOut: () => request<void>("POST", "/auth/sign-out"),

    listSessions: () => request<SessionInfo[]>("GET", "/sessions"),
    revokeSession: sessionId => request<void>("DELETE", `/sessions/${id(sessionId)}`),
    revokeAllSessions: () => request<void>("DELETE", "/sessions"),
    changePassword: (current, next) => request<void>("POST", "/account/password", { current, next }),
    startTwoFactorSetup: () => request<TwoFactorSetup>("POST", "/account/two-factor/setup"),
    confirmTwoFactor: code => request<{ recoveryCodes: string[] }>("POST", "/account/two-factor/confirm", { code }),
    disableTwoFactor: code => request<void>("POST", "/account/two-factor/disable", { code }),
    // The API checks for a recent sign-in, then sends the browser to Google.
    // Google returns to /account, which reopens Settings on the Profile tab.
    linkGoogle: () => redirect("/auth/google/start" + query({ intent: "link", return_to: "/account" })),

    listStores: () => request<StoresResponse>("GET", "/stores"),
    addStore: url => request<AddStoreResponse>("POST", "/stores", { url }),
    removeStore: storeId => request<void>("DELETE", `/stores/${id(storeId)}`),
    listProducts: (storeId, params: ProductQuery) =>
      request<ProductsResponse>(
        "GET",
        `/stores/${id(storeId)}/products` +
          query({ q: params.q, size: params.size, availability: params.availability, price: params.price, cursor: params.cursor }),
      ),
    getProduct: (storeId, productId) => request<ProductDetail>("GET", `/stores/${id(storeId)}/products/${id(productId)}`),
    listUpdates: (kind?: UpdateKind) => request<CatalogueUpdate[]>("GET", "/updates" + query({ kind })),

    listAlerts: () => request<RestockAlert[]>("GET", "/alerts"),
    createAlert: input => request<RestockAlert>("POST", "/alerts", input),
    cancelAlert: alertId => request<void>("DELETE", `/alerts/${id(alertId)}`),

    listWishlist: () => request<WishlistItem[]>("GET", "/wishlist"),
    saveProduct: productId => request<WishlistItem>("PUT", `/wishlist/${id(productId)}`),
    unsaveProduct: productId => request<{ cancelledAlerts: number }>("DELETE", `/wishlist/${id(productId)}`),
  };
}
