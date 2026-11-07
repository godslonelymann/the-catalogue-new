import { expect, test } from "@playwright/test";
import { installFakeApi, signIn } from "./fakeApi";

// Product columns by viewport width: 4 from 1200 px, 3 from 768 px, 2 from 360 px, 1 below.
for (const [width, columns] of [[1440, 4], [1200, 4], [1199, 3], [768, 3], [767, 2], [360, 2], [359, 1], [320, 1]] as const) {
  test(`${columns} product columns at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await installFakeApi(page);
    await signIn(page);
    await api.mock.addStore("https://fugazee.com");
    await page.goto("/stores/fugazee");
    const grid = page.getByRole("list", { name: "Products" });
    await expect(grid.getByRole("listitem").first()).toBeVisible();
    const count = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(count).toBe(columns);
    const gap = await grid.evaluate(el => getComputedStyle(el).columnGap);
    expect(gap).toBe(width >= 768 ? "16px" : "12px");
  });
}
