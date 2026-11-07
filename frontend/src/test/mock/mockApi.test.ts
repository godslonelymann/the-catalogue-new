import { describe, expect, it } from "vitest";
import { isApiError } from "@/api/client";
import { createMockApi, type MockOptions } from "./mockApi";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

/** One shared "database" with a separate browser session per account. */
function setup(clock = { now: Date.UTC(2026, 10, 7, 10) }) {
  const storage = memory();
  const open = (extra: Partial<MockOptions> = {}) =>
    createMockApi({ storage, session: memory(), delayMs: 0, now: () => clock.now, ...extra });
  return { open, clock };
}

async function signedIn(api: ReturnType<ReturnType<typeof setup>["open"]>, email: string) {
  const result = await api.signIn(email, "sample-password");
  expect(result.status).toBe("signed_in");
  return api;
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to fail.");
}

describe("private access", () => {
  it("returns 401 for every private call without a session", async () => {
    const api = setup().open();
    for (const call of [api.me(), api.listStores(), api.listUpdates(), api.listAlerts(), api.addStore("https://fugazee.com")]) {
      const error = await errorOf(call);
      expect(isApiError(error, "unauthenticated")).toBe(true);
    }
  });

  it("starts each new account with an empty dashboard", async () => {
    const api = await signedIn(setup().open(), "new@example.com");
    expect(await api.listStores()).toEqual({ stores: [], brandCount: 0, brandLimit: 10 });
  });

  it("keeps two accounts that monitor the same store apart", async () => {
    const { open } = setup();
    const one = await signedIn(open(), "one@example.com");
    const two = await signedIn(open(), "two@example.com");
    await one.addStore("https://fugazee.com");
    await two.addStore("https://fugazee.com");
    await one.addStore("https://kilnandco.in");

    const product = (await one.listProducts("fugazee", {})).items.find(item => item.inStock);
    const detail = await one.getProduct("fugazee", product!.id);
    const soldOut = detail.variants.find(variant => !variant.available)!;
    const alert = await one.createAlert({ productId: detail.id, variantId: soldOut.id });

    expect((await two.listStores()).stores.map(store => store.id)).toEqual(["fugazee"]);
    expect(await two.listAlerts()).toEqual([]);
    expect((await two.getProduct("fugazee", detail.id)).alerts).toEqual([]);
    expect(isApiError(await errorOf(two.listProducts("kiln", {})), "not_found")).toBe(true);
    expect(isApiError(await errorOf(two.cancelAlert(alert.id)), "not_found")).toBe(true);
    expect(await one.listAlerts()).toHaveLength(1);
  });
});

describe("adding stores", () => {
  it("rejects a non-Shopify store without creating anything", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    const error = await errorOf(api.addStore("https://example.com"));
    expect(isApiError(error, "unsupported_store")).toBe(true);
    expect((error as Error).message).toBe("Only supported Shopify stores can be added.");
    expect(await api.listStores()).toMatchObject({ stores: [], brandCount: 0 });
  });

  it("rejects product-page and http addresses", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    expect(isApiError(await errorOf(api.addStore("https://fugazee.com/products/racer-tee")), "invalid_url")).toBe(true);
    expect(isApiError(await errorOf(api.addStore("http://fugazee.com")), "invalid_url")).toBe(true);
  });

  it("reports a store check failure", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    expect(isApiError(await errorOf(api.addStore("https://offline-shop.in")), "check_failed")).toBe(true);
    expect((await api.listStores()).stores).toEqual([]);
  });

  it("returns the existing entry for an alias", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    const first = await api.addStore("fugazee.com");
    const again = await api.addStore("https://fugazee.myshopify.com/collections/all");
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, store: { id: "fugazee" } });
    expect((await api.listStores()).stores).toHaveLength(1);
  });

  it("limits an account to 10 brands and counts storefronts of one brand once", async () => {
    const api = (await signedIn(setup().open(), "a@example.com")) as ReturnType<ReturnType<typeof setup>["open"]>;
    await api.sample.addSampleBrands(9);
    expect((await api.listStores()).brandCount).toBe(9);

    await api.addStore("https://northline.store");
    expect((await api.listStores()).brandCount).toBe(10);

    const error = await errorOf(api.addStore("https://ridgeback.co"));
    expect(isApiError(error, "brand_limit")).toBe(true);
    expect((error as { status: number }).status).toBe(409);

    // A second storefront of a monitored brand is still allowed.
    await api.addStore("https://archive.fugazee.com");
    const stores = await api.listStores();
    expect(stores.brandCount).toBe(10);
    expect(stores.stores.map(store => store.id)).toContain("fugazee-archive");

    // Removing the last store of a brand frees its slot.
    await api.removeStore("northline");
    await api.addStore("https://ridgeback.co");
    expect((await api.listStores()).brandCount).toBe(10);
  });

  it("counts a pending import and releases the slot after a failed first import", async () => {
    const { open, clock } = setup();
    const api = await signedIn(open(), "a@example.com");
    await api.addStore("https://halfmast.in");
    expect((await api.listStores())).toMatchObject({ brandCount: 1, stores: [{ status: "importing" }] });
    clock.now += 10_000;
    expect((await api.listStores())).toMatchObject({ brandCount: 0, stores: [{ status: "import_failed" }] });
  });
});

