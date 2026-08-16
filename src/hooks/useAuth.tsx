/**
 * Authentication state.
 *
 * Supabase persists the session in localStorage and refreshes the token in the
 * background, so the three of us stay signed in across reloads and Home Screen
 * launches. This hook mirrors that into React and exposes the handful of actions the
 * UI needs.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { guessTimezone } from '../domain/dates'

interface AuthValue {
  session: Session | null
  user: User | null
  /** True until the initial session lookup finishes. */
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    // Restore an existing session on load...
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    // ...then follow every later change: sign-in, sign-out, token refresh, and
    // expiry. This is what makes an expired session fall back to the auth screen
    // rather than leaving the app stuck on failing requests.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    // display_name and timezone ride along as user metadata; the
    // `on_auth_user_created` trigger reads them when it creates the profile row.
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          display_name: displayName.trim(),
          timezone: guessTimezone(),
        },
      },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    // A stale or already-expired session makes signOut fail server-side even though
    // the local session is gone. That is still a successful sign-out from the user's
    // point of view, so clear state rather than showing an error.
    if (error && !/session|jwt/i.test(error.message)) throw error
    setSession(null)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({ session, user: session?.user ?? null, loading, signIn, signUp, signOut }),
    [session, loading, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider')
  return context
}
