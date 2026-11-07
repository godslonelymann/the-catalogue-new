import { Link } from "react-router";
import { useApi } from "@/api/ApiContext";
import type { CatalogueUpdate } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { money, shortDate } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { ChevronRightIcon, PulseIcon } from "../icons";
import { useBreadcrumbs } from "../context";
import { PageHeader, ProductImage, RetryAlert, RowSkeletons, StatusBadge } from "../parts";

const events = {
  price_drop: { label: "Price changed", tone: "accent" },
  price_rise: { label: "Price changed", tone: "accent" },
  restock: { label: "Back in stock", tone: "success" },
  sold_out: { label: "Sold out", tone: "neutral" },
} as const;

export function UpdatesPage() {
  const api = useApi();
  const updates = useAsync(() => api.listUpdates(), "updates");
  useBreadcrumbs([{ label: "Updates" }]);

  return (
    <>
      <PageHeader title="Updates" meta="Changes from successful checks of the stores you monitor." />
      {updates.error ? <RetryAlert error={updates.error} onRetry={updates.reload} title="Couldn’t load updates" /> : null}
      {!updates.data && !updates.error && <RowSkeletons count={5} />}
      {updates.data && updates.data.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PulseIcon />
            </EmptyMedia>
            <EmptyTitle>No updates yet</EmptyTitle>
            <EmptyDescription>Price changes and stock changes appear here after a daily check.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link to="/stores">Go to My Stores</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {updates.data && updates.data.length > 0 && (
        <ul className="divide-y rounded-xl border" aria-label="Updates">
          {updates.data.map(update => (
            <UpdateRow key={update.id} update={update} />
          ))}
        </ul>
      )}
    </>
  );
}

function UpdateRow({ update }: { update: CatalogueUpdate }) {
  const event = events[update.kind];
  const priceChange = (update.kind === "price_drop" || update.kind === "price_rise") && update.oldPrice !== null && update.newPrice !== null;
  return (
    <li>
      <Link
        to={`/stores/${update.storeId}/products/${update.productId}`}
        className="flex min-h-[72px] items-center gap-3 px-4 py-3 transition-colors duration-(--dash-feedback) ease-(--dash-ease) first:rounded-t-xl hover:bg-accent md:gap-4"
      >
        <div className="w-12 shrink-0 md:w-14">
          <ProductImage src={update.imageUrl} alt="" className="rounded-md" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={event.tone}>{event.label}</StatusBadge>
            <span className="dash-meta">{update.storeName}</span>
          </div>
          <p className="font-medium [overflow-wrap:anywhere]">{update.productTitle}</p>
          <p className="dash-meta tabular-nums">
            {update.variantTitle ?? "All options"}
            {priceChange && (
              <>
                {" · "}
                <span className="sr-only">Previous price </span>
                <s>{money(update.oldPrice!, update.currency)}</s>
                {" → "}
                <span className="sr-only">current price </span>
                <span className="font-semibold text-foreground">{money(update.newPrice!, update.currency)}</span>
              </>
            )}
          </p>
        </div>
        <time dateTime={update.at} className="dash-meta shrink-0 tabular-nums">
          {shortDate(update.at)}
        </time>
        <ChevronRightIcon className="hidden size-4 shrink-0 text-muted-foreground md:block" aria-hidden="true" />
      </Link>
    </li>
  );
}
