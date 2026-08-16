/**
 * Routing and the top-level gate between "signed out" and "signed in".
 *
 * An unauthenticated visitor only ever reaches {@link AuthScreen}; the data provider
 * is not even mounted, so no query for habits, profiles or check-ins is issued.
 */
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { AppDataProvider, useAppData } from './hooks/useAppData'
import { ToastProvider } from './components/Toast'
import { BottomNav } from './components/BottomNav'
import { Sidebar } from './components/Sidebar'
import { Button, FullScreenLoader } from './components/ui'
import { AppShell, Screen } from './components/Layout'
import { AuthScreen } from './screens/AuthScreen'
import { TodayScreen } from './screens/TodayScreen'
import { WeekScreen } from './screens/WeekScreen'
import { ActivityScreen } from './screens/ActivityScreen'
import { MeScreen } from './screens/MeScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { HabitFormScreen } from './screens/HabitFormScreen'
import { HabitDetailScreen } from './screens/HabitDetailScreen'

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </AuthProvider>
  )
}

function Gate() {
  const { session, loading } = useAuth()

  // Brief: just the localStorage session lookup. A spinner here avoids flashing the
  // sign-in screen at someone who is already signed in.
  if (loading) return <FullScreenLoader />
  if (!session) return <AuthScreen />

  return (
    <AppDataProvider>
      <SignedInApp />
    </AppDataProvider>
  )
}

function SignedInApp() {
  const { status } = useAppData()

  if (status === 'error') return <LoadFailed />
  if (status === 'no-group') return <NotInAGroup />

  /*
   * One shell for both sizes. The sidebar hides itself below `lg` and the tab bar
   * hides itself from `lg` up, so exactly one is ever visible — and the routes,
   * screens and data flow are identical either way.
   */
  return (
    <AppShell sidebar={<Sidebar />}>
      <Routes>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/week" element={<WeekScreen />} />
        <Route path="/activity" element={<ActivityScreen />} />
        <Route path="/me" element={<MeScreen />} />
        <Route path="/me/profile" element={<ProfileScreen />} />
        <Route path="/habits/new" element={<HabitFormScreen mode="create" />} />
        <Route path="/habits/:habitId" element={<HabitDetailScreen />} />
        <Route path="/habits/:habitId/edit" element={<HabitFormScreen mode="edit" />} />
        {/* Anything unrecognised goes home rather than showing a dead end. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
    </AppShell>
  )
}

function LoadFailed() {
  const { error, reload } = useAppData()
  const { signOut } = useAuth()

  return (
    <Screen withNav={false}>
      <h1 className="text-xl font-semibold">Couldn&rsquo;t load your habits</h1>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">{error}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => void reload()}>Try again</Button>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </Screen>
  )
}

/**
 * Signed in, but not yet a member of any group.
 *
 * Expected on a first run: the client has no INSERT policy on `groups` or
 * `group_members` by design, so joining is an admin step run from the Supabase SQL
 * editor rather than something the app can do for itself.
 */
function NotInAGroup() {
  const { reload } = useAppData()
  const { signOut } = useAuth()

  return (
    <Screen withNav={false}>
      <p aria-hidden="true" className="text-4xl">
        🫖
      </p>
      <h1 className="mt-3 text-xl font-semibold">You&rsquo;re signed in</h1>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
        You&rsquo;re not part of a group yet. Whoever set this up needs to run{' '}
        <code>supabase/bootstrap.sql</code> with your email in it — then refresh.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => void reload()}>Refresh</Button>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </Screen>
  )
}
