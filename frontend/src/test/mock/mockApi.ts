// Test double for the FastAPI routes, used by Vitest and Playwright only.
// In-browser mock of the planned FastAPI routes. It keeps each sample account's data
// apart, so the review can check that one account never sees another account's stores.

import { ApiError, type Api } from "@/api/client";
import type {
  Account,
  AlertStatus,
  MonitoredStore,
  ProductDetail,
  ProductSummary,
  RestockAlert,
  SavedAlert,
  SessionInfo,
  WishlistItem,
} from "@/api/types";
import { parseStoreUrl, storeUrlMessages } from "@/lib/storeUrl";
import { buildCatalogue, findStore, findStoreByHost, sampleStores, unreachableHosts, type SampleProduct } from "./data";

export const BRAND_LIMIT = 10;
const PAGE_SIZE = 12;
const IMPORT_MS = 4000;
const STATE_KEY = "catalogue.mock.v1";
const SESSION_KEY = "catalogue.mock.session";
const PENDING_KEY = "catalogue.mock.pending-2fa";
const TOKEN_KEY = "catalogue.mock.token";

interface StoredStore {
  storeId: string;
  addedAt: number;
  readyAt: number;
}

interface StoredAlert {
  id: string;
  productId: string;
  variantId: string;
  status: AlertStatus;
  createdAt: number;
  sentAt: number | null;
}

interface StoredSaved {
  id: string;
  productId: string;
  savedAt: number;
}

const WISHLIST_LIMIT = 500;

interface StoredAccount {
  account: Account;
  stores: StoredStore[];
  alerts: StoredAlert[];
  /** Optional, so sample state saved before the wishlist still loads. */
  wishlist?: StoredSaved[];
  sessions: Omit<SessionInfo, "current">[];
}

interface State {
  accounts: Record<string, StoredAccount>;
}

export interface MockOptions {
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  session?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  delayMs?: number;
  now?: () => number;
}

const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in to continue.");
const notFound = () => new ApiError(404, "not_found", "We couldn’t find that page.");

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: key => void values.delete(key),
  };
}

const randomCode = (length: number, alphabet: string) =>
  Array.from(crypto.getRandomValues(new Uint32Array(length)), value => alphabet[value % alphabet.length]).join("");

export interface MockApi extends Api {
  /** Sample-only helpers for the review. The HTTP API has no equivalent. */
  sample: {
    reset(): Promise<void>;
    addSampleBrands(count: number): Promise<void>;
    signupToken(): string | null;
  };
}

