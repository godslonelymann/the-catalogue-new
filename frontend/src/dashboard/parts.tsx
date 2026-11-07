import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertCircleIcon, ImageOffIcon } from "lucide-react";
import { useApi } from "@/api/ApiContext";
import { isApiError } from "@/api/client";
import type { ProductSummary } from "@/api/types";
import { useToast } from "@/components/Toast";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { money, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HeartIcon, LoaderIcon } from "./icons";
import { useDashboard, type Crumb } from "./context";

export function Crumbs({ crumbs, className }: { crumbs: Crumb[]; className?: string }) {
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={index}>
              <BreadcrumbItem className="min-w-0">
                {last || !crumb.to ? (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild className="truncate">
                    <Link to={crumb.to}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * The page heading. Nested pages show their breadcrumbs above it on mobile.
 * The heading takes focus after navigation, so screen readers announce the page.
 */
export function PageHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  const { crumbs } = useDashboard();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (typeof title === "string") document.title = `${title} · The Catalogue`;
  }, [title]);

  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {crumbs.length > 1 && <Crumbs crumbs={crumbs} className="mb-2 md:hidden" />}
        <h1 ref={heading} tabIndex={-1} className="dash-page-title outline-none [overflow-wrap:anywhere]">
          {title}
        </h1>
        {meta && <div className="dash-meta mt-1">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

type Tone = "success" | "pending" | "error" | "neutral" | "accent";

// Black and white: each tone differs by fill and border, and always has a text label.
const tones: Record<Tone, string> = {
  success: "bg-selected text-foreground",
  pending: "border-dashed border-input! bg-background text-muted-foreground",
  error: "border-foreground! bg-background text-foreground",
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-foreground text-background",
};

/** A status label. The colour always pairs with visible text. */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn("h-6 rounded-md border-transparent px-2 text-[13px] leading-[18px] font-medium", tones[tone])}>
      {children}
    </Badge>
  );
}

export function StockLabel({ available }: { available: boolean }) {
  return <StatusBadge tone={available ? "success" : "neutral"}>{available ? "In stock" : "Sold out"}</StatusBadge>;
}

/** An inline failure message with a Retry action. */
export function RetryAlert({ error, onRetry, title = "Couldn’t load this page" }: { error: unknown; onRetry(): void; title?: string }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Alert className="mb-6 border-foreground bg-background text-foreground">
      <AlertCircleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-muted-foreground">{message}</AlertDescription>
      <AlertAction>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}

/** Rows of static placeholders that match the size of the final rows. */
export function RowSkeletons({ count = 3, height = 72 }: { count?: number; height?: number }) {
  return (
    <ul className="divide-y rounded-xl border" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="flex items-center gap-4 px-4 py-3" style={{ minHeight: height }}>
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="hidden h-11 w-36 md:block" />
        </li>
      ))}
    </ul>
  );
}

/** A square image area. Missing images keep the same area. */
export function ProductImage({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  return (
    <AspectRatio ratio={1} className={cn("overflow-hidden bg-secondary", className)}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" className="product-image size-full object-contain" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground" role="img" aria-label={alt || "No image"}>
          <ImageOffIcon className="size-6" aria-hidden="true" />
        </div>
      )}
    </AspectRatio>
  );
}

/**
 * Returns focus to the control that opened an overlay. Radix only does this for its own
 * Trigger, and these dialogs open from several places.
 */
export function useFocusReturn() {
  const target = useRef<HTMLElement | null>(null);
  const capture = useCallback(() => {
    target.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const restore = useCallback((event: Event, fallback?: () => HTMLElement | null | undefined) => {
    event.preventDefault();
    const element = target.current?.isConnected ? target.current : fallback?.();
    target.current = null;
    element?.focus();
  }, []);
  return { capture, restore };
}

/** A product in a grid. The whole card links to the product. The heart saves it. */
export function ProductCard({ product, meta, onSavedChange }: { product: ProductSummary; meta?: string; onSavedChange?(saved: boolean): void }) {
  const varies = product.maxPrice !== undefined && product.maxPrice > product.price;
  return (
    <Card className="product-card group relative h-full gap-0 overflow-hidden rounded-xl border py-0 ring-0 transition-colors duration-(--dash-feedback) ease-(--dash-ease) hover:border-input">
      <ProductImage
        src={product.imageUrl}
        alt=""
        className="[&_img]:transition-transform [&_img]:duration-(--dash-enter) [&_img]:ease-(--dash-ease) group-hover:[&_img]:scale-[1.02]"
      />
      {/* Above the card link, so it gets its own clicks. */}
      <div className="absolute top-2 right-2 z-10">
        <SaveToggle product={product} onChange={onSavedChange} />
      </div>
      <div className="flex flex-1 flex-col gap-1 border-t p-3">
        {meta && <p className="dash-meta">{meta}</p>}
        <h2 className="text-sm leading-[22px] font-medium">
          {/* One link per card. It covers the whole card. */}
          <Link to={`/stores/${product.storeId}/products/${product.id}`} className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring">
            {product.title}
          </Link>
        </h2>
        <p className="text-sm font-semibold tabular-nums">
          {varies && <span className="font-normal text-muted-foreground">From </span>}
          {money(product.price, product.currency)}
        </p>
        <div className="mt-1">
          <StockLabel available={product.inStock} />
        </div>
      </div>
    </Card>
  );
}

/**
 * Saves a product, or removes it from Saved. Removing also stops its size alerts. The heart changes after the API confirms.
 * "icon" is a round button for product cards. "button" is a labelled button for the product page.
 */
export function SaveToggle({
  product,
  display = "icon",
  onChange,
}: {
  product: Pick<ProductSummary, "id" | "title" | "saved">;
  display?: "icon" | "button";
  onChange?(saved: boolean): void;
}) {
  const api = useApi();
  const toast = useToast();
  const [saved, setSaved] = useState(product.saved);
  const [pending, setPending] = useState(false);
  // A reload of the page data wins over the local state.
  const [lastProp, setLastProp] = useState(product.saved);
  if (lastProp !== product.saved) {
    setLastProp(product.saved);
    setSaved(product.saved);
  }

  async function toggle() {
    const next = !saved;
    setPending(true);
    try {
      let cancelledAlerts = 0;
      if (next) await api.saveProduct(product.id);
      else {
        try {
          ({ cancelledAlerts } = await api.unsaveProduct(product.id));
        } catch (failure) {
          // Already removed, for example in another tab.
          if (!isApiError(failure, "not_found")) throw failure;
        }
      }
      setSaved(next);
      toast(next ? "Saved" : cancelledAlerts ? `Removed. ${plural(cancelledAlerts, "size alert")} stopped.` : "Removed from Saved");
      onChange?.(next);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "We couldn’t update Saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  const label = saved ? `Remove ${product.title} from Saved` : `Save ${product.title}`;
  const icon = pending ? (
    <LoaderIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
  ) : (
    <HeartIcon aria-hidden="true" fill={saved ? "currentColor" : "none"} />
  );
  if (display === "button") {
    return (
      <Button variant="outline" className="border-input" aria-pressed={saved} aria-label={label} disabled={pending} onClick={() => void toggle()}>
        {icon}
        {saved ? "Saved" : "Save"}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="icon"
      className="size-11 rounded-full border-input bg-background/90 backdrop-blur-sm"
      aria-pressed={saved}
      aria-label={label}
      title={saved ? "Remove from Saved" : "Save"}
      disabled={pending}
      onClick={() => void toggle()}
    >
      {icon}
    </Button>
  );
}
