import { expect, test, type Page } from "@playwright/test";
import { installFakeApi, signIn } from "./fakeApi";

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
/** The app uses Command+K on macOS and Control+K elsewhere, from the browser's platform. */
async function pressCommandShortcut(page: Page) {
  const mac = await page.evaluate(() =>
    /mac|iphone|ipad|ipod/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform),
  );
  await page.keyboard.press(mac ? "Meta+k" : "Control+k");
}

async function openNav(page: Page, name: string) {
  if (isMobile(page)) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();
}

/** Opens the profile menu: from the sidebar on desktop, from the Menu Sheet on mobile. */
async function openProfileMenu(page: Page) {
  if (isMobile(page)) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: /^Profile menu for / }).click();
}

test.describe("authentication and private routes", () => {
  test("a signed-out visitor goes to sign-in", async ({ page }) => {
    await installFakeApi(page);
    for (const path of ["/stores/fugazee", "/saved", "/updates", "/alerts", "/wishlist"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Welcome back" }), path).toBeVisible();
    }
  });

  test("Google sign-in returns to My Stores", async ({ page }) => {
    await installFakeApi(page);
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My Stores" })).toBeVisible();
  });

  test("sign out from the profile menu, and see the error when it fails", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    api.fail(/\/api\/auth\/sign-out/, 500, 1);
    await openProfileMenu(page);
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["Settings", "Sign out"]);
    await expect(menu.getByText("anurag.works@example.com")).toBeVisible();
    await menu.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn’t sign out" })).toBeVisible();

    await page.getByRole("button", { name: /^Profile menu for / }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });
});

