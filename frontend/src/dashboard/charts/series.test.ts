import { describe, expect, it } from "vitest";
import { checkCells, checkLevel, dailyPrices, priceChanges, priceRange } from "./series";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9, 15);
const iso = (daysAgo: number, hour = 6) => new Date(Date.UTC(2026, 10, 9 - daysAgo, hour)).toISOString();

describe("dailyPrices", () => {
  it("holds each price until the next change, one point per day", () => {
    const series = dailyPrices(
      [
        { at: iso(5), price: 1000 },
        { at: iso(2), price: 800 },
      ],
      30,
      NOW,
    );
    expect(series.map(point => point.value)).toEqual([1000, 1000, 1000, 800, 800, 800]);
    expect(series.at(-1)!.date).toBe(Date.UTC(2026, 10, 9));
    expect(series[1].date - series[0].date).toBe(DAY);
  });

  it("starts at the range when history is longer, and uses the price in force then", () => {
    const series = dailyPrices(
      [
        { at: iso(60), price: 1200 },
        { at: iso(10), price: 900 },
      ],
      30,
      NOW,
    );
    expect(series).toHaveLength(30);
    expect(series[0].value).toBe(1200);
    expect(series.at(-1)!.value).toBe(900);
  });

  it("draws a line for a single price seen today, and nothing without prices", () => {
    expect(dailyPrices([{ at: iso(0), price: 500 }], 30, NOW)).toHaveLength(2);
    expect(dailyPrices([], 30, NOW)).toEqual([]);
  });

  it("finds the lowest and highest price", () => {
    const series = dailyPrices(
      [
        { at: iso(4), price: 900 },
        { at: iso(3), price: 700 },
        { at: iso(1), price: 1100 },
      ],
      30,
      NOW,
    );
    const range = priceRange(series)!;
    expect([range.low.value, range.high.value]).toEqual([700, 1100]);
  });
});

describe("priceChanges", () => {
  it("lists each day the price moved, with the old and new price", () => {
    const series = dailyPrices(
      [
        { at: iso(6), price: 1000 },
        { at: iso(4), price: 800 },
        { at: iso(1), price: 900 },
      ],
      30,
      NOW,
    );
    expect(priceChanges(series).map(change => [change.index, change.from, change.to])).toEqual([
      [2, 1000, 800],
      [5, 800, 900],
    ]);
    expect(priceChanges(dailyPrices([{ at: iso(3), price: 500 }], 30, NOW))).toEqual([]);
  });
});

describe("check grid", () => {
  it("lists every day and keeps the check of each", () => {
    const cells = checkCells("2026-11-01", "2026-11-03", [{ day: "2026-11-02", ok: true, changes: 3 }]);
    expect(cells.map(cell => [cell.day, cell.check?.changes ?? null])).toEqual([
      ["2026-11-01", null],
      ["2026-11-02", 3],
      ["2026-11-03", null],
    ]);
  });

  it("maps checks to levels", () => {
    expect(checkLevel(null)).toBe(0);
    expect(checkLevel({ day: "", ok: false, changes: 0 })).toBe("failed");
    expect([0, 1, 4, 9].map(changes => checkLevel({ day: "", ok: true, changes }))).toEqual([1, 2, 3, 4]);
  });
});
