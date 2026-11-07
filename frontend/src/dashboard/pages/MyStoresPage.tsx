import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useApi } from "@/api/ApiContext";
import type { MonitoredStore } from "@/api/types";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { dateTime, plural } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { PlusIcon, StoreIcon } from "../icons";
import { useBreadcrumbs } from "../context";
import { PageHeader, RetryAlert, RowSkeletons, StatusBadge, useFocusReturn } from "../parts";
import { AddStoreDialog } from "./AddStoreDialog";

export function MyStoresPage() {
  const api = useApi();
  const stores = useAsync(() => api.listStores(), "stores");
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState<{ url?: string } | null>(null);
  const [removing, setRemoving] = useState<MonitoredStore | null>(null);
  const data = stores.data;
  const addFocus = useFocusReturn();
  const removeFocus = useFocusReturn();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const openAdd = (url?: string) => {
    addFocus.capture();
    setAdding({ url });
  };
  useBreadcrumbs([{ label: "My Stores", to: "/stores" }]);

  // "Add a store" from Commands arrives as ?add=1.
  const addRequested = params.get("add") === "1";
  useEffect(() => {
    if (!addRequested) return;
    setAdding({});
    setParams(
      current => {
        const next = new URLSearchParams(current);
        next.delete("add");
        return next;
      },
      { replace: true },
    );
  }, [addRequested, setParams]);

  // Keep checking while any first import runs.
  const importing = data?.stores.some(store => store.status === "importing") ?? false;
  const { reload } = stores;
  useEffect(() => {
    if (!importing) return;
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [importing, reload]);

  const addButton = (
    <Button ref={addButtonRef} onClick={() => openAdd()}>
      <PlusIcon />
      Add a store
    </Button>
  );

  return (
    <>
      <PageHeader
        title="My Stores"
        meta={data ? <span className="tabular-nums">{`${data.brandCount} of ${data.brandLimit} brands`}</span> : null}
        actions={data && data.stores.length > 0 ? addButton : null}
      />

      {stores.error ? <RetryAlert error={stores.error} onRetry={stores.reload} title="Couldn’t load your stores" /> : null}
      {!data && !stores.error && <RowSkeletons count={3} />}

      {data && data.stores.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <StoreIcon />
            </EmptyMedia>
            <EmptyTitle>Follow your first store</EmptyTitle>
            <EmptyDescription>Add an approved Shopify store to browse its catalogue and get restock emails.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addButton}</EmptyContent>
        </Empty>
      )}

      {data && data.stores.length > 0 && (
        <ul className="divide-y rounded-xl border" aria-label="Monitored stores">
          {data.stores.map(store => (
            <StoreRow
              key={store.id}
              store={store}
              onRemove={() => {
                removeFocus.capture();
                setRemoving(store);
              }}
              onRetry={() => openAdd(store.url)}
            />
          ))}
        </ul>
      )}

      <AddStoreDialog
        open={adding !== null}
        initialUrl={adding?.url}
        brandCount={data?.brandCount ?? null}
        brandLimit={data?.brandLimit ?? 10}
        onOpenChange={open => !open && setAdding(null)}
        onCloseAutoFocus={event => addFocus.restore(event, () => addButtonRef.current ?? document.querySelector<HTMLElement>("#main h1"))}
        onAdded={() => {
          setAdding(null);
          void stores.reload();
        }}
      />
      <RemoveStoreDialog
        onCloseAutoFocus={event => removeFocus.restore(event, () => addButtonRef.current ?? document.querySelector<HTMLElement>("#main h1"))}
        store={removing}
        onClose={() => setRemoving(null)}
        onRemoved={async () => {
          await stores.reload();
          setRemoving(null);
        }}
      />
    </>
  );
}

const statusLabels = {
  ready: { tone: "success", label: "Ready" },
  importing: { tone: "pending", label: "Importing catalogue" },
  import_failed: { tone: "error", label: "Import failed" },
} as const;

function StoreRow({ store, onRemove, onRetry }: { store: MonitoredStore; onRemove(): void; onRetry(): void }) {
  const status = statusLabels[store.status];
  return (
    <li className="flex flex-col gap-3 px-4 py-4 md:min-h-[72px] md:flex-row md:items-center md:gap-6 md:py-3">
      <div className="min-w-0 md:w-56 md:shrink-0">
        <p className="font-semibold [overflow-wrap:anywhere]">{store.name}</p>
        <p className="dash-meta [overflow-wrap:anywhere]">{store.host}</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <span className="dash-meta tabular-nums">
          {store.status === "ready" && `${plural(store.productCount, "product")} · `}
          {store.lastSuccessfulCheckAt ? (
            <>
              Last successful check <time dateTime={store.lastSuccessfulCheckAt}>{dateTime(store.lastSuccessfulCheckAt)}</time>
            </>
          ) : (
            "Awaiting first successful check"
          )}
        </span>
        {store.lastCheckFailed && <StatusBadge tone="error">Latest check failed</StatusBadge>}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
        {store.status !== "import_failed" ? (
          <Button asChild variant="outline">
            <Link to={`/stores/${store.id}`}>Browse products</Link>
          </Button>
        ) : (
          <Button variant="outline" onClick={onRetry}>
            Retry import
          </Button>
        )}
        <Button variant="ghost" onClick={onRemove} aria-label={`Remove ${store.name}`}>
          Remove
        </Button>
      </div>
    </li>
  );
}

function RemoveStoreDialog({
  store,
  onClose,
  onRemoved,
  onCloseAutoFocus,
}: {
  store: MonitoredStore | null;
  onClose(): void;
  onRemoved(): Promise<void>;
  onCloseAutoFocus(event: Event): void;
}) {
  const api = useApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!store) return;
    setPending(true);
    setError("");
    try {
      await api.removeStore(store.id);
      // The row stays until the API confirms the removal.
      await onRemoved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "We couldn’t remove this store.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={store !== null}
      onOpenChange={open => {
        if (!open && !pending) {
          setError("");
          onClose();
        }
      }}
    >
      <AlertDialogContent className="shadow-xl" onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {store?.name}?</AlertDialogTitle>
          <AlertDialogDescription>You will stop monitoring {store?.name}. Your active restock alerts for this store will be cancelled.</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-[13px] leading-[18px] text-error">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep store</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => void remove()}>
            {pending ? "Removing…" : `Remove ${store?.name ?? "store"}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
