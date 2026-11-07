import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { Api } from "./api/client";
import { createHttpApi } from "./api/http";
import "./index.css";
import "./styles.css";

/**
 * Live data from the FastAPI routes behind /api.
 *
 * For local development only, `npm run dev:mock` (VITE_API_MODE=mock) uses sample data
 * in the browser: any email and a password of 8 or more characters sign you in.
 * `import.meta.env.DEV` is false in production builds, so Vite removes this branch
 * and the sample data never ships.
 */
async function createApi(): Promise<Api> {
  if (import.meta.env.DEV && import.meta.env.VITE_API_MODE === "mock") {
    const { createMockApi } = await import("./test/mock/mockApi");
    console.info("The Catalogue: sample-data mode (VITE_API_MODE=mock). No requests go to /api.");
    return createMockApi({ storage: localStorage, session: sessionStorage });
  }
  return createHttpApi("/api");
}

const api = await createApi();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);
