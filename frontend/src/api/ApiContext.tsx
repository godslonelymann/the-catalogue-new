import { createContext, use } from "react";
import type { Api } from "./client";
import type { MockApi } from "@/test/mock/mockApi";

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = use(ApiContext);
  if (!api) throw new Error("useApi needs an ApiContext provider.");
  return api;
}

/** Returns the sample-data helpers when the app runs on the mock API. */
export function useSampleTools(): MockApi["sample"] | null {
  const api = useApi();
  return api.mode === "mock" ? (api as MockApi).sample : null;
}
