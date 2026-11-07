import { useState } from "react";
import { Link } from "react-router";
import { useApi } from "@/api/ApiContext";
import { isApiError } from "@/api/client";
import type { SavedAlert, WishlistItem } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { money, plural, shortDate } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { BellRingIcon, HeartIcon, LoaderIcon, MailIcon } from "../icons";
import { useBreadcrumbs } from "../context";
import { PageHeader, ProductImage, RetryAlert, RowSkeletons, StatusBadge, StockLabel } from "../parts";

/**
 * Saved products, newest first. Each one shows the sizes it watches: an active alert
 * ("Watching size M"), or a sent one ("Size M is back, email sent").
 */
export function SavedPage() {
  const api = useApi();
  const { account } = useAuth();
  const saved = useAsync(() => api.listWishlist(), "saved");
  useBreadcrumbs([{ label: "Saved" }]);
  const items = saved.data;
  const watching = items?.reduce((count, item) => count + item.alerts.filter(alert => alert.status === "active").length, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Saved"
        meta={
          items && items.length > 0
            ? `${plural(items.length, "saved product")}${watching ? ` · watching ${plural(watching, "size")}` : ""}`
            : "Products you saved, and the sold-out sizes you are waiting for."
        }
      />

      <div className="mb-6 flex items-center gap-3 rounded-xl border bg-secondary px-4 py-3">
        <MailIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          <span className="text-muted-foreground">When a size you watch is back, we email </span>
          <span className="font-medium break-all">{account?.email}</span>
        </p>
        {account?.emailVerified && <StatusBadge tone="success">Verified</StatusBadge>}
      </div>

      {saved.error ? <RetryAlert error={saved.error} onRetry={saved.reload} title="Couldn’t load your saved products" /> : null}
      {!items && !saved.error && <RowSkeletons count={3} height={112} />}
      {items && items.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HeartIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing saved yet</EmptyTitle>
            <EmptyDescription>
              Select the heart on a product to save it. To get an email when a sold-out size is back, open the product and select
              that size.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link to="/stores">Go to My Stores</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y rounded-xl border" aria-label="Saved products">
          {items.map(item => (
            <SavedRow key={item.id} item={item} onChange={saved.reload} />
          ))}
        </ul>
      )}
    </>
  );
}

function SavedRow({ item, onChange }: { item: WishlistItem; onChange(): Promise<void> }) {
  const api = useApi();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const { product } = item;
  const to = `/stores/${product.storeId}/products/${product.id}`;
  const varies = product.maxPrice !== undefined && product.maxPrice > product.price;
  const active = item.alerts.filter(alert => alert.status === "active").length;

  async function remove() {
    setPending(true);
    try {
      const { cancelledAlerts } = await api.unsaveProduct(product.id).catch(failure => {
        // Already removed, for example in another tab.
        if (isApiError(failure, "not_found")) return { cancelledAlerts: 0 };
        throw failure;
      });
      toast(cancelledAlerts ? `Removed. ${plural(cancelledAlerts, "size alert")} stopped.` : "Removed from Saved");
      // The row stays until the list reloads.
      await onChange();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "We couldn’t remove this product. Try again.");
      setPending(false);
    }
  }

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-4 md:flex-nowrap md:gap-4">
      <Link to={to} tabIndex={-1} aria-hidden="true" className="w-16 shrink-0 md:w-20">
        <ProductImage src={product.imageUrl} alt="" className="rounded-md" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="dash-meta">{item.storeName}</p>
          <Link to={to} className="font-medium underline-offset-2 hover:underline [overflow-wrap:anywhere]">
            {product.title}
          </Link>
          <p className="flex flex-wrap items-center gap-2 text-sm tabular-nums">
            <span className="font-semibold">
              {varies && <span className="font-normal text-muted-foreground">From </span>}
              {money(product.price, product.currency)}
            </span>
            <StockLabel available={product.inStock} />
          </p>
        </div>
        <ul className="flex flex-col gap-1.5" aria-label={`Sizes watched for ${product.title}`}>
          {item.alerts.map(alert => (
            <WatchedSize key={alert.id} alert={alert} onChange={onChange} />
          ))}
          {item.alerts.length === 0 && (
            <li className="dash-meta">
              Waiting for a sold-out size?{" "}
              <Link to={to} className="underline underline-offset-2">
                Open the product
              </Link>{" "}
              and select it.
            </li>
          )}
        </ul>
      </div>
      <Button
        variant="outline"
        className="w-full md:w-auto"
        disabled={pending}
        onClick={() => void remove()}
        aria-label={`Remove ${product.title} from Saved${active ? ` and stop ${plural(active, "size alert")}` : ""}`}
      >
        {pending && <LoaderIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        Remove
      </Button>
    </li>
  );
}

function WatchedSize({ alert, onChange }: { alert: SavedAlert; onChange(): Promise<void> }) {
  const api = useApi();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function stop() {
    setPending(true);
    try {
      await api.cancelAlert(alert.id).catch(failure => {
        if (!isApiError(failure, "not_found")) throw failure;
      });
      toast(`Stopped watching ${alert.variantTitle}`);
      await onChange();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "We couldn’t stop this alert. Try again.");
      setPending(false);
    }
  }

  if (alert.status === "sent") {
    return (
      <li className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge tone="success">Back in stock</StatusBadge>
        <span>
          {alert.variantTitle} · email sent{alert.sentAt && <> {shortDate(alert.sentAt)}</>}
        </span>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge tone="accent">
        <BellRingIcon className="size-3.5" aria-hidden="true" />
        Watching
      </StatusBadge>
      <span>{alert.variantTitle}</span>
      <Button variant="link" className="h-auto p-0 text-sm" disabled={pending} onClick={() => void stop()} aria-label={`Stop watching ${alert.variantTitle}`}>
        {pending ? "Stopping…" : "Stop"}
      </Button>
    </li>
  );
}
