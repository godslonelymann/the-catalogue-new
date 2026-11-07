import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useApi } from "@/api/ApiContext";
import { isApiError } from "@/api/client";
import type { MonitoredStore } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { parseStoreUrl, storeUrlMessages } from "@/lib/storeUrl";
import { LoaderIcon } from "../icons";

interface Props {
  open: boolean;
  initialUrl?: string;
  brandCount: number | null;
  brandLimit: number;
  onOpenChange(open: boolean): void;
  onAdded(store: MonitoredStore): void;
  onCloseAutoFocus?(event: Event): void;
}

export function AddStoreDialog({ open, initialUrl, brandCount, brandLimit, onOpenChange, onAdded, onCloseAutoFocus }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 shadow-xl sm:max-w-[440px]!" onCloseAutoFocus={onCloseAutoFocus}>
        {/* The form mounts with the dialog, so each opening starts clean. */}
        <AddStoreForm initialUrl={initialUrl} brandCount={brandCount} brandLimit={brandLimit} onCancel={() => onOpenChange(false)} onAdded={onAdded} />
      </DialogContent>
    </Dialog>
  );
}

function AddStoreForm({
  initialUrl = "",
  brandCount,
  brandLimit,
  onCancel,
  onAdded,
}: {
  initialUrl?: string;
  brandCount: number | null;
  brandLimit: number;
  onCancel(): void;
  onAdded(store: MonitoredStore): void;
}) {
  const api = useApi();
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<ReactNode>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (checking) return;
    const parsed = parseStoreUrl(url);
    if (!parsed.ok) {
      setError(storeUrlMessages[parsed.problem]);
      input.current?.focus();
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const result = await api.addStore(parsed.url);
      if (result.created) return onAdded(result.store);
      setError(
        <>
          You already monitor {result.store.name}.{" "}
          <Link className="font-medium text-primary underline underline-offset-2" to={`/stores/${result.store.id}`} onClick={onCancel}>
            Open {result.store.name}
          </Link>
        </>,
      );
    } catch (failure) {
      if (isApiError(failure, "unsupported_store")) setError("Only supported Shopify stores can be added.");
      else if (isApiError(failure, "brand_limit")) setError(`You monitor ${brandLimit} brands, the limit. Remove a brand to add a new one.`);
      else if (isApiError(failure, "invalid_url")) setError(failure.message);
      else if (isApiError(failure, "check_failed")) setError("We couldn’t check this store. Try again later.");
      else setError(failure instanceof Error ? failure.message : "We couldn’t add this store. Try again.");
      input.current?.focus();
    } finally {
      setChecking(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} aria-busy={checking}>
      <DialogHeader className="gap-1 p-6 pb-4">
        <DialogTitle className="dash-section-title">Add a store</DialogTitle>
        <DialogDescription>We accept approved Shopify storefronts. Paste the store’s full address, such as https://fugazee.com.</DialogDescription>
      </DialogHeader>
      <div className="px-6 pb-6">
        <Field data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="store-url">Store URL</FieldLabel>
          <Input
            ref={input}
            id="store-url"
            name="store-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://"
            autoFocus
            value={url}
            readOnly={checking}
            aria-invalid={Boolean(error)}
            aria-describedby="store-url-help"
            onChange={event => {
              setUrl(event.target.value);
              setError(null);
            }}
          />
          <div aria-live="polite">
            {error ? (
              <FieldError>{error}</FieldError>
            ) : checking ? (
              <FieldDescription className="flex items-center gap-1.5">
                <LoaderIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Checking store…
              </FieldDescription>
            ) : null}
          </div>
          <FieldDescription id="store-url-help" className="tabular-nums">
            {brandCount !== null && `${brandCount} of ${brandLimit} brands. `}Storefronts from the same brand count as one brand.
          </FieldDescription>
        </Field>
      </div>
      <DialogFooter className="m-0 rounded-b-xl border-t bg-secondary px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={checking}>
          {checking && <LoaderIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Add store
        </Button>
      </DialogFooter>
    </form>
  );
}
