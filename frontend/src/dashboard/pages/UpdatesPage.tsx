import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useApi } from "@/api/ApiContext";
import { UPDATE_RETENTION_DAYS, UPDATES_PAGE_SIZE } from "@/api/client";
import type { CatalogueUpdate } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { RadioGroup } from "@/components/ui/radio-group";
import { money, plural } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, ArrowUpIcon, BellRingIcon, ChevronRightIcon, LoaderIcon, PulseIcon, SearchIcon, StoreIcon } from "../icons";
import { useBreadcrumbs } from "../context";
import { PageHeader, ProductImage, RetryAlert, RowSkeletons, StatusBadge } from "../parts";
import {
  byDay,
  dayLabel,
  filterGroups,
  groupUpdates,
  isForYou,
  isUpdateFilter,
  percentChange,
  updateFilters,
  type ChangeLine,
  type ChangedOption,
  type UpdateFilter,
  type UpdateGroup,
} from "../updates";

const emptyFilterText: Record<Exclude<UpdateFilter, "all">, { title: string; description: string }> = {
  price_drop: { title: "No price drops", description: "None of the products in your stores got cheaper in this period." },
  restock: { title: "No restocks", description: "No sold-out sizes came back in this period." },
  sold_out: { title: "Nothing sold out", description: "No sizes sold out in this period." },
};