test.describe("shell", () => {
  test("navigation, breadcrumbs, and Commands", async ({ page }) => {
    test.skip(isMobile(page), "Commands opens from the keyboard shortcut only.");
    const api = await installFakeApi(page);
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: "My Stores" })).toBeVisible();
    await api.mock.addStore("https://fugazee.com");

    // The keyboard shortcut opens Commands. Add a store opens after Commands closes.
    await page.getByRole("heading", { level: 1 }).click();
    await pressCommandShortcut(page);
    const commands = page.getByRole("dialog", { name: "Commands" });
    await expect(commands).toBeVisible();
    await expect(commands.getByRole("option")).toHaveText(["My Stores", "Updates", "Saved", "Add a store"]);
    await page.keyboard.press("Escape");
    await expect(commands).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "My Stores" })).toBeFocused();

    await openNav(page, "Updates");
    await expect(page.getByRole("heading", { level: 1, name: "Updates" })).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await pressCommandShortcut(page);
    await page.keyboard.type("add");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Add a store" })).toBeVisible();
    await expect(page).toHaveURL(/\/stores$/);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByLabel("Store URL")).toBeFocused();
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Browse products" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Fugazee" })).toBeVisible();
    const crumbs = page.getByRole("navigation", { name: "breadcrumb" }).filter({ visible: true });
    await expect(crumbs).toContainText("My Stores");
    await expect(crumbs).toContainText("Fugazee");

    // My Stores stays selected on catalogue routes.
    if (isMobile(page)) await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My Stores" })).toHaveAttribute("aria-current", "location");
  });

  test("Settings: four tabs, focus returns to the opener, query cleared", async ({ page }) => {
    await installFakeApi(page);
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: "My Stores" })).toBeVisible();

    await openProfileMenu(page);
    await page.getByRole("menuitem", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(settings.getByRole("tab")).toHaveText(["Profile", "Password", "Two-factor authentication", "Devices"]);
    await expect(settings.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    await expect(settings.getByText("anurag.works@example.com")).toBeVisible();
    // The dashboard page stays behind the dialog.
    await expect(page.getByRole("heading", { level: 1, name: "My Stores", includeHidden: true })).toBeAttached();

    await settings.getByRole("tab", { name: "Password" }).click();
    await expect(settings.getByText("every device is signed out")).toBeVisible();
    await settings.getByRole("tab", { name: "Two-factor authentication" }).click();
    await settings.getByRole("button", { name: "Set up" }).click();
    await expect(settings.getByRole("img", { name: "QR code for two-factor setup" }).locator("svg")).toBeVisible();
    // The key is a fallback for people who can't scan.
    await expect(settings.getByLabel("Setup key")).toBeHidden();
    await settings.getByText("Can’t scan the code? Enter a key instead").click();
    await expect(settings.getByLabel("Setup key")).toBeVisible();
    await settings.getByLabel("Code from your authenticator app").fill("123456");
    await settings.getByRole("button", { name: "Turn on" }).click();
    await expect(settings.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveCount(10);
    await settings.getByRole("button", { name: "I saved my codes" }).click();
    await expect(settings.getByText("10 recovery codes left")).toBeVisible();
    await settings.getByRole("tab", { name: "Devices" }).click();
    await expect(settings.getByText("This device")).toBeVisible();
    await settings.getByRole("button", { name: "Sign out" }).nth(1).click();
    await expect(settings.getByRole("listitem")).toHaveCount(2);

    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    const opener = isMobile(page) ? page.getByRole("button", { name: "Menu" }) : page.getByRole("button", { name: /^Profile menu for / });
    await expect(opener).toBeFocused();

    // Sensitive state is cleared: the setup key is gone after reopening.
    await openProfileMenu(page);
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Two-factor authentication" }).click();
    await expect(page.getByLabel("Setup key")).toHaveCount(0);
  });

  test("profile control works with the keyboard", async ({ page }) => {
    test.skip(isMobile(page), "Keyboard check runs on desktop.");
    await installFakeApi(page);
    await signIn(page);
    const trigger = page.getByRole("button", { name: "Profile menu for anurag.works@example.com" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    const box = await trigger.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("/account returns to Settings after Google linking", async ({ page }) => {
    await installFakeApi(page);
    await signIn(page);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/stores\?settings=profile$/);
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Link Google" }).click();
    // The fake Google callback returns to /account?google=linked.
    await expect(page).toHaveURL(/\/stores\?settings=profile&google=linked$/);
    await expect(settings.getByText("Google is now linked to your account.")).toBeVisible();
    await expect(settings.getByText("Linked", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/stores$/);
  });

  test("sign out of the current device from Devices", async ({ page }) => {
    await installFakeApi(page);
    await signIn(page);
    await page.goto("/account");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("tab", { name: "Devices" }).click();
    const current = settings.getByRole("listitem").filter({ hasText: "This device" });
    await current.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });
});

test.describe("stores", () => {
  test("loading, empty, importing, ready, failed, and retry states", async ({ page }) => {
    const api = await installFakeApi(page);
    api.delay(/^\/api\/stores$/, 600);
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: "My Stores" })).toBeVisible();
    await expect(page.getByText("Follow your first store")).toBeVisible();

    await page.getByRole("button", { name: "Add a store" }).click();
    await page.getByLabel("Store URL").fill("https://northline.store");
    await page.getByRole("button", { name: "Add store" }).click();
    const list = page.getByRole("list", { name: "Monitored stores" });
    await expect(list.getByText("Importing catalogue")).toBeVisible();
    await expect(list.getByText("Awaiting first successful check")).toBeVisible();
    await expect(list.getByRole("link", { name: "Browse products" })).toBeVisible();
    // Polling continues until the import is done.
    await expect(list.getByText("Ready")).toBeVisible({ timeout: 15_000 });
    await expect(list.getByText(/8 products/)).toBeVisible();

    await page.getByRole("button", { name: "Add a store" }).click();
    await page.getByLabel("Store URL").fill("https://halfmast.in");
    await page.getByRole("button", { name: "Add store" }).click();
    await expect(list.getByText("Import failed")).toBeVisible({ timeout: 15_000 });
    await list.getByRole("button", { name: "Retry import" }).click();
    await expect(page.getByLabel("Store URL")).toHaveValue("https://halfmast.in/");
    await page.keyboard.press("Escape");

    // Development StrictMode requests twice, so fail both requests.
    api.fail(/^\/api\/stores$/, 500, 2);
    await page.reload();
    await expect(page.getByText("Couldn’t load your stores")).toBeVisible();
    await expect(page.getByText("Follow your first store")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(list.getByText("Northline", { exact: true })).toBeVisible();
  });

  test("rejected URLs, duplicates, removal, and the ten-brand limit", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await expect(page.getByText("0 of 10 brands")).toBeVisible();
    await api.mock.sample.addSampleBrands(9);
    await page.reload();
    await expect(page.getByText("9 of 10 brands")).toBeVisible();

    await page.getByRole("button", { name: "Add a store" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a store" });
    await dialog.getByLabel("Store URL").fill("https://example.com");
    await dialog.getByRole("button", { name: "Add store" }).click();
    await expect(dialog.getByText("Only supported Shopify stores can be added.")).toBeVisible();
    await expect(dialog.getByLabel("Store URL")).toHaveValue("https://example.com");

    await dialog.getByLabel("Store URL").fill("https://fugazee.myshopify.com");
    await dialog.getByRole("button", { name: "Add store" }).click();
    await expect(dialog.getByText(/You already monitor Fugazee\./)).toBeVisible();

    await dialog.getByLabel("Store URL").fill("https://northline.store");
    await dialog.getByRole("button", { name: "Add store" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("10 of 10 brands")).toBeVisible();

    await page.getByRole("button", { name: "Add a store" }).click();
    await dialog.getByLabel("Store URL").fill("https://ridgeback.co");
    await dialog.getByRole("button", { name: "Add store" }).click();
    await expect(dialog.getByText("You monitor 10 brands, the limit. Remove a brand to add a new one.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Add a store" })).toBeFocused();

    // Removal frees the brand slot. The row stays until the API confirms.
    api.delay(/^\/api\/stores\/northline$/, 500);
    await page.getByRole("button", { name: "Remove Northline" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Remove Northline?" });
    await confirm.getByRole("button", { name: "Remove Northline" }).click();
    await expect(confirm.getByRole("button", { name: "Removing…" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Monitored stores", includeHidden: true }).getByText("Northline", { exact: true })).toBeAttached();
    await expect(confirm).toBeHidden();
    await expect(page.getByText("9 of 10 brands")).toBeVisible();
  });
});

test.describe("catalogue and product", () => {
  test("search order, availability, pagination, and an exact-variant alert", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await api.mock.addStore("https://fugazee.com");
    await page.goto("/stores/fugazee");
    await expect(page.getByRole("heading", { level: 1, name: "Fugazee" })).toBeVisible();
    await expect(page.getByText("14 products")).toBeVisible();
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await expect(page.getByRole("list", { name: "Products" }).getByRole("listitem")).toHaveCount(2);

    // A slow, older search response must not replace a newer one.
    api.delay(/q=hood/, 1200);
    await page.getByLabel("Search products").fill("hood");
    await page.waitForTimeout(400);
    await page.getByLabel("Search products").fill("cargo");
    await expect(page.getByText("Page 1 of 2")).toBeHidden();
    await expect(page.getByRole("list", { name: "Products" }).getByRole("listitem").first()).toContainText(/Cargo/);
    await page.waitForTimeout(1300);
    for (const title of await page.getByRole("list", { name: "Products" }).locator("h2").allTextContents()) expect(title).toMatch(/Cargo/);
    expect(api.requests.filter(request => request.includes("q=c") && !request.includes("q=cargo"))).toHaveLength(0);

    await page.getByRole("radio", { name: "Sold out" }).click();
    await expect(page.getByRole("radio", { name: "Sold out" })).toBeChecked();
    await page.getByLabel("Search products").fill("zzz");
    await expect(page.getByText("No matching products")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByText("14 products")).toBeVisible();

    await page.getByRole("link", { name: "Racer Club Oversized Tee" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Racer Club Oversized Tee" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Visit store/ })).toHaveAttribute("target", "_blank");

    // Pick a sold-out variant. Sold-out options stay selectable.
    const colours = await page.locator("fieldset").first().getByRole("button").all();
    for (const colour of colours) {
      await colour.click();
      const soldOut = page.locator("fieldset").last().getByRole("button", { name: /sold out/ });
      if (await soldOut.count()) {
        await soldOut.first().click();
        break;
      }
    }
    const size = (await page.locator("fieldset").last().getByRole("button", { pressed: true }).textContent()) ?? "";
    await expect(page.getByRole("button", { name: "Email me when it’s back" })).toBeEnabled();
    await page.getByRole("button", { name: "Email me when it’s back" }).click();
    await expect(page.getByText("Watching this size")).toBeVisible();
    // Setting an alert also saves the product.
    await expect(page.getByRole("button", { name: "Remove Racer Club Oversized Tee from Saved" })).toHaveAttribute("aria-pressed", "true");

    await openNav(page, "Saved");
    const row = page.getByRole("list", { name: "Saved products" }).getByRole("listitem").filter({ hasText: "Racer Club Oversized Tee" });
    await expect(row).toHaveCount(1);
    const watched = row.getByRole("list", { name: "Sizes watched for Racer Club Oversized Tee" });
    await expect(watched).toContainText("Watching");
    await expect(watched).toContainText(size);

    // Stopping the alert keeps the product saved.
    api.delay(/^\/api\/alerts\//, 500);
    await watched.getByRole("button", { name: /^Stop watching/ }).click();
    await expect(watched.getByRole("button", { name: /^Stop watching/ })).toBeDisabled();
    await expect(watched).toContainText("Waiting for a sold-out size?");
    await expect(row).toHaveCount(1);

    await openNav(page, "Updates");
    const updates = page.getByRole("list", { name: "Updates" }).getByRole("listitem");
    await expect(updates.first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Updates" })).toContainText("Price changed");
    await expect(page.getByRole("list", { name: "Updates" })).toContainText("Back in stock");
  });
});

test.describe("saved", () => {
  test("save from a card and the product page, list, and remove", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await api.mock.addStore("https://fugazee.com");
    await page.goto("/stores/fugazee");
    const products = page.getByRole("list", { name: "Products" });
    await expect(products.getByRole("listitem").first()).toBeVisible();

    // The heart on a card saves without opening the product.
    const heart = products.getByRole("button", { name: "Save Racer Club Oversized Tee" });
    await heart.click();
    await expect(products.getByRole("button", { name: "Remove Racer Club Oversized Tee from Saved" })).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\/stores\/fugazee$/);

    // The product page shows the same state, and saves another product.
    await products.getByRole("link").nth(1).click();
    await expect(page).toHaveURL(/\/products\//);
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Fugazee");
    const title = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
    await page.getByRole("button", { name: `Save ${title}` }).click();
    await expect(page.getByRole("button", { name: `Remove ${title} from Saved` })).toHaveText("Saved");

    await openNav(page, "Saved");
    await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeVisible();
    // Top-level rows only: each row also has a small list of watched sizes.
    const saved = page.getByRole("list", { name: "Saved products" }).locator(":scope > li");
    await expect(saved).toHaveCount(2);
    await expect(saved.first()).toContainText(title); // Newest first.
    await expect(saved.first()).toContainText("Fugazee");

    await saved.first().getByRole("button", { name: `Remove ${title} from Saved` }).click();
    await expect(saved).toHaveCount(1);
    await saved.first().getByRole("button", { name: /from Saved/ }).click();
    await expect(page.getByText("Nothing saved yet")).toBeVisible();
  });

  test("removing a saved product stops its size alerts", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await api.mock.addStore("https://fugazee.com");
    const detail = await api.mock.getProduct("fugazee", "7100000001");
    const soldOut = detail.variants.find(variant => !variant.available)!;
    await api.mock.createAlert({ productId: detail.id, variantId: soldOut.id });
    await page.goto("/alerts"); // Old address: opens Saved.
    await expect(page).toHaveURL(/\/saved$/);
    const row = page.getByRole("list", { name: "Saved products" }).getByRole("listitem").filter({ hasText: detail.title });
    await expect(row).toContainText("Watching");
    await row.getByRole("button", { name: `Remove ${detail.title} from Saved and stop 1 size alert` }).click();
    await expect(page.getByText("Nothing saved yet")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("1 size alert stopped");
    expect(await api.mock.listAlerts()).toEqual([]);
  });

  test("removing the store removes its saved products", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await api.mock.addStore("https://fugazee.com");
    const { items } = await api.mock.listProducts("fugazee", {});
    await api.mock.saveProduct(items[0].id);
    await page.goto("/saved");
    await expect(page.getByRole("list", { name: "Saved products" }).locator(":scope > li")).toHaveCount(1);
    await api.mock.removeStore("fugazee");
    await page.reload();
    await expect(page.getByText("Nothing saved yet")).toBeVisible();
  });
});

test.describe("layout", () => {
  test("no horizontal overflow on signed-in views", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await api.mock.addStore("https://fugazee.com");
    await api.mock.addStore("https://lowtide.in");
    for (const path of ["/stores", "/stores/fugazee", "/stores/fugazee/products/7100000000", "/updates", "/saved", "/stores?settings=profile"]) {
      await page.goto(path);
      await expect(page.locator("#main h1")).toBeAttached();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("reduced motion turns off transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const api = await installFakeApi(page);
    await signIn(page);
    await api.mock.addStore("https://fugazee.com");
    await page.goto("/stores/fugazee");
    const indicator = page.locator('[role="radiogroup"] > span[aria-hidden="true"]');
    await expect(indicator).toHaveCSS("transition-duration", "0s");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(indicator).toHaveCSS("transition-duration", "0.16s");
  });
});

test.describe("sidebar rail", () => {
  const railWidth = (page: Page) =>
    page.locator("#rail > div").evaluate(element => Math.round(element.getBoundingClientRect().width));

  test("expands on hover and on keyboard focus, and collapses after", async ({ page }) => {
    test.skip(isMobile(page), "The rail is for 768 px and wider.");
    await installFakeApi(page);
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: "My Stores" })).toBeVisible();
    await page.mouse.move(900, 500);
    await expect.poll(() => railWidth(page)).toBe(60);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Updates" }).hover();
    await expect.poll(() => railWidth(page)).toBe(300);
    await expect(page.getByRole("navigation", { name: "Main" }).getByText("Updates")).toBeVisible();
    await page.mouse.move(900, 500);
    await expect.poll(() => railWidth(page)).toBe(60);

    await page.getByRole("link", { name: "Skip to content" }).focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => railWidth(page)).toBe(300);
  });

  test("reduced motion: the rail changes width at once", async ({ page }) => {
    test.skip(isMobile(page), "The rail is for 768 px and wider.");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installFakeApi(page);
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: "My Stores" })).toBeVisible();
    await page.mouse.move(900, 500);
    await expect.poll(() => railWidth(page)).toBe(60);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Saved" }).hover();
    await page.waitForTimeout(40);
    expect(await railWidth(page)).toBe(300);
  });
});
