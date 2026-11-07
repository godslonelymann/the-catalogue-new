import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useApi } from "@/api/ApiContext";
import { isApiError } from "@/api/client";
import type { Availability } from "@/api/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { RadioGroup } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { dateTime, plural } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { cn } from "@/lib/utils";
import { AlertCircleIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, StoreIcon } from "../icons";
import { useBreadcrumbs } from "../context";
import { PageHeader, ProductCard, RetryAlert } from "../parts";

const availabilityOptions: { value: Availability; label: string }[] = [
  { value: "", label: "All" },
  { value: "in", label: "In stock" },
  { value: "out", label: "Sold out" },
];

export function NotFoundState({ what = "page" }: { what?: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchIcon />
        </EmptyMedia>
        <EmptyTitle>We couldn’t find this {what}</EmptyTitle>
        <EmptyDescription>It may have been removed, or it isn’t in a store you monitor.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link to="/stores">Go to My Stores</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function StorePage() {
  const { storeId = "" } = useParams();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const availability = (params.get("availability") ?? "") as Availability;
  const filterKey = `${storeId}|${q}|${availability}`;

  // Cursor pagination. A search or filter change starts again at page 1.
  const [pages, setPages] = useState<{ key: string; cursors: (string | null)[]; index: number; pageSize: number | null }>({
    key: filterKey,
    cursors: [null],
    index: 0,
    pageSize: null,
  });
  if (pages.key !== filterKey) setPages({ key: filterKey, cursors: [null], index: 0, pageSize: null });
  const paging = pages.key === filterKey ? pages : { key: filterKey, cursors: [null], index: 0, pageSize: null };
  const cursor = paging.cursors[paging.index];

  // Only the response for the current search, filter, and page is applied.
  const result = useAsync(() => api.listProducts(storeId, { q, availability, cursor }), `${filterKey}|${cursor ?? ""}`);
  const data = result.data;
  const current = data && result.data !== undefined ? data : undefined;

  function setFilter(name: string, value: string) {
    setParams(
      currentParams => {
        const next = new URLSearchParams(currentParams);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  }
  const [search, setSearch] = useState(q);
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => setFilter("q", search), 250);
    return () => clearTimeout(timer);
  });



  const store = current?.store;
  useBreadcrumbs([
    { label: "My Stores", to: "/stores" },
    { label: store?.name ?? "Store", to: `/stores/${storeId}` },
  ]);

  const { reload } = result;
  useEffect(() => {
    if (store?.status !== "importing") return;
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [store?.status, reload]);

  // Learn the page size from the first full page.
  const pageSize = paging.pageSize ?? (current && current.nextCursor && paging.index === 0 ? current.items.length : null);
  const pageCount = current ? Math.max(paging.index + 1 + (current.nextCursor ? 1 : 0), pageSize ? Math.ceil(current.total / pageSize) : 1) : 1;

  function goTo(index: number) {
    if (!current) return;
    const cursors = [...paging.cursors];
    if (index > paging.index && current.nextCursor) cursors[index] = current.nextCursor;
    setPages({ key: filterKey, cursors, index, pageSize });
    document.getElementById("main")?.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  if (!current && isApiError(result.error, "not_found")) return <NotFoundState what="store" />;

  const filtered = q !== "" || availability !== "";
  const clearFilters = () => {
    setSearch("");
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <>
      <PageHeader
        title={store?.name ?? <Skeleton className="h-8 w-48" />}
        meta={
          store?.lastSuccessfulCheckAt ? (
            <>
              Last successful check <time dateTime={store.lastSuccessfulCheckAt}>{dateTime(store.lastSuccessfulCheckAt)}</time>
            </>
          ) : store ? (
            "Awaiting first successful check"
          ) : null
        }
      />

      {result.error && !isApiError(result.error, "not_found") ? <RetryAlert error={result.error} onRetry={result.reload} title="Couldn’t load products" /> : null}

      {store?.lastCheckFailed && (
        <Alert className="mb-6 border-border bg-secondary text-foreground">
          <AlertCircleIcon />
          <AlertDescription className="text-foreground">The latest check of this store failed. These products are from the last successful check.</AlertDescription>
        </Alert>
      )}

      {store?.status === "importing" ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <StoreIcon />
            </EmptyMedia>
            <EmptyTitle>Importing catalogue</EmptyTitle>
            <EmptyDescription>We are importing this store’s products. This page updates when the import is done.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : store?.status === "import_failed" ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Import failed</EmptyTitle>
            <EmptyDescription>We couldn’t import this store. Retry the import from My Stores.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link to="/stores">Go to My Stores</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div role="search" aria-label="Product filters" className="mb-4 flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
            <Field className="md:max-w-sm">
              <FieldLabel htmlFor="product-search">Search products</FieldLabel>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="product-search" type="search" className="pl-9" placeholder="Search by name or colour" autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} />
              </div>
            </Field>
            <AvailabilityFilter value={availability} onChange={value => setFilter("availability", value)} />
          </div>

          <p className="dash-meta mb-3 tabular-nums" aria-live="polite">
            {current ? (result.loading ? "Updating…" : plural(current.total, "product")) : " "}
          </p>

          {!current && !result.error && <ProductGridSkeleton />}

          {current && current.items.length === 0 && !result.loading && (
            filtered ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchIcon />
                  </EmptyMedia>
                  <EmptyTitle>No matching products</EmptyTitle>
                  <EmptyDescription>No products match this search and filter.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <StoreIcon />
                  </EmptyMedia>
                  <EmptyTitle>No products yet</EmptyTitle>
                  <EmptyDescription>The last successful check found no products in this store.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          )}

          {current && current.items.length > 0 && (
            <ul aria-label="Products" className={cn("grid grid-cols-1 gap-3 min-[22.5rem]:grid-cols-2 md:grid-cols-3 md:gap-4 min-[75rem]:grid-cols-4", result.loading && "opacity-70")} aria-busy={result.loading}>
              {current.items.map(product => (
                <li key={product.id}>
                  <ProductCard product={product} />
                </li>
              ))}
            </ul>
          )}

          {current && pageCount > 1 && (
            <Pagination className="mt-8">
              <PaginationContent>
                <PaginationItem>
                  <Button variant="ghost" disabled={paging.index === 0} onClick={() => goTo(paging.index - 1)} aria-label="Previous page">
                    <ChevronLeftIcon />
                    <span className="max-sm:sr-only">Previous</span>
                  </Button>
                </PaginationItem>
                <PaginationItem>
                  <span className="dash-meta px-3 tabular-nums" aria-current="page">
                    Page {paging.index + 1} of {pageCount}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <Button variant="ghost" disabled={!current.nextCursor} onClick={() => goTo(paging.index + 1)} aria-label="Next page">
                    <span className="max-sm:sr-only">Next</span>
                    <ChevronRightIcon />
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}
    </>
  );
}

/** A segmented radio group with a sliding indicator behind the selected option. */
function AvailabilityFilter({ value, onChange }: { value: Availability; onChange(value: Availability): void }) {
  const index = Math.max(0, availabilityOptions.findIndex(option => option.value === value));
  return (
    <div className="flex flex-col gap-2">
      <span id="availability-label" className="text-sm font-medium">
        Availability
      </span>
      <RadioGroup
        aria-labelledby="availability-label"
        value={value || "all"}
        onValueChange={next => onChange((next === "all" ? "" : next) as Availability)}
        orientation="horizontal"
        className="relative grid w-full grid-cols-3 gap-0 rounded-lg border border-input bg-secondary p-0.5 md:w-[312px]"
      >
        <span
          aria-hidden="true"
          className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-md border bg-background transition-transform duration-(--dash-indicator) ease-(--dash-ease)"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {availabilityOptions.map(option => (
          <RadioGroupPrimitive.Item
            key={option.label}
            value={option.value || "all"}
            className="relative z-10 flex h-11 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-(--dash-feedback) ease-(--dash-ease) data-[state=checked]:text-foreground"
          >
            {option.label}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroup>
    </div>
  );
}

function ProductGridSkeleton() {
  return (
    <ul className="grid grid-cols-1 gap-3 min-[22.5rem]:grid-cols-2 md:grid-cols-3 md:gap-4 min-[75rem]:grid-cols-4" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <li key={index} className="overflow-hidden rounded-xl border">
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="flex flex-col gap-2 border-t p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        </li>
      ))}
    </ul>
  );
}
