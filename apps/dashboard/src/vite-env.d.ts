/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public API base URL; defaults to http://localhost:3000 in development. */
  readonly VITE_PUBLIC_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