describe("alerts", () => {
  it("creates one alert per exact sold-out variant and refuses in-stock variants", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    await api.addStore("https://fugazee.com");
    const { items } = await api.listProducts("fugazee", {});
    const detail = await api.getProduct("fugazee", items[0].id);
    const soldOut = detail.variants.find(variant => !variant.available)!;
    const inStock = detail.variants.find(variant => variant.available)!;

    const first = await api.createAlert({ productId: detail.id, variantId: soldOut.id });
    const second = await api.createAlert({ productId: detail.id, variantId: soldOut.id });
    expect(second.id).toBe(first.id);
    expect(first.variantTitle).toBe(soldOut.options.join(" / "));
    expect(isApiError(await errorOf(api.createAlert({ productId: detail.id, variantId: inStock.id })), "not_sold_out")).toBe(true);
    expect(await api.listAlerts()).toHaveLength(1);
  });

  it("cancels the store's active alerts when the account removes the store", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    await api.addStore("https://fugazee.com");
    const { items } = await api.listProducts("fugazee", {});
    const detail = await api.getProduct("fugazee", items[0].id);
    await api.createAlert({ productId: detail.id, variantId: detail.variants.find(variant => !variant.available)!.id });
    await api.removeStore("fugazee");
    expect(await api.listAlerts()).toEqual([]);
  });
});

describe("saved products", () => {
  it("saves once per product, marks products, and keeps accounts apart", async () => {
    const shared = setup();
    const one = await signedIn(shared.open(), "a@example.com");
    const two = await signedIn(shared.open(), "b@example.com");
    await one.addStore("https://fugazee.com");
    await two.addStore("https://fugazee.com");
    const { items } = await one.listProducts("fugazee", {});
    expect(items.every(item => item.saved === false)).toBe(true);

    const first = await one.saveProduct(items[0].id);
    const again = await one.saveProduct(items[0].id);
    expect(again.id).toBe(first.id);
    expect(first.product).toMatchObject({ id: items[0].id, saved: true });
    expect(first.storeName).toBe("Fugazee");
    expect((await one.listProducts("fugazee", {})).items[0].saved).toBe(true);
    expect((await one.getProduct("fugazee", items[0].id)).saved).toBe(true);

    expect(await two.listWishlist()).toEqual([]);
    expect((await two.getProduct("fugazee", items[0].id)).saved).toBe(false);
    expect(isApiError(await errorOf(two.unsaveProduct(items[0].id)), "not_found")).toBe(true);

    expect(await one.unsaveProduct(items[0].id)).toEqual({ cancelledAlerts: 0 });
    expect(await one.listWishlist()).toEqual([]);
  });

  it("an alert saves its product, shows under it, and stops when the product is removed", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    await api.addStore("https://fugazee.com");
    const { items } = await api.listProducts("fugazee", {});
    const detail = await api.getProduct("fugazee", items[0].id);
    const soldOut = detail.variants.find(variant => !variant.available)!;
    const alert = await api.createAlert({ productId: detail.id, variantId: soldOut.id });

    const [saved] = await api.listWishlist();
    expect(saved.product.id).toBe(detail.id);
    expect(saved.alerts).toEqual([
      { id: alert.id, variantId: soldOut.id, variantTitle: soldOut.options.join(" / "), status: "active", createdAt: alert.createdAt, sentAt: null },
    ]);

    // Stopping the alert keeps the product saved.
    await api.cancelAlert(alert.id);
    expect((await api.listWishlist())[0].alerts).toEqual([]);

    await api.createAlert({ productId: detail.id, variantId: soldOut.id });
    expect(await api.unsaveProduct(detail.id)).toEqual({ cancelledAlerts: 1 });
    expect(await api.listAlerts()).toEqual([]);
  });

  it("refuses products from stores the account doesn't monitor, and lists newest first", async () => {
    const shared = setup();
    const api = await signedIn(shared.open(), "a@example.com");
    await api.addStore("https://fugazee.com");
    const { items } = await api.listProducts("fugazee", {});
    await api.saveProduct(items[0].id);
    shared.clock.now += 60_000;
    await api.saveProduct(items[1].id);
    expect((await api.listWishlist()).map(item => item.product.id)).toEqual([items[1].id, items[0].id]);

    const stranger = await signedIn(shared.open(), "c@example.com");
    expect(isApiError(await errorOf(stranger.saveProduct(items[0].id)), "not_found")).toBe(true);

    await api.removeStore("fugazee");
    expect(await api.listWishlist()).toEqual([]);
  });

  it("needs a session", async () => {
    const api = setup().open();
    for (const call of [api.listWishlist(), api.saveProduct("x"), api.unsaveProduct("x")]) {
      expect(isApiError(await errorOf(call), "unauthenticated")).toBe(true);
    }
  });
});

