import { useState } from "react";
import { Link, useParams } from "react-router";
import { useApi } from "@/api/ApiContext";
import { isApiError } from "@/api/client";
import type { ProductDetail, Variant } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dateTime, money, shortDate } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { cn } from "@/lib/utils";
import { BellIcon, BellRingIcon, ExternalLinkIcon, LoaderIcon } from "../icons";
import { useBreadcrumbs } from "../context";
import { PageHeader, ProductImage, RetryAlert, SaveToggle, StatusBadge, StockLabel } from "../parts";
import { NotFoundState } from "./StorePage";

export function ProductPage() {
  const { storeId = "", productId = "" } = useParams();
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
      <ProductView key={data.id} product={data} onChange={product.reload} />
    </>
  );
}

const defaultVariant = (product: ProductDetail) => product.variants.find(variant => variant.available) ?? product.variants[0];
const sameOptions = (a: string[], b: string[]) => a.every((value, index) => value === b[index]);

function ProductView({ product, onChange }: { product: ProductDetail; onChange(): Promise<void> }) {
  const api = useApi();
  const [selected, setSelected] = useState<string[]>(() => defaultVariant(product).options);
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
                const match = lookup(optionIndex, value);
                const soldOut = match ? !match.available : true;
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
                      soldOut && "text-muted-foreground line-through decoration-1",
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

        <div className="flex flex-col gap-4 rounded-xl border p-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{variant.title}</p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">{money(variant.price, product.currency)}</span>
              <StockLabel available={variant.available} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <a href={product.url} target="_blank" rel="noopener noreferrer">
                Visit store
                <ExternalLinkIcon aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </Button>
            {alertActive ? (
              <StatusBadge tone="accent">
                <BellRingIcon className="size-3.5" aria-hidden="true" />
                Watching this size
              </StatusBadge>
            ) : (
              <Button variant="outline" className="border-input" disabled={pending || variant.available} onClick={() => void createAlert()}>
                {pending ? <LoaderIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
                Email me when it’s back
              </Button>
            )}
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
              "This option is in stock. Alerts are for sold-out options."
            ) : (
              "Get one email when this exact option is back in stock. The product is also saved."
            )}
          </p>
          {error && (
            <p role="alert" className="text-[13px] leading-[18px] text-error">
              {error}
            </p>
          )}
        </div>
      </div>

      <section aria-labelledby="history-title" className="[grid-area:history]">
        <h2 id="history-title" className="dash-section-title">
          Price history
        </h2>
        <p className="dash-meta mb-3">
          {variant.title}
          {product.lastSuccessfulCheckAt && (
            <>
              {" "}
              · Last successful check <time dateTime={product.lastSuccessfulCheckAt}>{dateTime(product.lastSuccessfulCheckAt)}</time>
            </>
          )}
        </p>
        <ol className="divide-y rounded-xl border">
          {[...history].reverse().map((point, index, list) => {
            const previous = list[index + 1];
            const change = previous ? point.price - previous.price : 0;
            return (
              <li key={point.at} className="flex items-center justify-between gap-4 px-4 py-3 tabular-nums">
                <time dateTime={point.at} className="text-muted-foreground">
                  {shortDate(point.at)}
                </time>
                <span className="flex items-center gap-2">
                  {change !== 0 && (
                    <span className="dash-meta">
                      {change < 0 ? "Down" : "Up"} {money(Math.abs(change), product.currency)}
                    </span>
                  )}
                  <span className="font-semibold">{money(point.price, product.currency)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
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