export function UpdatesPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const show = params.get("show");
  const filter: UpdateFilter = isUpdateFilter(show) ? show : "all";
  const storeId = params.get("store") ?? "";
  useBreadcrumbs([{ label: "Updates" }]);

  const stores = useAsync(() => api.listStores(), "stores");
  const first = useAsync(() => api.listUpdates(), "updates");
  const older = useOlderUpdates(first.data);
  const updates = useMemo(() => (first.data ? [...first.data, ...older.items] : undefined), [first.data, older.items]);
  const groups = useMemo(() => (updates ? groupUpdates(updates) : []), [updates]);
  const seenSince = useSeenSince(first.data?.[0]?.at);

  const storeOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const group of groups) names.set(group.storeId, group.storeName);
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [groups]);
  const activeStore = storeOptions.some(store => store.id === storeId) ? storeId : "";

  const visible = useMemo(() => filterGroups(groups, filter, activeStore), [groups, filter, activeStore]);
  const forYou = filter === "all" ? visible.groups.filter(isForYou) : [];
  const rest = filter === "all" ? visible.groups.filter(group => !isForYou(group)) : visible.groups;
  const isNew = (group: UpdateGroup) => seenSince !== null && group.at > seenSince;
  const newCount = visible.groups.filter(isNew).length;

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  }

  const noStores = stores.data !== undefined && stores.data.stores.length === 0;
  const loading = !first.data && !first.error;

  return (
    <>
      <PageHeader title="Updates" meta="Price drops and restocks from your stores. We check each store once a day." />
      {first.error ? <RetryAlert error={first.error} onRetry={first.reload} title="Couldn’t load updates" /> : null}
      {loading && <RowSkeletons count={5} height={96} />}

      {updates && updates.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">{noStores ? <StoreIcon /> : <PulseIcon />}</EmptyMedia>
            <EmptyTitle>{noStores ? "No stores yet" : "No changes yet"}</EmptyTitle>
            <EmptyDescription>
              {noStores
                ? "Add a store to see its price drops and restocks here."
                : "We check your stores once a day. When a price or a size changes, it shows here."}
            </EmptyDescription>
          </EmptyHeader>
          {noStores && (
            <EmptyContent>
              <Button asChild variant="outline">
                <Link to="/stores">Go to My Stores</Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}

      {updates && updates.length > 0 && (
        <>
          <div role="search" aria-label="Update filters" className="mb-4 flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
            <KindFilter value={filter} onChange={value => setParam("show", value === "all" ? "" : value)} />
            {storeOptions.length > 1 && (
              <div className="flex flex-col gap-2">
                <label htmlFor="update-store" className="text-sm font-medium">
                  Store
                </label>
                <select
                  id="update-store"
                  value={activeStore}
                  onChange={event => setParam("store", event.target.value)}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:w-56 md:text-sm"
                >
                  <option value="">All stores</option>
                  {storeOptions.map(store => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <p className="dash-meta mb-4 tabular-nums" aria-live="polite">
            {plural(visible.groups.length, "product")} changed
            {newCount > 0 && <span className="font-medium text-foreground"> · {newCount} new since your last visit</span>}
          </p>

          {forYou.length > 0 && (
            <section aria-labelledby="updates-for-you" className="mb-8">
              <h2 id="updates-for-you" className="dash-section-title">
                For you
              </h2>
              <p className="dash-meta mb-3">Changes to products you saved and sizes you watch.</p>
              <ul aria-label="For you" className="divide-y rounded-xl border">
                {forYou.map(group => (
                  <UpdateCard key={group.key} group={group} isNew={isNew(group)} showDay />
                ))}
              </ul>
            </section>
          )}

          {rest.length > 0 && (
            <section aria-labelledby={forYou.length > 0 ? "updates-other" : undefined} aria-label={forYou.length > 0 ? undefined : "Updates"}>
              {forYou.length > 0 && (
                <h2 id="updates-other" className="dash-section-title mb-3">
                  From your stores
                </h2>
              )}
              <div className="flex flex-col gap-6">
                {byDay(rest).map(({ day, groups: dayGroups }) => {
                  const label = dayLabel(day);
                  return (
                    <div key={day}>
                      <h3 className="dash-meta mb-2 font-medium">{label}</h3>
                      <ul aria-label={`Updates, ${label}`} className="divide-y rounded-xl border">
                        {dayGroups.map(group => (
                          <UpdateCard key={group.key} group={group} isNew={isNew(group)} />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {visible.groups.length === 0 && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>{filter === "all" ? "No matching updates" : emptyFilterText[filter].title}</EmptyTitle>
                <EmptyDescription>
                  {filter === "all" ? "No price drops or restocks in this store in this period." : emptyFilterText[filter].description}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  Show all updates
                </Button>
              </EmptyContent>
            </Empty>
          )}

          {filter === "all" && visible.hiddenSoldOut > 0 && (
            <p className="dash-meta mt-4">
              {plural(visible.hiddenSoldOut, "size")} sold out on products you haven’t saved.{" "}
              <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => setParam("show", "sold_out")}>
                Show sold out
              </button>
            </p>
          )}

          <div className="mt-6 flex flex-col items-center gap-2">
            {older.error && <p className="dash-meta">{older.error}</p>}
            {older.hasMore(first.data) ? (
              <Button variant="outline" disabled={older.loading} onClick={() => void older.load(updates)}>
                {older.loading && <LoaderIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                Load older updates
              </Button>
            ) : (
              <p className="dash-meta">We keep updates for {UPDATE_RETENTION_DAYS} days.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Older pages, loaded on request. They reset when the first page reloads. */
function useOlderUpdates(firstPage: CatalogueUpdate[] | undefined) {
  const api = useApi();
  const [state, setState] = useState<{ base: CatalogueUpdate[] | undefined; items: CatalogueUpdate[]; lastLength: number | null; loading: boolean; error: string }>({
    base: firstPage,
    items: [],
    lastLength: null,
    loading: false,
    error: "",
  });
  const current = state.base === firstPage ? state : { base: firstPage, items: [], lastLength: null, loading: false, error: "" };
  if (current !== state) setState(current);

  async function load(all: CatalogueUpdate[]) {
    const last = all.at(-1);
    if (!last) return;
    setState(value => ({ ...value, loading: true, error: "" }));
    try {
      const page = await api.listUpdates(undefined, last.id);
      setState(value => (value.base === firstPage ? { ...value, items: [...value.items, ...page], lastLength: page.length, loading: false } : value));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "We couldn’t load older updates. Try again.";
      setState(value => ({ ...value, loading: false, error: message }));
    }
  }

  return {
    items: current.items,
    loading: current.loading,
    error: current.error,
    load,
    hasMore: (page: CatalogueUpdate[] | undefined) => (current.lastLength ?? page?.length ?? 0) >= UPDATES_PAGE_SIZE,
  };
}

/**
 * The time of the newest update at the viewer's last visit, kept in this browser.
 * Updates after it are "new". The first visit marks nothing as new.
 */
function useSeenSince(latest: string | undefined): string | null {
  const { account } = useAuth();
  const key = `catalogue.updates.seen.${account?.id ?? "anon"}`;
  const [since] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!latest || (since && latest <= since)) return;
    try {
      localStorage.setItem(key, latest);
    } catch {
      // Private windows can block storage. Nothing is marked new then.
    }
  }, [key, latest, since]);
  return since;
}

/** A segmented radio group with a sliding indicator, like the Availability filter on a store page. */
function KindFilter({ value, onChange }: { value: UpdateFilter; onChange(value: UpdateFilter): void }) {
  const index = Math.max(0, updateFilters.findIndex(option => option.value === value));
  return (
    <div className="flex flex-col gap-2">
      <span id="update-kind-label" className="text-sm font-medium">
        Show
      </span>
      <RadioGroup
        aria-labelledby="update-kind-label"
        value={value}
        onValueChange={next => onChange(next as UpdateFilter)}
        orientation="horizontal"
        className="relative grid w-full grid-cols-4 gap-0 rounded-lg border border-input bg-secondary p-0.5 md:w-[420px]"
      >
        <span
          aria-hidden="true"
          className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-4px)/4)] rounded-md border bg-background transition-transform duration-(--dash-indicator) ease-(--dash-ease)"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {updateFilters.map(option => (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            className="relative z-10 flex h-11 items-center justify-center rounded-md px-1 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--dash-feedback) ease-(--dash-ease) data-[state=checked]:text-foreground md:px-3 md:text-sm"
          >
            {option.label}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroup>
    </div>
  );
}

/** One product's changes on one day. The whole card links to the product, on the option that changed. */
function UpdateCard({ group, isNew, showDay = false }: { group: UpdateGroup; isNew: boolean; showDay?: boolean }) {
  const href = `/stores/${group.storeId}/products/${group.productId}` + (group.variantId ? `?variant=${encodeURIComponent(group.variantId)}` : "");
  return (
    <li className="relative flex gap-3 px-4 py-4 transition-colors duration-(--dash-feedback) ease-(--dash-ease) first:rounded-t-xl last:rounded-b-xl hover:bg-accent md:gap-4">
      <div className="w-14 shrink-0 md:w-16">
        <ProductImage src={group.imageUrl} alt="" className="rounded-md" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {isNew && (
              <span className="inline-flex items-center gap-1.5 text-[13px] leading-[18px] font-semibold">
                <span className="size-2 rounded-full bg-foreground" aria-hidden="true" />
                New
              </span>
            )}
            <p className="font-medium [overflow-wrap:anywhere]">
              <Link
                to={href}
                className="outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
              >
                {group.productTitle}
              </Link>
            </p>
          </div>
          <p className="dash-meta">
            {group.storeName}
            {group.saved && " · Saved"}
            {showDay && ` · ${dayLabel(group.day)}`}
          </p>
        </div>
        <ul className="flex flex-col gap-2" aria-label={`Changes to ${group.productTitle}`}>
          {group.lines.map(line => (
            <ChangeRow key={`${line.kind}|${line.oldPrice}|${line.newPrice}`} line={line} currency={group.currency} />
          ))}
        </ul>
      </div>
      <ChevronRightIcon className="mt-1 hidden size-4 shrink-0 text-muted-foreground md:block" aria-hidden="true" />
    </li>
  );
}

const MAX_OPTIONS = 4;

function OptionList({ options }: { options: ChangedOption[] }) {
  if (options.some(option => option.id === null)) return <>Every option</>;
  const shown = options.slice(0, MAX_OPTIONS);
  return (
    <>
      {shown.map((option, index) => (
        <span key={option.id}>
          {index > 0 && ", "}
          {option.title}
          {option.watched && (
            <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
              {" "}
              <BellRingIcon className="size-3.5" aria-hidden="true" />
              you watch this size
            </span>
          )}
        </span>
      ))}
      {options.length > shown.length && ` and ${options.length - shown.length} more`}
    </>
  );
}

function ChangeRow({ line, currency }: { line: ChangeLine; currency: string }) {
  const priced = line.oldPrice !== null && line.newPrice !== null;
  const percent = priced ? percentChange(line.oldPrice!, line.newPrice!) : 0;
  const now = nowNote(line, currency);
  return (
    <li className="flex flex-col gap-1 text-sm md:flex-row md:items-start md:gap-3">
      <span className="shrink-0">
        {line.kind === "price_drop" && (
          <StatusBadge tone="accent">
            <ArrowDownIcon aria-hidden="true" />
            Price drop
          </StatusBadge>
        )}
        {line.kind === "price_rise" && (
          <StatusBadge tone="neutral">
            <ArrowUpIcon aria-hidden="true" />
            Price up
          </StatusBadge>
        )}
        {line.kind === "restock" && <StatusBadge tone="success">Back in stock</StatusBadge>}
        {line.kind === "sold_out" && <StatusBadge tone="neutral">Sold out</StatusBadge>}
      </span>
      <span className="min-w-0 pt-0.5 leading-5 tabular-nums">
        {priced && (
          <>
            <span className="sr-only">Was </span>
            <s className="text-muted-foreground">{money(line.oldPrice!, currency)}</s>
            <span aria-hidden="true"> → </span>
            <span className="sr-only">, now </span>
            <span className="font-semibold">{money(line.newPrice!, currency)}</span>{" "}
            <span className={cn("font-medium", line.kind === "price_rise" && "text-muted-foreground")}>
              ({percent > 0 ? "+" : "−"}
              {Math.abs(percent)}%)
            </span>
            <span className="text-muted-foreground"> · </span>
          </>
        )}
        <span className="text-muted-foreground [overflow-wrap:anywhere]">
          <OptionList options={line.options} />
        </span>
        {now && <span className="block text-[13px] leading-[18px] font-medium">{now}</span>}
      </span>
    </li>
  );
}

/** What is true now, when it differs from the change. Updates are records of one check, so this keeps them honest. */
function nowNote(line: ChangeLine, currency: string): string | null {
  const titles = (options: ChangedOption[]) => (options.some(option => option.title === null) ? "" : ": " + options.map(option => option.title).join(", "));
  if (line.kind === "restock") {
    const gone = line.options.filter(option => option.nowAvailable === false);
    if (gone.length) return `Sold out again${titles(gone)}`;
    const removed = line.options.filter(option => option.nowAvailable === null);
    if (removed.length) return `No longer listed${titles(removed)}`;
  }
  if (line.kind === "sold_out") {
    const back = line.options.filter(option => option.nowAvailable === true);
    if (back.length) return `In stock now${titles(back)}`;
  }
  if ((line.kind === "price_drop" || line.kind === "price_rise") && line.newPrice !== null) {
    const changed = line.options.find(option => option.nowPrice !== null && option.nowPrice !== line.newPrice);
    if (changed) return `Price now ${money(changed.nowPrice!, currency)}`;
  }
  return null;
}
