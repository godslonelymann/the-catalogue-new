export type StoreUrlProblem = "empty" | "invalid" | "not_https" | "product_page";

export type ParsedStoreUrl =
  | { ok: true; url: string; host: string }
  | { ok: false; problem: StoreUrlProblem };

export const storeUrlMessages: Record<StoreUrlProblem, string> = {
  empty: "Enter the store’s web address.",
  invalid: "Enter a full store address, such as https://fugazee.com.",
  not_https: "Use the store’s https:// address.",
  product_page: "Enter the store’s home page, not a product page.",
};

const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Checks the address format in the browser. The API still does the real check:
 * it matches the host to the approved store registry.
 */
export function parseStoreUrl(input: string): ParsedStoreUrl {
  const value = input.trim();
  if (!value) return { ok: false, problem: "empty" };
  if (/\s/.test(value)) return { ok: false, problem: "invalid" };

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  let url: URL;
  try {
    url = new URL(hasScheme ? value : "https://" + value);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (url.protocol === "http:") return { ok: false, problem: "not_https" };
  if (url.protocol !== "https:") return { ok: false, problem: "invalid" };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    host.startsWith("[") ||
    ipv4.test(host) ||
    host === "localhost" ||
    host.endsWith(".localhost")
  ) {
    return { ok: false, problem: "invalid" };
  }

  const path = url.pathname.toLowerCase();
  if (/(^|\/)products\/[^/]+/.test(path)) return { ok: false, problem: "product_page" };

  return { ok: true, url: "https://" + host + "/", host };
}