describe("catalogue", () => {
  it("pages and filters products", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    await api.addStore("https://fugazee.com");
    const first = await api.listProducts("fugazee", {});
    expect(first.items).toHaveLength(12);
    expect(first.total).toBe(14);
    const second = await api.listProducts("fugazee", { cursor: first.nextCursor });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();

    const soldOut = await api.listProducts("fugazee", { availability: "out" });
    expect(soldOut.items.every(item => !item.inStock)).toBe(true);
    const cargo = await api.listProducts("fugazee", { q: "cargo" });
    expect(cargo.items.every(item => /cargo/i.test(item.title))).toBe(true);
  });

  it("keeps the last successful data and flags a failed latest check", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    await api.addStore("https://lowtide.in");
    const page = await api.listProducts("lowtide", {});
    expect(page.store.lastCheckFailed).toBe(true);
    expect(page.store.lastSuccessfulCheckAt).not.toBeNull();
    expect(page.items.length).toBeGreaterThan(0);
  });
});

describe("authentication", () => {
  it("asks for the second factor and accepts a recovery code once per code", async () => {
    const { open } = setup();
    const api = await signedIn(open(), "a@example.com");
    await api.startTwoFactorSetup();
    const { recoveryCodes } = await api.confirmTwoFactor("123456");
    await api.signOut();

    expect(await api.signIn("a@example.com", "sample-password")).toEqual({ status: "two_factor_required" });
    expect(isApiError(await errorOf(api.me()), "unauthenticated")).toBe(true);
    const account = await api.verifyTwoFactor(recoveryCodes[0]);
    expect(account.recoveryCodesLeft).toBe(9);
  });

  it("signs out every device after a password reset and keeps two-factor on", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    await api.confirmTwoFactor("123456");
    await api.requestPasswordReset("a@example.com");
    await api.resetPassword(api.sample.signupToken()!, "new-sample-password");
    expect(isApiError(await errorOf(api.me()), "unauthenticated")).toBe(true);
    expect(await api.signIn("a@example.com", "new-sample-password")).toEqual({ status: "two_factor_required" });
  });

  it("signs out of one device", async () => {
    const api = await signedIn(setup().open(), "a@example.com");
    const sessions = await api.listSessions();
    const other = sessions.find(session => !session.current)!;
    await api.revokeSession(other.id);
    expect((await api.listSessions()).map(session => session.id)).not.toContain(other.id);
    expect((await api.me()).email).toBe("a@example.com");
  });
});
