/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public Supabase project URL. Safe to expose in the browser bundle. */
  readonly VITE_SUPABASE_URL: string
  /** Public Supabase anon key. Safe to expose — RLS is what enforces access. */
  readonly VITE_SUPABASE_ANON_KEY: string
  /**
   * VAPID **public** key for Web Push. Safe to expose: it is what the browser
   * encrypts to. The matching PRIVATE key lives only in a Supabase Edge Function
   * secret and must never appear in a VITE_ variable.
   *
   * Optional — without it the app works normally, just with push disabled.
   */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
