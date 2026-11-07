import { describe, expect, it } from "vitest";
import { parseStoreUrl } from "./storeUrl";

describe("parseStoreUrl", () => {
  it.each([
    ["fugazee.com", "https://fugazee.com/"],
    ["https://www.fugazee.com/", "https://www.fugazee.com/"],
    ["  https://Fugazee.com/collections/all  ", "https://fugazee.com/"],
    ["https://fugazee.com./", "https://fugazee.com/"],
  ])("accepts %s", (input, url) => {
    expect(parseStoreUrl(input)).toMatchObject({ ok: true, url });
  });

  it.each([
    ["", "empty"],
    ["not a url", "invalid"],
    ["http://fugazee.com", "not_https"],
    ["ftp://fugazee.com", "invalid"],
    ["https://fugazee.com/products/racer-tee", "product_page"],
    ["https://fugazee.com/collections/new/products/racer-tee", "product_page"],
    ["https://user:pass@fugazee.com", "invalid"],
    ["https://fugazee.com:8443", "invalid"],
    ["https://127.0.0.1", "invalid"],
    ["https://[::1]", "invalid"],
    ["https://localhost", "invalid"],
    ["https://shop.localhost", "invalid"],
  ])("rejects %s as %s", (input, problem) => {
    expect(parseStoreUrl(input)).toEqual({ ok: false, problem });
  });
});
