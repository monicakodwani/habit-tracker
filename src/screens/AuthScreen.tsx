/**
 * The sign-in / sign-up screen.
 *
 * This is everything an unauthenticated visitor can reach. No habit, profile,
 * membership or check-in data is fetched before a session exists, and even if a
 * request were made, RLS would return nothing.
 *
 * Email + password rather than magic links: it works identically on GitHub Pages
 * under a subpath, needs no redirect-URL configuration, and does not depend on a
 * link opening in the same browser it was requested from — which on iOS is a real
 * source of friction.
 */
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'
import { describeError, isSupabaseConfigured } from '../lib/supabase'
import { Button, ErrorText, Field, INPUT_CLASS } from '../components/ui'

type Mode = 'signin' | 'signup'

export function AuthScreen() {
  const { signIn, signUp } = useAuth()

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isSignUp = mode === 'signup'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    // Guards against a double submit from an impatient second tap.
    if (submitting) return

    setError(null)
    setNotice(null)

    if (!email.trim() || !password) {
      setError('Email and password are both required.')
      return
    }
    if (isSignUp && !displayName.trim()) {
      setError('What should your friends call you?')
      return
    }

    setSubmitting(true)
    try {
      if (isSignUp) {
        await signUp(email, password, displayName)
        // Whether a session exists now depends on the project's email-confirmation
        // setting. If it does, the auth listener swaps this screen out from under us.
        setNotice('Account created. If your project requires email confirmation, check your inbox.')
      } else {
        await signIn(email, password)
      }
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  if (!isSupabaseConfigured) {
    return <SetupNeeded />
  }

  return (
    /*
     * One centred card at every size — deliberately not a split-screen marketing
     * page. On a phone it stays the plain full-bleed page it has always been; from
     * `sm` up it gains a surface so it reads as an object rather than text adrift in
     * a large window.
     */
    <main className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center px-6 py-12">
      <div className="sm:rounded-3xl sm:border sm:border-line sm:bg-surface sm:px-8 sm:py-10 sm:shadow-sm">
        <div className="mb-9 text-center">
        <p aria-hidden="true" className="text-4xl">
          🌱
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Habits</h1>
        <p className="mt-2 text-[0.95rem] text-ink-soft">
          A small shared space for keeping each other going.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {isSignUp && (
          <Field label="Your name">
            <input
              className={INPUT_CLASS}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="nickname"
              enterKeyHint="next"
              maxLength={40}
              required
            />
          </Field>
        )}

        <Field label="Email">
          <input
            className={INPUT_CLASS}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            // These four attributes are what make the iOS keyboard behave: the right
            // key layout, no autocapitalised email, and password-manager support.
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="next"
            required
          />
        </Field>

        <Field label="Password" hint={isSignUp ? 'At least 6 characters.' : undefined}>
          <input
            className={INPUT_CLASS}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            enterKeyHint="go"
            minLength={6}
            required
          />
        </Field>

        {error && <ErrorText>{error}</ErrorText>}
        {notice && (
          <p role="status" className="text-sm font-medium text-accent-ink">
            {notice}
          </p>
        )}

        <Button type="submit" full disabled={submitting}>
          {submitting ? 'One moment…' : isSignUp ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
        <button
          type="button"
          className="-my-2 inline-flex min-h-11 items-center px-1 font-semibold text-accent-ink underline underline-offset-2"
          onClick={() => {
            setMode(isSignUp ? 'signin' : 'signup')
            setError(null)
            setNotice(null)
          }}
        >
          {isSignUp ? 'Sign in' : 'Create one'}
        </button>
      </p>
      </div>
    </main>
  )
}

/** Shown when the app was built without Supabase credentials. */
function SetupNeeded() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-semibold">Almost there</h1>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
        This build has no Supabase credentials. Copy <code>.env.example</code> to{' '}
        <code>.env</code>, fill in <code>VITE_SUPABASE_URL</code> and{' '}
        <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
      </p>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
        For the deployed site, add the same two values as repository secrets — see the
        README.
      </p>
    </main>
  )
}
