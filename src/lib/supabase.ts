/**
 * The single Supabase client for the whole app.
 *
 * SECURITY NOTE
 * -------------
 * The two values below are the *public* Supabase URL and anon key. They are compiled
 * into the JavaScript bundle and are visible to anyone who opens devtools — that is
 * by design and is how Supabase is meant to be used from a browser.
 *
 * What makes that safe is Row Level Security: the anon key only lets a request reach
 * the database, it does not decide what that request may see. Every table in
 * supabase/migrations has RLS enabled with explicit policies.
 *
 * A service-role key must NEVER appear in this file, in any `VITE_*` variable, or
 * anywhere else in `src/` — it bypasses RLS entirely.
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Whether the app has been given Supabase credentials.
 *
 * Checked before the client is used so a missing `.env` produces a clear setup
 * message instead of an opaque network failure on the sign-in screen.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing-anon-key', {
  auth: {
    // Keeps the session in localStorage and refreshes it in the background, so the
    // three of us stay signed in across reloads and app restarts.
    persistSession: true,
    autoRefreshToken: true,
    // The app uses HashRouter, and magic-link/recovery callbacks arrive in the URL
    // fragment. Letting the client consume them keeps the redirect handling simple.
    detectSessionInUrl: true,
    storageKey: 'habits.auth',
  },
})

/**
 * Turns a Supabase/PostgREST error into something worth showing a person.
 *
 * Postgres constraint names leak into `message`, so the few we can actually
 * anticipate are translated. Anything else falls back to the raw message, which is
 * more useful than a generic "Something went wrong" when only three people use the app.
 */
export function describeError(error: unknown): string {
  if (!error) return 'Something went wrong.'

  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)

  if (message.includes('habit_checkins_one_per_day')) {
    return 'That day is already checked off.'
  }
  if (message.includes('habits_recurrence_shape')) {
    return 'That schedule is not valid. Pick at least one day, or a weekly target of 1–7.'
  }
  if (message.includes('row-level security')) {
    return 'You do not have permission to do that.'
  }
  if (message.includes('Invalid login credentials')) {
    return 'That email and password do not match an account.'
  }
  if (message.includes('Email not confirmed')) {
    return 'Check your email and confirm your address first.'
  }
  if (message.includes('User already registered')) {
    return 'There is already an account with that email. Try signing in instead.'
  }
  if (message.includes('Password should be')) {
    return 'Password must be at least 6 characters.'
  }
  if (/Failed to fetch|NetworkError|network/i.test(message)) {
    return 'Cannot reach the server. Check your connection.'
  }

  return message
}
