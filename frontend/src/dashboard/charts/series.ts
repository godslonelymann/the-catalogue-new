import type { CheckDay, PricePoint } from "@/api/types";

/** One day on the price chart. `date` is UTC midnight in ms. `value` is in the currency's minor unit. */
export interface ChartPoint {
  date: number;
  value: number;
}

const DAY = 86_400_000;
const utcMidnight = (time: number) => Math.floor(time / DAY) * DAY;

/**
 * Turns dated price changes into one price per day, for the last `days` days.
 * A price holds until the next change. The series starts at the first known price if that is later,
 * and always has at least two points, so a line can be drawn.
 */
export function dailyPrices(history: PricePoint[], days: number, now = Date.now()): ChartPoint[] {
  const points = history
    .map(point => ({ time: Date.parse(point.at), price: point.price }))
    .filter(point => Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);
  if (points.length === 0) return [];
  const today = utcMidnight(now);
  const start = Math.max(today - (days - 1) * DAY, utcMidnight(points[0].time));
  const series: ChartPoint[] = [];
  let index = 0;
  let price = points[0].price;
  for (let day = start; day <= today; day += DAY) {
    // The price at the end of the day.
    while (index < points.length && points[index].time < day + DAY) price = points[index++].price;
    series.push({ date: day, value: price });
  }
  if (series.length === 1) series.unshift({ date: series[0].date - DAY, value: series[0].value });
  return series;
}

/** The lowest and highest price in a series, with the first day each was reached. */
export function priceRange(series: ChartPoint[]): { low: ChartPoint; high: ChartPoint } | null {
  if (series.length === 0) return null;
  let low = series[0];
  let high = series[0];
  for (const point of series) {
    if (point.value < low.value) low = point;
    if (point.value > high.value) high = point;
  }
  return { low, high };
}

/** A cell of the check grid: one UTC day, with its check, if any. */
export interface CheckCell {
  day: string;
  check: CheckDay | null;
}

/** Every day from `from` to `to` (YYYY-MM-DD, UTC), oldest first, with the check of that day. */
export function checkCells(from: string, to: string, days: CheckDay[]): CheckCell[] {
  const byDay = new Map(days.map(day => [day.day, day]));
  const cells: CheckCell[] = [];
  const end = Date.parse(to + "T00:00:00Z");
  for (let time = Date.parse(from + "T00:00:00Z"); time <= end; time += DAY) {
    const day = new Date(time).toISOString().slice(0, 10);
    cells.push({ day, check: byDay.get(day) ?? null });
  }
  return cells;
}

/** 0 for no check, "failed", or a level from 1 (checked, no changes) to 4 (many changes). */
export type CheckLevel = 0 | 1 | 2 | 3 | 4 | "failed";

export function checkLevel(check: CheckDay | null): CheckLevel {
  if (!check) return 0;
  if (!check.ok) return "failed";
  if (check.changes === 0) return 1;
  if (check.changes <= 2) return 2;
  if (check.changes <= 5) return 3;
  return 4;
}

/** A day when the price differed from the day before. */
export interface PriceChange {
  /** Index of the day in the series. */
  index: number;
  date: number;
  from: number;
  to: number;
}

export function priceChanges(series: ChartPoint[]): PriceChange[] {
  const changes: PriceChange[] = [];
  for (let index = 1; index < series.length; index++) {
    const from = series[index - 1].value;
    const to = series[index].value;
    if (from !== to) changes.push({ index, date: series[index].date, from, to });
  }
  return changes;
}
