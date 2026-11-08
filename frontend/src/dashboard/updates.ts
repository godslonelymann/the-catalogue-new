import type { CatalogueUpdate, UpdateKind } from "@/api/types";

/** The filters on the Updates page. Price rises show only under "all". */
export type UpdateFilter = "all" | "price_drop" | "restock" | "sold_out";

export const updateFilters: { value: UpdateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "price_drop", label: "Price drops" },
  { value: "restock", label: "Restocks" },
  { value: "sold_out", label: "Sold out" },
];

export const isUpdateFilter = (value: string | null): value is UpdateFilter => updateFilters.some(filter => filter.value === value);

/** One option named by an update. A null id and title mean every option of the product. */
export interface ChangedOption {
  id: string | null;
  title: string | null;
  nowAvailable: boolean | null;
  nowPrice: number | null;
  watched: boolean;
}

/** Changes of one kind (and, for prices, one old and new price) to one product on one day. */
export interface ChangeLine {
  kind: UpdateKind;
  oldPrice: number | null;
  newPrice: number | null;
  options: ChangedOption[];
}

/** All changes to one product on one day, shown as one card. */
export interface UpdateGroup {
  key: string;
  day: string;
  /** The latest change in the group. */
  at: string;
  storeId: string;
  storeName: string;
  productId: string;
  productTitle: string;
  imageUrl: string;
  currency: string;
  saved: boolean;
  watched: boolean;
  lines: ChangeLine[];
  /** The option the card links to: a watched one first, then the first one named. */
  variantId: string | null;
}

const kindOrder: Record<UpdateKind, number> = { price_drop: 0, restock: 1, price_rise: 2, sold_out: 3 };

/** The local calendar day of an ISO time, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Groups updates by product and local day. Keeps the newest-first order of the input. */
export function groupUpdates(updates: CatalogueUpdate[]): UpdateGroup[] {
  const groups = new Map<string, UpdateGroup>();
  for (const update of updates) {
    const day = localDay(update.at);
    const key = `${update.productId}|${day}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        day,
        at: update.at,
        storeId: update.storeId,
        storeName: update.storeName,
        productId: update.productId,
        productTitle: update.productTitle,
        imageUrl: update.imageUrl,
        currency: update.currency,
        saved: false,
        watched: false,
        lines: [],
        variantId: null,
      };
      groups.set(key, group);
    }
    group.saved ||= update.saved;
    group.watched ||= update.watched;
    if (update.at > group.at) group.at = update.at;

    let line = group.lines.find(item => item.kind === update.kind && item.oldPrice === update.oldPrice && item.newPrice === update.newPrice);
    if (!line) {
      line = { kind: update.kind, oldPrice: update.oldPrice, newPrice: update.newPrice, options: [] };
      group.lines.push(line);
    }
    if (!line.options.some(option => option.id === update.variantId)) {
      line.options.push({
        id: update.variantId,
        title: update.variantTitle,
        nowAvailable: update.nowAvailable,
        nowPrice: update.nowPrice,
        watched: update.watched,
      });
    }
  }

  for (const group of groups.values()) {
    group.lines.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);
    const options = group.lines.flatMap(line => line.options).filter(option => option.id);
    group.variantId = (options.find(option => option.watched) ?? options[0])?.id ?? null;
  }
  return [...groups.values()];
}

/** True when the account saved the product or watches one of its sizes. */
export const isForYou = (group: Pick<UpdateGroup, "saved" | "watched">) => group.saved || group.watched;

/**
 * Applies a filter. "all" leaves out sell-outs of products the account doesn't save or watch,
 * because those are most of the changes and rarely matter. They stay under "Sold out".
 */
export function filterGroups(groups: UpdateGroup[], filter: UpdateFilter, storeId = ""): { groups: UpdateGroup[]; hiddenSoldOut: number } {
  let hiddenSoldOut = 0;
  const result: UpdateGroup[] = [];
  for (const group of groups) {
    if (storeId && group.storeId !== storeId) continue;
    const lines = group.lines.filter(line => {
      if (filter === "all") {
        if (line.kind === "sold_out" && !isForYou(group)) {
          hiddenSoldOut += line.options.length;
          return false;
        }
        return true;
      }
      return line.kind === filter;
    });
    if (lines.length) result.push(lines.length === group.lines.length ? group : { ...group, lines });
  }
  return { groups: result, hiddenSoldOut };
}

/** Splits groups into runs of the same day, in order. */
export function byDay(groups: UpdateGroup[]): { day: string; groups: UpdateGroup[] }[] {
  const days: { day: string; groups: UpdateGroup[] }[] = [];
  for (const group of groups) {
    const last = days.at(-1);
    if (last?.day === group.day) last.groups.push(group);
    else days.push({ day: group.day, groups: [group] });
  }
  return days;
}

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

/** "Today", "Yesterday", a weekday within the last week, or a short date. */
export function dayLabel(day: string, now = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  const then = new Date(year, month - 1, date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return weekdayFormat.format(then);
  return dayFormat.format(then);
}

/** The price change as a whole percent of the old price, for example -31 or 9. */
export function percentChange(oldPrice: number, newPrice: number): number {
  if (oldPrice <= 0) return 0;
  return Math.round(((newPrice - oldPrice) / oldPrice) * 100);
}
