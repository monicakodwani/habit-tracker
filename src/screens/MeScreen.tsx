/**
 * Me — profile, habit management, and sign out.
 *
 * A hub rather than a settings tree: on a phone, one scrollable page with clear
 * sections beats three levels of navigation for this little content.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import { describeRecurrence } from '../domain/recurrence'
import { describeError } from '../lib/supabase'
import type { Habit } from '../types/models'
import { Card, Screen, Section } from '../components/Layout'
import { Button, ButtonLink, EmptyState, ListSkeleton } from '../components/ui'
import { NotificationSettings } from '../components/NotificationSettings'

export function MeScreen() {
  const { status, me, group, habits, setHabitActive } = useAppData()
  const { signOut } = useAuth()
  const { showToast } = useToast()
  const [showArchived, setShowArchived] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const { active, archived } = useMemo(() => {
    const mine = habits
      .filter((h) => h.owner_id === me?.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    return {
      active: mine.filter((h) => h.active),
      archived: mine.filter((h) => !h.active),
    }
  }, [habits, me?.id])

  async function toggleArchive(habit: Habit) {
    setBusyId(habit.id)
    try {
      await setHabitActive(habit.id, !habit.active)
    } catch (cause) {
      showToast(describeError(cause))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Screen>
      <header className="mb-7">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Me</h1>
      </header>

      <Section>
        {me ? (
          <Link
            to="/me/profile"
            className="flex min-h-16 items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-3.5"
          >
            <span aria-hidden="true" className="text-3xl leading-none">
              {me.avatar_emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[1.05rem] font-semibold">
                {me.display_name}
              </span>
              <span className="mt-0.5 block truncate text-[0.82rem] text-ink-faint">
                {me.timezone.replace(/_/g, ' ')}
                {group && ` · ${group.name}`}
              </span>
            </span>
            <Chevron />
          </Link>
        ) : (
          <ListSkeleton rows={1} />
        )}
      </Section>

      <Section
        title="Your habits"
        action={
          active.length > 0 ? (
            <Link
              to="/habits/new"
              // Negative margin keeps it visually inline with the section label while
              // the hit area grows to a comfortable 44px.
              className="-my-3 inline-flex min-h-11 items-center px-1 text-[0.82rem] font-semibold text-accent-ink underline underline-offset-2"
            >
              + New
            </Link>
          ) : undefined
        }
      >
        {status === 'loading' ? (
          <ListSkeleton rows={3} />
        ) : active.length === 0 ? (
          <EmptyState
            title="You haven't added anything yet."
            action={<ButtonLink to="/habits/new">+ Add a habit</ButtonLink>}
          />
        ) : (
          <Card className="px-4">
            <ul>
              {active.map((habit) => (
                <HabitManageRow
                  key={habit.id}
                  habit={habit}
                  busy={busyId === habit.id}
                  onArchive={() => void toggleArchive(habit)}
                />
              ))}
            </ul>
          </Card>
        )}
      </Section>

      {archived.length > 0 && (
        <Section>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="flex min-h-11 w-full items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.09em] text-ink-faint"
          >
            Archived ({archived.length})
            <span aria-hidden="true" className={showArchived ? 'rotate-90' : ''}>
              ›
            </span>
          </button>
          {showArchived && (
            <Card className="mt-2 px-4">
              <ul>
                {archived.map((habit) => (
                  <HabitManageRow
                    key={habit.id}
                    habit={habit}
                    busy={busyId === habit.id}
                    onArchive={() => void toggleArchive(habit)}
                  />
                ))}
              </ul>
            </Card>
          )}
        </Section>
      )}

      {me && (
        <Section title="Notifications">
          <NotificationSettings userId={me.id} />
        </Section>
      )}

      <Section title="Settings">
        <Card className="px-4 py-2">
          <Button variant="quiet" full className="justify-start px-0" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Card>
        <p className="mt-4 px-1 text-[0.75rem] leading-relaxed text-ink-faint">
          Archiving keeps a habit&rsquo;s history but takes it off Today and Week.
          An excused day doesn&rsquo;t count as done and doesn&rsquo;t break a streak.
        </p>
      </Section>
    </Screen>
  )
}

function HabitManageRow({
  habit,
  busy,
  onArchive,
}: {
  habit: Habit
  busy: boolean
  onArchive: () => void
}) {
  return (
    <li className="flex items-center gap-2 border-b border-line/70 last:border-b-0">
      <Link to={`/habits/${habit.id}`} className="flex min-h-16 flex-1 items-center gap-3 py-3">
        <span aria-hidden="true" className="text-xl leading-none">
          {habit.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[1rem] font-medium">{habit.name}</span>
          <span className="mt-0.5 block text-[0.8rem] text-ink-faint">
            {describeRecurrence(habit)}
            {habit.visibility === 'private' && ' · Private'}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={onArchive}
        disabled={busy}
        // Quiet on purpose: this sits beside the habit name and must not compete
        // with it, or read as the primary action on the row.
        className="min-h-11 shrink-0 rounded-lg px-2 text-[0.72rem] font-semibold uppercase tracking-wide text-ink-faint hover:text-ink disabled:opacity-50"
      >
        {habit.active ? 'Archive' : 'Restore'}
      </button>
    </li>
  )
}

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 shrink-0 text-ink-faint">
      <path
        d="m7.5 4 5.5 6-5.5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
