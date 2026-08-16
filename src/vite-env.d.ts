/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public Supabase project URL. Safe to expose in the browser bundle. */
  readonly VITE_SUPABASE_URL: string
  /** Public Supabase anon key. Safe to expose — RLS is what enforces access. */
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