export function createMockApi(options: MockOptions = {}): MockApi {
  const storage = options.storage ?? memoryStorage();
  const session = options.session ?? memoryStorage();
  const delayMs = options.delayMs ?? 250;
  const now = options.now ?? Date.now;
  const catalogue = buildCatalogue(now());
  const productsById = new Map(catalogue.products.map(product => [product.id, product]));

  const wait = (ms = delayMs) => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

  function load(): State {
    try {
      const parsed = JSON.parse(storage.getItem(STATE_KEY) ?? "null") as State | null;
      if (parsed && typeof parsed.accounts === "object") return parsed;
    } catch {
      // Start again with empty sample data.
    }
    return { accounts: {} };
  }

  function save(state: State) {
    storage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function readSession(): { email: string; sessionId: string } | null {
    try {
      return JSON.parse(session.getItem(SESSION_KEY) ?? "null");
    } catch {
      return null;
    }
  }

  /** Returns the signed-in account, or throws 401. Every private method calls this first. */
  function current(state: State): StoredAccount & { sessionId: string } {
    const active = readSession();
    const data = active && state.accounts[active.email];
    if (!active || !data || !data.sessions.some(item => item.id === active.sessionId)) {
      session.removeItem(SESSION_KEY);
      throw unauthenticated();
    }
    return Object.assign(data, { sessionId: active.sessionId });
  }

  function ensureAccount(state: State, email: string, init: Partial<Account>): StoredAccount {
    const key = email.trim().toLowerCase();
    if (!state.accounts[key]) {
      const created = new Date(now() - 3 * 86_400_000).toISOString();
      state.accounts[key] = {
        account: {
          id: crypto.randomUUID(),
          email: key,
          name: null,
          emailVerified: true,
          hasPassword: false,
          googleLinked: false,
          twoFactorEnabled: false,
          recoveryCodesLeft: 0,
          ...init,
        },
        stores: [],
        alerts: [],
        wishlist: [],
        // Sample devices, so the review can sign out of one device.
        sessions: [
          { id: crypto.randomUUID(), device: "iPhone · Safari", createdAt: created, lastSeenAt: new Date(now() - 7_200_000).toISOString() },
          { id: crypto.randomUUID(), device: "Windows · Edge", createdAt: created, lastSeenAt: new Date(now() - 2 * 86_400_000).toISOString() },
        ],
      };
    }
    return state.accounts[key];
  }

  function startSession(state: State, data: StoredAccount) {
    const id = crypto.randomUUID();
    const stamp = new Date(now()).toISOString();
    data.sessions.unshift({ id, device: "This browser", createdAt: stamp, lastSeenAt: stamp });
    session.setItem(SESSION_KEY, JSON.stringify({ email: data.account.email, sessionId: id }));
    session.removeItem(PENDING_KEY);
    save(state);
  }

  function finishSignIn(state: State, data: StoredAccount) {
    if (data.account.twoFactorEnabled) {
      session.setItem(PENDING_KEY, data.account.email);
      session.removeItem(SESSION_KEY);
      save(state);
      return { status: "two_factor_required" as const };
    }
    startSession(state, data);
    return { status: "signed_in" as const, account: { ...data.account } };
  }

  function storeView(entry: StoredStore): MonitoredStore {
    const sample = findStore(entry.storeId)!;
    const pending = now() < entry.readyAt;
    let status: MonitoredStore["status"] = "ready";
    if (sample.behaviour === "import" || sample.behaviour === "import_fails") {
      status = pending ? "importing" : sample.behaviour === "import" ? "ready" : "import_failed";
    }
    const lastCheck =
      status !== "ready" ? null : sample.behaviour === "import" ? new Date(entry.readyAt).toISOString() : catalogue.lastCheckAt.get(sample.id)!;
    return {
      id: sample.id,
      brandId: sample.brandId,
      brandName: sample.brandName,
      name: sample.name,
      url: `https://${sample.host}/`,
      host: sample.host,
      status,
      lastCheckFailed: status === "ready" && sample.behaviour === "last_check_failed",
      lastSuccessfulCheckAt: lastCheck,
      productCount: status === "ready" ? sample.productCount : 0,
      addedAt: new Date(entry.addedAt).toISOString(),
    };
  }

  /** Counts brands from active stores and pending imports. A failed first import releases its slot. */
  function brandIds(data: StoredAccount): Set<string> {
    return new Set(data.stores.map(storeView).filter(store => store.status !== "import_failed").map(store => store.brandId));
  }

  function monitoredStore(data: StoredAccount, storeId: string): MonitoredStore {
    const entry = data.stores.find(item => item.storeId === storeId);
    if (!entry) throw notFound();
    return storeView(entry);
  }

  function readyStoreIds(data: StoredAccount): Set<string> {
    return new Set(data.stores.map(storeView).filter(store => store.status === "ready").map(store => store.id));
  }

  const isSaved = (data: StoredAccount, productId: string) => (data.wishlist ?? []).some(item => item.productId === productId);

  function wishlistView(data: StoredAccount, item: StoredSaved): WishlistItem {
    const product = productsById.get(item.productId)!;
    return {
      id: item.id,
      savedAt: new Date(item.savedAt).toISOString(),
      storeName: findStore(product.storeId)!.name,
      product: summary(product, true),
      alerts: savedAlerts(data, product),
    };
  }

  /** One per watched size: the active alert, or else the latest sent one. Oldest first. */
  function savedAlerts(data: StoredAccount, product: SampleProduct): SavedAlert[] {
    const byVariant = new Map<string, StoredAlert>();
    const ranked = data.alerts
      .filter(alert => alert.productId === product.id && alert.status !== "cancelled")
      .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.createdAt - a.createdAt);
    for (const alert of ranked) if (!byVariant.has(alert.variantId)) byVariant.set(alert.variantId, alert);
    return [...byVariant.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(alert => ({
        id: alert.id,
        variantId: alert.variantId,
        variantTitle: product.variants.find(variant => variant.id === alert.variantId)!.options.join(" / "),
        status: alert.status as "active" | "sent",
        createdAt: new Date(alert.createdAt).toISOString(),
        sentAt: alert.sentAt ? new Date(alert.sentAt).toISOString() : null,
      }));
  }

  /** Setting an alert saves the product, so the alert shows on the Saved page. */
  function ensureSaved(data: StoredAccount, productId: string) {
    const wishlist = (data.wishlist ??= []);
    if (wishlist.some(item => item.productId === productId)) return;
    if (wishlist.length >= WISHLIST_LIMIT) {
      throw new ApiError(409, "conflict", `You can save up to ${WISHLIST_LIMIT} products. Remove one to save another.`);
    }
    wishlist.push({ id: crypto.randomUUID(), productId, savedAt: now() });
  }

  function summary(product: SampleProduct, saved = false): ProductSummary {
    const first = product.variants[0];
    return {
      id: product.id,
      storeId: product.storeId,
      title: product.title,
      imageUrl: product.imageUrl,
      imageAlt: product.imageAlt,
      currency: product.currency,
      price: Math.min(...product.variants.map(variant => variant.price)),
      maxPrice: Math.max(...product.variants.map(variant => variant.price)),
      compareAtPrice: first.compareAtPrice,
      inStock: product.variants.some(variant => variant.available),
      colourCount: product.options[0].values.length,
      saved,
    };
  }

  function alertView(alert: StoredAlert): RestockAlert {
    const product = productsById.get(alert.productId)!;
    const variant = product.variants.find(item => item.id === alert.variantId)!;
    return {
      id: alert.id,
      storeId: product.storeId,
      storeName: findStore(product.storeId)!.name,
      productId: product.id,
      productTitle: product.title,
      imageUrl: variant.imageUrl,
      variantId: variant.id,
      variantTitle: variant.options.join(" / "),
      status: alert.status,
      createdAt: new Date(alert.createdAt).toISOString(),
      sentAt: alert.sentAt ? new Date(alert.sentAt).toISOString() : null,
    };
  }

  const api: MockApi = {
    mode: "mock",

    async me() {
      await wait(0);
      return { ...current(load()).account };
    },

    async signIn(email, password) {
      await wait();
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
        throw new ApiError(401, "invalid_credentials", "The email or password is incorrect.");
      }
      const state = load();
      const data = ensureAccount(state, email, { hasPassword: true });
      return finishSignIn(state, data);
    },

    async startGoogleSignIn() {
      await wait();
      const state = load();
      const data = ensureAccount(state, "sample.google@example.com", { name: "Sample Google user", googleLinked: true });
      return finishSignIn(state, data);
    },

    async verifyTwoFactor(code) {
      await wait();
      const state = load();
      const email = session.getItem(PENDING_KEY);
      const data = email ? state.accounts[email] : undefined;
      if (!data) throw unauthenticated();
      const value = code.trim();
      if (/^\d{6}$/.test(value)) {
        startSession(state, data);
      } else if (/^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(value) && data.account.recoveryCodesLeft > 0) {
        data.account.recoveryCodesLeft -= 1;
        startSession(state, data);
      } else {
        throw new ApiError(401, "invalid_code", "That code didn’t work. Try again.");
      }
      return { ...data.account };
    },

    async requestSignup(email) {
      await wait();
      session.setItem(TOKEN_KEY, JSON.stringify({ token: "sample-" + crypto.randomUUID(), email: email.trim().toLowerCase() }));
    },

    async completeSignup(token, name, password) {
      await wait();
      const pending = JSON.parse(session.getItem(TOKEN_KEY) ?? "null") as { token: string; email: string } | null;
      if (!pending || pending.token !== token) {
        throw new ApiError(400, "invalid_token", "This link has expired or was already used. Request a new link.");
      }
      if (password.length < 8) throw new ApiError(422, "unknown", "Use at least 8 characters.");
      session.removeItem(TOKEN_KEY);
      const state = load();
      const data = ensureAccount(state, pending.email, {});
      data.account.name = name.trim() || null;
      data.account.hasPassword = true;
      data.account.emailVerified = true;
      startSession(state, data);
      return { ...data.account };
    },

    async requestPasswordReset(email) {
      await wait();
      session.setItem(TOKEN_KEY, JSON.stringify({ token: "sample-" + crypto.randomUUID(), email: email.trim().toLowerCase() }));
    },

    async resetPassword(token, password) {
      await wait();
      const pending = JSON.parse(session.getItem(TOKEN_KEY) ?? "null") as { token: string; email: string } | null;
      if (!pending || pending.token !== token) {
        throw new ApiError(400, "invalid_token", "This link has expired or was already used. Request a new link.");
      }
      if (password.length < 8) throw new ApiError(422, "unknown", "Use at least 8 characters.");
      session.removeItem(TOKEN_KEY);
      const state = load();
      const data = ensureAccount(state, pending.email, {});
      data.account.hasPassword = true;
      // A reset signs out every device. Two-factor authentication stays on.
      data.sessions = [];
      session.removeItem(SESSION_KEY);
      save(state);
    },

    async signOut() {
      await wait(0);
      const state = load();
      const active = readSession();
      const data = active && state.accounts[active.email];
      if (data) data.sessions = data.sessions.filter(item => item.id !== active.sessionId);
      session.removeItem(SESSION_KEY);
      save(state);
    },

    async listSessions() {
      await wait();
      const data = current(load());
      return data.sessions.map(item => ({ ...item, current: item.id === data.sessionId }));
    },

    async revokeSession(id) {
      await wait();
      const state = load();
      const data = current(state);
      if (!data.sessions.some(item => item.id === id)) throw notFound();
      data.sessions = data.sessions.filter(item => item.id !== id);
      if (id === data.sessionId) session.removeItem(SESSION_KEY);
      save(state);
    },

    async revokeAllSessions() {
      await wait();
      const state = load();
      const data = current(state);
      data.sessions = [];
      session.removeItem(SESSION_KEY);
      save(state);
    },

    async changePassword(currentPassword, next) {
      await wait();
      const state = load();
      const data = current(state);
      if (data.account.hasPassword && currentPassword.length < 8) {
        throw new ApiError(401, "invalid_credentials", "Your current password is incorrect.");
      }
      if (next.length < 8) throw new ApiError(422, "unknown", "Use at least 8 characters.");
      data.account.hasPassword = true;
      data.sessions = [];
      session.removeItem(SESSION_KEY);
      save(state);
    },

    async startTwoFactorSetup() {
      await wait();
      const data = current(load());
      const secret = randomCode(32, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567");
      return {
        secret,
        otpauthUrl: `otpauth://totp/The%20Catalogue:${encodeURIComponent(data.account.email)}?secret=${secret}&issuer=The%20Catalogue`,
      };
    },

    async confirmTwoFactor(code) {
      await wait();
      const state = load();
      const data = current(state);
      if (!/^\d{6}$/.test(code.trim())) throw new ApiError(401, "invalid_code", "Enter the 6-digit code from your app.");
      const recoveryCodes = Array.from({ length: 10 }, () => {
        const code = randomCode(8, "abcdefghjkmnpqrstuvwxyz23456789");
        return code.slice(0, 4) + "-" + code.slice(4);
      });
      data.account.twoFactorEnabled = true;
      data.account.recoveryCodesLeft = recoveryCodes.length;
      save(state);
      return { recoveryCodes };
    },

    async disableTwoFactor(code) {
      await wait();
      const state = load();
      const data = current(state);
      if (!/^\d{6}$/.test(code.trim())) throw new ApiError(401, "invalid_code", "Enter the 6-digit code from your app.");
      data.account.twoFactorEnabled = false;
      data.account.recoveryCodesLeft = 0;
      save(state);
    },

    async linkGoogle() {
      await wait();
      const state = load();
      const data = current(state);
      data.account.googleLinked = true;
      save(state);
      return { ...data.account };
    },

    async listStores() {
      await wait();
      const data = current(load());
      const stores = data.stores.map(storeView);
      return { stores, brandCount: brandIds(data).size, brandLimit: BRAND_LIMIT };
    },

    async addStore(url) {
      current(load());
      const parsed = parseStoreUrl(url);
      if (!parsed.ok) throw new ApiError(422, "invalid_url", storeUrlMessages[parsed.problem]);

      await wait(Math.max(delayMs, delayMs ? 900 : 0));
      if (unreachableHosts.has(parsed.host)) {
        throw new ApiError(502, "check_failed", "We couldn’t reach this store. Try again later.");
      }
      const sample = findStoreByHost(parsed.host);
      if (!sample) throw new ApiError(422, "unsupported_store", "Only supported Shopify stores can be added.");

      // Read the state again: this is the mock version of the locked account row.
      const fresh = load();
      const account = current(fresh);
      const existing = account.stores.find(item => item.storeId === sample.id);
      if (existing && storeView(existing).status !== "import_failed") {
        return { store: storeView(existing), created: false };
      }
      const brands = brandIds(account);
      if (!brands.has(sample.brandId) && brands.size >= BRAND_LIMIT) {
        throw new ApiError(409, "brand_limit", `You can monitor up to ${BRAND_LIMIT} brands. Remove a brand to add a new one.`);
      }
      account.stores = account.stores.filter(item => item.storeId !== sample.id);
      const stamp = now();
      const entry = { storeId: sample.id, addedAt: stamp, readyAt: sample.behaviour === "fresh" || sample.behaviour === "last_check_failed" ? stamp : stamp + IMPORT_MS };
      account.stores.push(entry);
      save(fresh);
      return { store: storeView(entry), created: true };
    },

    async removeStore(id) {
      await wait();
      const state = load();
      const data = current(state);
      if (!data.stores.some(item => item.storeId === id)) throw notFound();
      data.stores = data.stores.filter(item => item.storeId !== id);
      for (const alert of data.alerts) {
        if (alert.status === "active" && productsById.get(alert.productId)?.storeId === id) alert.status = "cancelled";
      }
      // Removing a store also removes the account's saved products from it.
      data.wishlist = (data.wishlist ?? []).filter(item => productsById.get(item.productId)?.storeId !== id);
      save(state);
    },

    async listProducts(storeId, query) {
      await wait();
      const data = current(load());
      const store = monitoredStore(data, storeId);
      if (store.status !== "ready") return { store, items: [], total: 0, nextCursor: null, sizes: [] };

      const all = catalogue.products.filter(product => product.storeId === storeId);
      const sizes = [...new Set(all.flatMap(product => product.options[1].values))];
      const search = query.q?.trim().toLowerCase() ?? "";
      const matching = all.filter(product => {
        if (search && !product.title.toLowerCase().includes(search) && !product.options[0].values.some(value => value.toLowerCase().includes(search))) return false;
        const variants = query.size ? product.variants.filter(variant => variant.options[1] === query.size) : product.variants;
        if (!variants.length) return false;
        const price = Math.min(...product.variants.map(variant => variant.price));
        if (query.price === "low" && price >= 150_000) return false;
        if (query.price === "mid" && (price < 150_000 || price >= 250_000)) return false;
        if (query.price === "high" && price < 250_000) return false;
        const available = variants.some(variant => variant.available);
        if (query.availability === "in" && !available) return false;
        if (query.availability === "out" && available) return false;
        return true;
      });
      const offset = Number(query.cursor ?? 0) || 0;
      const items = matching.slice(offset, offset + PAGE_SIZE).map(product => summary(product, isSaved(data, product.id)));
      const next = offset + PAGE_SIZE < matching.length ? String(offset + PAGE_SIZE) : null;
      return { store, items, total: matching.length, nextCursor: next, sizes };
    },

    async getProduct(storeId, productId) {
      await wait();
      const data = current(load());
      const store = monitoredStore(data, storeId);
      const product = productsById.get(productId);
      if (store.status !== "ready" || !product || product.storeId !== storeId) throw notFound();
      const detail: ProductDetail = {
        ...summary(product, isSaved(data, product.id)),
        storeName: store.name,
        description: product.description,
        url: product.url,
        options: product.options,
        variants: product.variants.map(variant => ({ ...variant, title: variant.options.join(" / ") })),
        priceHistory: product.priceHistory,
        lastSuccessfulCheckAt: store.lastSuccessfulCheckAt,
        lastCheckFailed: store.lastCheckFailed,
        alerts: data.alerts
          .filter(alert => alert.status === "active" && alert.productId === productId)
          .map(alert => ({ id: alert.id, variantId: alert.variantId })),
      };
      return detail;
    },

    async listUpdates(kind) {
      await wait();
      const data = current(load());
      const stores = readyStoreIds(data);
      return catalogue.updates.filter(update => stores.has(update.storeId) && (!kind || update.kind === kind));
    },

    async listAlerts() {
      await wait();
      const data = current(load());
      return data.alerts
        .filter(alert => alert.status !== "cancelled")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(alertView);
    },

    async createAlert({ productId, variantId }) {
      await wait();
      const state = load();
      const data = current(state);
      const product = productsById.get(productId);
      const variant = product?.variants.find(item => item.id === variantId);
      if (!product || !variant || !readyStoreIds(data).has(product.storeId)) throw notFound();
      if (variant.available) throw new ApiError(422, "not_sold_out", "This option is in stock. Alerts are for sold-out options.");
      ensureSaved(data, productId);
      const existing = data.alerts.find(alert => alert.variantId === variantId && alert.status === "active");
      if (existing) {
        save(state);
        return alertView(existing);
      }
      const alert: StoredAlert = { id: crypto.randomUUID(), productId, variantId, status: "active", createdAt: now(), sentAt: null };
      data.alerts.push(alert);
      save(state);
      return alertView(alert);
    },

    async cancelAlert(id) {
      await wait();
      const state = load();
      const data = current(state);
      const alert = data.alerts.find(item => item.id === id && item.status === "active");
      if (!alert) throw notFound();
      alert.status = "cancelled";
      save(state);
    },

    async listWishlist() {
      await wait();
      const data = current(load());
      const ready = readyStoreIds(data);
      return (data.wishlist ?? [])
        .filter(item => ready.has(productsById.get(item.productId)?.storeId ?? ""))
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(item => wishlistView(data, item));
    },

    async saveProduct(productId) {
      await wait();
      const state = load();
      const data = current(state);
      const product = productsById.get(productId);
      if (!product || !readyStoreIds(data).has(product.storeId)) throw notFound();
      const wishlist = (data.wishlist ??= []);
      const existing = wishlist.find(item => item.productId === productId);
      if (existing) return wishlistView(data, existing);
      if (wishlist.length >= WISHLIST_LIMIT) {
        throw new ApiError(409, "conflict", `You can save up to ${WISHLIST_LIMIT} products. Remove one to save another.`);
      }
      const item: StoredSaved = { id: crypto.randomUUID(), productId, savedAt: now() };
      wishlist.push(item);
      save(state);
      return wishlistView(data, item);
    },

    async unsaveProduct(productId) {
      await wait();
      const state = load();
      const data = current(state);
      const before = (data.wishlist ?? []).length;
      data.wishlist = (data.wishlist ?? []).filter(item => item.productId !== productId);
      if (data.wishlist.length === before) throw notFound();
      // Removing a saved product cancels its active alerts.
      let cancelledAlerts = 0;
      for (const alert of data.alerts) {
        if (alert.productId === productId && alert.status === "active") {
          alert.status = "cancelled";
          cancelledAlerts += 1;
        }
      }
      save(state);
      return { cancelledAlerts };
    },

    sample: {
      async reset() {
        const state = load();
        const data = current(state);
        data.stores = [];
        data.alerts = [];
        data.wishlist = [];
        save(state);
      },
      async addSampleBrands(count) {
        const state = load();
        const data = current(state);
        const owned = brandIds(data);
        const stamp = now();
        for (const store of sampleStores) {
          if (owned.size >= count) break;
          if (owned.has(store.brandId) || store.behaviour !== "fresh") continue;
          data.stores.push({ storeId: store.id, addedAt: stamp, readyAt: stamp });
          owned.add(store.brandId);
        }
        save(state);
      },
      signupToken() {
        try {
          return (JSON.parse(session.getItem(TOKEN_KEY) ?? "null") as { token: string } | null)?.token ?? null;
        } catch {
          return null;
        }
      },
    },
  };

  return api;
}
