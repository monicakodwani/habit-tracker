/**
 * Today — the screen the app exists for.
 *
 * Your habits at the top, with the only tappable controls in the app for completing
 * them. Your friends below, read-only. Nothing else.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import { buildFriendsToday, buildPersonToday, isDone } from '../domain/status'
import type { PersonToday } from '../domain/status'
import { formatLongDate } from '../domain/dates'
import { describeDailyProgress } from '../domain/recurrence'
import { Card, Screen, Section } from '../components/Layout'
import { ButtonLink, EmptyState, ListSkeleton } from '../components/ui'
import { FriendHabitRow, OwnHabitRow } from '../components/HabitRow'

export function TodayScreen() {
  const { status, me, habits, checkins, friends, today, zone, toggleCheckin } = useAppData()

  const mine = useMemo(
    () => (me ? buildPersonToday(me, habits, checkins, zone) : null),
    [me, habits, checkins, zone],
  )

  const theirs = useMemo(
    () => buildFriendsToday(friends, habits, checkins),
    [friends, habits, checkins],
  )

  return (
    <Screen>
      <header className="mb-7">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">
          {formatLongDate(today, zone)}
        </h1>
      </header>

      <Section title="You">
        {status === 'loading' || !mine ? (
          <ListSkeleton rows={3} />
        ) : mine.items.length === 0 ? (
          <NothingDueForYou hasAnyHabits={habits.some((h) => h.owner_id === me?.id)} />
        ) : (
          <>
            <Card className="px-4">
              <ul>
                {mine.items.map((item) => (
                  <OwnHabitRow
                    key={item.habit.id}
                    status={item}
                    onToggle={() =>
                      void toggleCheckin(item.habit, today, item.completedToday)
                    }
                  />
                ))}
              </ul>
            </Card>
            <p className="mt-3 px-1 text-[0.85rem] text-ink-faint">
              {describeDailyProgress(mine.completedCount, mine.totalCount)}
            </p>
          </>
        )}
      </Section>

      {status === 'ready' && theirs.length > 0 && (
        <Section title="Your people">
          <div className="space-y-3">
            {theirs.map((person) => (
              <FriendCard key={person.profile.id} person={person} />
            ))}
          </div>
        </Section>
      )}
    </Screen>
  )
}

/**
 * A friend's card is read-only by construction — it renders {@link FriendHabitRow},
 * which has no completion control at all. There is no disabled button to tap, so the
 * boundary reads as "this is theirs", not "you are not allowed".
 */
function FriendCard({ person }: { person: PersonToday }) {
  const { profile, items } = person
  const doneCount = items.filter(isDone).length

  return (
    <Card className="px-4 py-3.5">
      <div className="mb-1 flex items-center gap-2.5">
        <span aria-hidden="true" className="text-xl leading-none">
          {profile.avatar_emoji}
        </span>
        <h3 className="flex-1 text-[0.95rem] font-semibold">{profile.display_name}</h3>
        {items.length > 0 && (
          <span className="text-[0.8rem] tabular-nums text-ink-faint">
            {doneCount}/{items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-1.5 text-[0.9rem] text-ink-faint">
          Nothing on {profile.display_name}&rsquo;s list today ✨
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <FriendHabitRow key={item.habit.id} status={item} />
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * Two different empty states, because they mean different things: a brand new user
 * needs a way to start, whereas someone with a rest day just needs reassuring.
 */
function NothingDueForYou({ hasAnyHabits }: { hasAnyHabits: boolean }) {
  if (!hasAnyHabits) {
    return (
      <EmptyState
        title="You haven't added anything yet."
        action={<ButtonLink to="/habits/new">+ Add a habit</ButtonLink>}
      />
    )
  }
  return (
    <EmptyState
      title="Nothing due today. Enjoy it ✨"
      compact
      action={
        <Link
          to="/me"
          className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-accent-ink underline underline-offset-2"
        >
          See all your habits
        </Link>
      }
    />
  )
}
