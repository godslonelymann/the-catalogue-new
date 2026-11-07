/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mock" turns on sample data in `npm run dev` only. Production builds ignore it. */
  readonly VITE_API_MODE?: "mock";
}
