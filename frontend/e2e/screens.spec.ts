import { test } from "@playwright/test";
import { installFakeApi, signIn } from "./fakeApi";

// Screenshots for visual review at the five required widths. Output: test-results/screens/.
const widths = [1440, 1024, 768, 390, 320];

for (const width of widths) {
  test(`screens at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await installFakeApi(page);
    await signIn(page);
    await page.getByRole("heading", { level: 1, name: "My Stores" }).waitFor();
    const shot = (name: string) => page.screenshot({ path: `test-results/screens/${width}-${name}.png`, fullPage: true });
    await shot("01-stores-empty");

    await api.mock.addStore("https://fugazee.com");
    await api.mock.addStore("https://lowtide.in");
    await api.mock.addStore("https://northline.store");
    await api.mock.addStore("https://halfmast.in");
    await page.reload();
    await page.getByRole("list", { name: "Monitored stores" }).waitFor();
    await shot("02-stores");

    await page.getByRole("button", { name: "Add a store" }).click();
    await page.getByLabel("Store URL").fill("https://example.com");
    await page.getByRole("button", { name: "Add store" }).click();
    await page.getByText("Only supported Shopify stores can be added.").waitFor();
    await shot("03-add-store");
    await page.keyboard.press("Escape");

    await page.goto("/stores/fugazee");
    await page.getByText("14 products").waitFor();
    await page.waitForLoadState("networkidle");
    await shot("04-catalogue");

    await page.goto("/stores/fugazee/products/7100000001");
    await page.getByRole("heading", { name: "Price history" }).waitFor();
    await shot("05-product");

    const detail = await api.mock.getProduct("fugazee", "7100000001");
    const soldOut = detail.variants.find(variant => !variant.available)!;
    await api.mock.createAlert({ productId: detail.id, variantId: soldOut.id });
    await page.goto("/saved");
    await page.getByRole("list", { name: "Saved products" }).waitFor();
    await shot("06-saved");

    await page.goto("/updates");
    await page.getByRole("radiogroup", { name: "Show" }).waitFor();
    await shot("07-updates");

    await page.goto("/stores?settings=profile");
    await page.getByRole("dialog", { name: "Settings" }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/screens/${width}-08-settings.png` });
    await page.getByRole("tab", { name: "Devices" }).click();
    await page.getByText("This device").waitFor();
    await page.waitForTimeout(100);
    await page.screenshot({ path: `test-results/screens/${width}-09-settings-devices.png` });
    await page.keyboard.press("Escape");

    if (width < 768) await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: /^Profile menu for / }).click();
    await page.getByRole("menu").waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `test-results/screens/${width}-10-profile-menu.png` });
    await page.keyboard.press("Escape");
    if (width < 768) {
      await page.waitForTimeout(250);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }

    if (width >= 768) {
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Commands" }).waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `test-results/screens/${width}-11-commands.png` });
    }
  });
}
