// A fake /api for Playwright. It serves sample data from the test mock through the
// same HTTP routes that the real FastAPI app exposes, so the browser runs the real
// HTTP client. Sample data is used in tests only.

import type { Page, Route } from "@playwright/test";
import { ApiError } from "../src/api/client";
import { createMockApi, type MockApi } from "../src/test/mock/mockApi";

type Handler = (url: URL, body: Record<string, unknown>) => Promise<unknown>;

export interface FakeApi {
  mock: MockApi;
  /** Delay matching requests, for example to check response order. */
  delay(match: RegExp, ms: number): void;
  /** Fail the next matching requests with this status. */
  fail(match: RegExp, status?: number, times?: number): void;
  requests: string[];
}

export async function installFakeApi(page: Page): Promise<FakeApi> {
  const mock = createMockApi({ delayMs: 0 });
  const delays: { match: RegExp; ms: number }[] = [];
  const failures: { match: RegExp; status: number; times: number }[] = [];
  const requests: string[] = [];

  const routes: [method: string, pattern: RegExp, handler: (match: RegExpMatchArray) => Handler][] = [
    ["GET", /^\/api\/me$/, () => () => mock.me()],
    ["POST", /^\/api\/auth\/sign-in$/, () => (_, body) => mock.signIn(String(body.email), String(body.password))],
    ["POST", /^\/api\/auth\/two-factor$/, () => (_, body) => mock.verifyTwoFactor(String(body.code))],
    ["POST", /^\/api\/auth\/sign-out$/, () => () => mock.signOut()],
    ["GET", /^\/api\/sessions$/, () => () => mock.listSessions()],
    ["DELETE", /^\/api\/sessions$/, () => () => mock.revokeAllSessions()],
    ["DELETE", /^\/api\/sessions\/([^/]+)$/, match => () => mock.revokeSession(decodeURIComponent(match[1]))],
    ["POST", /^\/api\/account\/password$/, () => (_, body) => mock.changePassword(String(body.current), String(body.next))],
    ["POST", /^\/api\/account\/two-factor\/setup$/, () => () => mock.startTwoFactorSetup()],
    ["POST", /^\/api\/account\/two-factor\/confirm$/, () => (_, body) => mock.confirmTwoFactor(String(body.code))],
    ["POST", /^\/api\/account\/two-factor\/disable$/, () => (_, body) => mock.disableTwoFactor(String(body.code))],
    ["GET", /^\/api\/stores$/, () => () => mock.listStores()],
    ["POST", /^\/api\/stores$/, () => (_, body) => mock.addStore(String(body.url))],
    ["DELETE", /^\/api\/stores\/([^/]+)$/, match => () => mock.removeStore(decodeURIComponent(match[1]))],
    [
      "GET",
      /^\/api\/stores\/([^/]+)\/products$/,
      match => url =>
        mock.listProducts(decodeURIComponent(match[1]), {
          q: url.searchParams.get("q") ?? "",
          availability: (url.searchParams.get("availability") ?? "") as "" | "in" | "out",
          cursor: url.searchParams.get("cursor"),
        }),
    ],
    ["GET", /^\/api\/stores\/([^/]+)\/products\/([^/]+)$/, match => () => mock.getProduct(decodeURIComponent(match[1]), decodeURIComponent(match[2]))],
    ["GET", /^\/api\/updates$/, () => () => mock.listUpdates()],
    ["GET", /^\/api\/alerts$/, () => () => mock.listAlerts()],
    ["POST", /^\/api\/alerts$/, () => (_, body) => mock.createAlert({ productId: String(body.productId), variantId: String(body.variantId) })],
    ["DELETE", /^\/api\/alerts\/([^/]+)$/, match => () => mock.cancelAlert(decodeURIComponent(match[1]))],
    ["GET", /^\/api\/wishlist$/, () => () => mock.listWishlist()],
    ["PUT", /^\/api\/wishlist\/([^/]+)$/, match => () => mock.saveProduct(decodeURIComponent(match[1]))],
    ["DELETE", /^\/api\/wishlist\/([^/]+)$/, match => () => mock.unsaveProduct(decodeURIComponent(match[1]))],
  ];

  // Match only /api paths. A glob would also catch Vite source modules under /src/api/.
  await page.route(url => url.pathname.startsWith("/api/"), async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    requests.push(`${method} ${url.pathname}${url.search}`);

    for (const delay of delays) if (delay.match.test(url.pathname + url.search)) await new Promise(resolve => setTimeout(resolve, delay.ms));

    const failure = failures.find(item => item.times > 0 && item.match.test(url.pathname + url.search));
    if (failure) {
      failure.times -= 1;
      return route.fulfill({ status: failure.status, json: { detail: { code: "unknown", message: "The server had a problem. Try again." } } });
    }

    // Google sign-in and linking are full-page redirects. The fake sends the browser straight back.
    if (method === "GET" && url.pathname === "/api/auth/google/start") {
      const returnTo = url.searchParams.get("return_to") ?? "/stores";
      if (url.searchParams.get("intent") === "link") {
        await mock.linkGoogle();
        return route.fulfill({ status: 302, headers: { location: `${returnTo}?google=linked` } });
      }
      await mock.startGoogleSignIn();
      return route.fulfill({ status: 302, headers: { location: returnTo } });
    }

    for (const [routeMethod, pattern, handler] of routes) {
      const match = url.pathname.match(pattern);
      if (!match || routeMethod !== method) continue;
      const body = (request.postData() ? JSON.parse(request.postData()!) : {}) as Record<string, unknown>;
      try {
        const result = await handler(match)(url, body);
        return result === undefined
          ? route.fulfill({ status: 204 })
          : route.fulfill({ status: 200, json: result, headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        if (error instanceof ApiError) {
          return route.fulfill({ status: error.status, json: { detail: { code: error.code, message: error.message } } });
        }
        throw error;
      }
    }
    return route.fulfill({ status: 404, json: { detail: { code: "not_found", message: "Not found" } } });
  });

  return {
    mock,
    requests,
    delay: (match, ms) => void delays.push({ match, ms }),
    fail: (match, status = 500, times = 1) => void failures.push({ match, status, times }),
  };
}

/** Signs in through the UI with a sample account. */
export async function signIn(page: Page, email = "anurag.works@example.com", path = "/stores") {
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("sample-password");
  await page.getByRole("button", { name: "Sign in" }).click();
}
