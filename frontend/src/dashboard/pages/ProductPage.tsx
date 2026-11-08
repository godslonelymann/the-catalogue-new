import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useApi } from "@/api/ApiContext";
import { isApiError } from "@/api/client";
import type { PricePoint, ProductDetail, Variant } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dateTime, money } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { cn } from "@/lib/utils";
import { BellIcon, BellRingIcon, ExternalLinkIcon, LoaderIcon } from "../icons";
import { useBreadcrumbs } from "../context";
import { PageHeader, ProductImage, RetryAlert, SaveToggle, StockLabel } from "../parts";
import { NotFoundState } from "./StorePage";
import { PriceChart } from "../charts/PriceChart";
import { dailyPrices } from "../charts/series";

export function ProductPage() {
  const { storeId = "", productId = "" } = useParams();
  // Links from Updates name the option that changed, so the page opens on it.
  const [params] = useSearchParams();
  const api = useApi();
  const product = useAsync(() => api.getProduct(storeId, productId), `${storeId}/${productId}`);
  const data = product.data?.id === productId ? product.data : undefined;

  useBreadcrumbs([
    { label: "My Stores", to: "/stores" },
    { label: data?.storeName ?? "Store", to: `/stores/${storeId}` },
    { label: data?.title ?? "Product" },
  ]);

  if (!data && isApiError(product.error, "not_found")) return <NotFoundState what="product" />;
  if (!data && product.error) return <RetryAlert error={product.error} onRetry={product.reload} title="Couldn’t load this product" />;
  if (!data) return <ProductSkeleton />;
  return (
    <>
      {product.error ? <RetryAlert error={product.error} onRetry={product.reload} title="Couldn’t refresh this product" /> : null}
      <ProductView key={data.id} product={data} initialVariantId={params.get("variant")} onChange={product.reload} />
    </>
  );
}

const defaultVariant = (product: ProductDetail) => product.variants.find(variant => variant.available) ?? product.variants[0];
const startVariant = (product: ProductDetail, id: string | null) => product.variants.find(variant => variant.id === id) ?? defaultVariant(product);
const sameOptions = (a: string[], b: string[]) => a.every((value, index) => value === b[index]);

