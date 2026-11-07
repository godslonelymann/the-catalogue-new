import { describe, expect, it, vi } from "vitest";
import { createHttpApi } from "./http";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("createHttpApi", () => {
  it("sends JSON and the CSRF token on writes", async () => {
    document.cookie = "csrf_token=abc123";
    const fetcher = fakeFetch(201, { store: { id: "fugazee" }, created: true });
    const api = createHttpApi("/api", fetcher);
    await api.addStore("https://fugazee.com/");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/stores");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("abc123");
    expect(init.body).toBe(JSON.stringify({ url: "https://fugazee.com/" }));
  });

  it("maps FastAPI error details to ApiError codes", async () => {
    const api = createHttpApi("/api", fakeFetch(422, { detail: { code: "unsupported_store", message: "Only supported Shopify stores can be added." } }));
    await expect(api.addStore("https://example.com/")).rejects.toMatchObject({ status: 422, code: "unsupported_store", message: "Only supported Shopify stores can be added." });
  });

  it("saves and removes wishlist products with PUT and DELETE", async () => {
    document.cookie = "csrf_token=abc123";
    const fetcher = fakeFetch(200, { id: "w1", savedAt: "2026-11-07T10:00:00Z", storeName: "Fugazee", product: { id: "p 1" } });
    const api = createHttpApi("/api", fetcher);
    await api.saveProduct("p 1");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/wishlist/p%201");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("abc123");

    const remove = fakeFetch(204, undefined);
    await createHttpApi("/api", remove).unsaveProduct("p1");
    expect((remove.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("maps 401 without a code to unauthenticated", async () => {
    const api = createHttpApi("/api", fakeFetch(401, { detail: "Not signed in" }));
    await expect(api.me()).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
  });

  it("builds product queries", async () => {
    const fetcher = fakeFetch(200, { items: [] });
    const api = createHttpApi("/api", fetcher);
    await api.listProducts("fugazee", { q: "cargo tee", availability: "in", cursor: "12" });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("/api/stores/fugazee/products?q=cargo+tee&availability=in&cursor=12");
  });
});

describe("session renewal", () => {
  it("renews an expired access token once, then retries the request", async () => {
    const responses = [
      new Response(JSON.stringify({ detail: { code: "unauthenticated", message: "Sign in" } }), { status: 401 }),
      new Response(null, { status: 204 }),
      new Response(JSON.stringify({ id: "1", email: "a@example.com" }), { status: 200 }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);
    const api = createHttpApi("/api", fetcher);
    await expect(api.me()).resolves.toMatchObject({ email: "a@example.com" });
    expect((fetcher.mock.calls as unknown as [string][]).map(call => call[0])).toEqual(["/api/me", "/api/auth/refresh", "/api/me"]);
  });

  it("reports 401 when renewal fails", async () => {
    const fetcher = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ detail: { code: "unauthenticated", message: "Sign in" } }), { status: url.endsWith("/refresh") ? 401 : 401 }),
    );
    const api = createHttpApi("/api", fetcher as unknown as typeof fetch);
    await expect(api.me()).rejects.toMatchObject({ code: "unauthenticated" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
