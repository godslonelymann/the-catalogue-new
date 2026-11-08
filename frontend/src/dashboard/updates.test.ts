import { describe, expect, it } from "vitest";
import type { CatalogueUpdate } from "@/api/types";
import { byDay, dayLabel, filterGroups, groupUpdates, localDay, percentChange } from "./updates";

let next = 0;
function update(fields: Partial<CatalogueUpdate>): CatalogueUpdate {
  return {
    id: "u" + next++,
    kind: "restock",
    storeId: "s1",
    storeName: "Kiln & Co",
    productId: "p1",
    productTitle: "Studio Zip Hoodie",
    imageUrl: "",
    variantId: "v1",
    variantTitle: "Brick / S",
    currency: "INR",
    oldPrice: null,
    newPrice: null,
    at: new Date(2026, 10, 9, 10).toISOString(),
    nowAvailable: true,
    nowPrice: 279900,
    saved: false,
    watched: false,
    ...fields,
  };
}

describe("groupUpdates", () => {
  it("puts one product's changes on one day in one group, with lines in a fixed order", () => {
    const groups = groupUpdates([
      update({ kind: "sold_out", variantId: "v1", variantTitle: "Brick / S" }),
      update({ kind: "restock", variantId: "v2", variantTitle: "Brick / L" }),
      update({ kind: "restock", variantId: "v3", variantTitle: "Navy / M", watched: true }),
      update({ kind: "price_drop", variantId: null, variantTitle: null, oldPrice: 279900, newPrice: 229900 }),
    ]);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.lines.map(line => line.kind)).toEqual(["price_drop", "restock", "sold_out"]);
    expect(group.lines[1].options.map(option => option.title)).toEqual(["Brick / L", "Navy / M"]);
    expect(group.watched).toBe(true);
    // The card links to the watched size.
    expect(group.variantId).toBe("v3");
  });

  it("keeps different days and different products apart", () => {
    const groups = groupUpdates([
      update({ productId: "p1" }),
      update({ productId: "p2", variantId: "v9" }),
      update({ productId: "p1", at: new Date(2026, 10, 8, 10).toISOString() }),
    ]);
    expect(groups.map(group => `${group.productId} ${group.day}`)).toEqual(["p1 2026-11-09", "p2 2026-11-09", "p1 2026-11-08"]);
    expect(byDay(groups).map(day => day.groups.length)).toEqual([2, 1]);
  });

  it("splits price changes with different prices into separate lines", () => {
    const [group] = groupUpdates([
      update({ kind: "price_drop", variantId: "v1", oldPrice: 100, newPrice: 80 }),
      update({ kind: "price_drop", variantId: "v2", oldPrice: 120, newPrice: 100 }),
      update({ kind: "price_drop", variantId: "v3", oldPrice: 100, newPrice: 80 }),
    ]);
    expect(group.lines.map(line => line.options.length)).toEqual([2, 1]);
  });
});

describe("filterGroups", () => {
  const groups = groupUpdates([
    update({ productId: "p1", kind: "sold_out" }),
    update({ productId: "p1", kind: "restock", variantId: "v2" }),
    update({ productId: "p2", kind: "sold_out", saved: true }),
    update({ productId: "p3", kind: "sold_out", storeId: "s2" }),
  ]);

  it("leaves sell-outs of products the account doesn't follow out of All, and counts them", () => {
    const { groups: visible, hiddenSoldOut } = filterGroups(groups, "all");
    expect(visible.map(group => [group.productId, group.lines.map(line => line.kind)])).toEqual([
      ["p1", ["restock"]],
      ["p2", ["sold_out"]],
    ]);
    expect(hiddenSoldOut).toBe(2);
  });

  it("shows only the chosen kind and store", () => {
    expect(filterGroups(groups, "sold_out").groups.map(group => group.productId)).toEqual(["p1", "p2", "p3"]);
    expect(filterGroups(groups, "sold_out", "s2").groups.map(group => group.productId)).toEqual(["p3"]);
    expect(filterGroups(groups, "price_drop").groups).toEqual([]);
  });
});

describe("labels", () => {
  const now = new Date(2026, 10, 9, 15);
  it("names recent days", () => {
    expect(dayLabel("2026-11-09", now)).toBe("Today");
    expect(dayLabel("2026-11-08", now)).toBe("Yesterday");
    expect(dayLabel(localDay(new Date(2026, 10, 5).toISOString()), now)).not.toMatch(/Nov/);
    expect(dayLabel("2026-10-20", now)).toMatch(/20/);
  });

  it("rounds the price change to a whole percent", () => {
    expect(percentChange(129900, 89900)).toBe(-31);
    expect(percentChange(100000, 109000)).toBe(9);
    expect(percentChange(0, 100)).toBe(0);
  });
});