function ProductView({ product, initialVariantId = null, onChange }: { product: ProductDetail; initialVariantId?: string | null; onChange(): Promise<void> }) {
  const api = useApi();
  const [selected, setSelected] = useState<string[]>(() => startVariant(product, initialVariantId).options);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const variant = product.variants.find(item => sameOptions(item.options, selected)) ?? defaultVariant(product);
  const alertActive = product.alerts.some(alert => alert.variantId === variant.id);
  const history = variant.priceHistory ?? product.priceHistory;

  function choose(optionIndex: number, value: string) {
    const wanted = selected.map((current, index) => (index === optionIndex ? value : current));
    // Keep the other choices when that combination exists. Sold-out variants stay selectable.
    const match =
      product.variants.find(item => sameOptions(item.options, wanted)) ??
      product.variants.find(item => item.options[optionIndex] === value);
    if (match) setSelected(match.options);
    setError("");
  }

  const lookup = (optionIndex: number, value: string): Variant | undefined =>
    product.variants.find(item => sameOptions(item.options, selected.map((current, index) => (index === optionIndex ? value : current))));

  async function createAlert() {
    setPending(true);
    setError("");
    try {
      await api.createAlert({ productId: product.id, variantId: variant.id });
      // "Watching this size" shows after the API confirms and the product reloads. The product is saved too.
      await onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "We couldn’t set the alert. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="product-layout grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-x-8 lg:gap-x-12">
      <div className="[grid-area:title]">
        <PageHeader title={product.title} meta={product.storeName} actions={<SaveToggle product={product} display="button" />} />
      </div>

      <div className="[grid-area:image]">
        <ProductImage src={variant.imageUrl ?? product.imageUrl} alt={`${product.title}, ${variant.title}`} className="rounded-xl border" />
      </div>

      <div className="flex flex-col gap-3 [grid-area:info]">
        <p className="flex flex-wrap items-baseline gap-2 tabular-nums">
          <span className="text-2xl leading-8 font-semibold">{money(variant.price, product.currency)}</span>
          {variant.compareAtPrice && variant.compareAtPrice > variant.price && (
            <s className="dash-meta">
              <span className="sr-only">Previous price </span>
              {money(variant.compareAtPrice, product.currency)}
            </s>
          )}
        </p>
        {product.description && <p className="text-muted-foreground">{product.description}</p>}
      </div>

      <div className="flex flex-col gap-5 [grid-area:variants]">
        {product.options.map((option, optionIndex) => (
          <fieldset key={option.name} className="min-w-0">
            <legend className="mb-2 text-sm font-semibold">
              {option.name} <span className="font-normal text-muted-foreground">· {selected[optionIndex]}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {option.values.map(value => {
                // The last option (usually size) is sold out for the exact choice. Earlier options (usually colour)
                // are sold out only when no option with that value is in stock, so one sold-out size doesn't cross out a colour.
                const last = optionIndex === product.options.length - 1;
                const match = lookup(optionIndex, value);
                const soldOut = last
                  ? !match?.available
                  : !product.variants.some(item => item.options[optionIndex] === value && item.available);
                const pressed = selected[optionIndex] === value;
                return (
                  <Button
                    key={value}
                    type="button"
                    variant="outline"
                    aria-pressed={pressed}
                    aria-label={`${option.name} ${value}, ${soldOut ? "sold out" : "in stock"}`}
                    onClick={() => choose(optionIndex, value)}
                    className={cn(
                      "min-w-11 border-input",
                      soldOut && "border-dashed text-muted-foreground line-through decoration-1",
                      pressed && "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                    )}
                  >
                    {value}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        ))}
        {product.variants.some(item => !item.available) && (
          <p className="dash-meta -mt-2">Crossed-out options are sold out. Choose one to get an email when it is back.</p>
        )}

        <div className="flex flex-col gap-4 rounded-xl border p-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{variant.title}</p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">{money(variant.price, product.currency)}</span>
              <StockLabel available={variant.available} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* A sold-out option leads with the alert. An in-stock one leads with the store. */}
            {!variant.available && !alertActive && (
              <Button disabled={pending} onClick={() => void createAlert()}>
                {pending ? <LoaderIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
                Email me when it’s back
              </Button>
            )}
            {alertActive && (
              // A status, not a button, but the same size as the buttons next to it.
              <span className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-transparent bg-primary px-4 text-sm font-medium whitespace-nowrap text-primary-foreground">
                <BellRingIcon className="size-4" aria-hidden="true" />
                Watching this size
              </span>
            )}
            <Button asChild variant={variant.available ? "default" : "outline"} className={cn(!variant.available && "border-input")}>
              <a href={variant.url ?? product.url} target="_blank" rel="noopener noreferrer">
                {variant.available ? "Buy on store" : "Visit store"}
                <ExternalLinkIcon aria-hidden="true" />
                <span className="sr-only">(opens {variant.title} in a new tab)</span>
              </a>
            </Button>
          </div>
          <p className="dash-meta">
            {alertActive ? (
              <>
                We will email you once when this exact option is back. You can see it in{" "}
                <Link to="/saved" className="underline underline-offset-2">
                  Saved
                </Link>
                .
              </>
            ) : variant.available ? (
              `Opens ${variant.title} on the store’s website.`
            ) : (
              "We send one email when this exact option is back in stock. The product is also saved."
            )}
          </p>
          {error && (
            <p role="alert" className="text-[13px] leading-[18px] text-error">
              {error}
            </p>
          )}
        </div>
      </div>

      <PriceHistory key={variant.id} variant={variant} history={history} currency={product.currency} checkedAt={product.lastSuccessfulCheckAt} />
    </div>
  );
}

/** The price chart from the landing page, with the selected option's real prices, and the changes as a list. */
function PriceHistory({ variant, history, currency, checkedAt }: { variant: Variant; history: PricePoint[]; currency: string; checkedAt: string | null }) {
  const ranges = useMemo(() => ({ "30D": dailyPrices(history, 30), "90D": dailyPrices(history, 90) }), [history]);
  return (
    <section aria-labelledby="history-title" className="[grid-area:history]">
      <h2 id="history-title" className="dash-section-title">
        Price history
      </h2>
      <p className="dash-meta mb-3">
        {variant.title}
        {checkedAt && (
          <>
            {" "}
            · Prices from <time dateTime={checkedAt}>{dateTime(checkedAt)}</time>
          </>
        )}
      </p>
      {ranges["90D"].length > 0 ? (
        <div className="rounded-xl border p-4 md:p-5">
          <PriceChart data={ranges} currency={currency} defaultRange="90D" title={`Price of ${variant.title}`} height={220} />
        </div>
      ) : (
        <p className="dash-meta rounded-xl border p-4">No prices recorded yet.</p>
      )}
    </section>
  );
}

function ProductSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-x-8" aria-hidden="true">
      <div className="flex flex-col gap-2 md:order-2">
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-8 w-28" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-4 h-11 w-64" />
      </div>
      <Skeleton className="aspect-square w-full rounded-xl md:order-1" />
    </div>
  );
}
