/**
 * Today — the screen the app exists for.
 *
 * Your habits at the top, with the only tappable completion controls in the app.
 * Your friends below, read-only apart from a nudge. Anyone asking for a push floats
 * to the top of their own card.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import {
  buildFriendsToday,
  buildPersonToday,
  isDone,
  prioritizeForFriendCard,
} from '../domain/status'
import type { HabitStatus, PersonToday } from '../domain/status'
import { formatLongDate } from '../domain/dates'
import { describeDailyProgress } from '../domain/recurrence'
import { describeNudgeBlock, nudgeAvailability } from '../domain/nudges'
import type { Habit, Profile } from '../types/models'
import { Card, Screen, Section } from '../components/Layout'
import { ButtonLink, EmptyState, ListSkeleton } from '../components/ui'
import { FriendHabitRow, OwnHabitRow } from '../components/HabitRow'
import { HabitActionSheet } from '../components/HabitActionSheet'
import { NudgeSheet } from '../components/NudgeSheet'
import { useToast } from '../components/Toast'

export function TodayScreen() {
  const {
    status,
    me,
    habits,
    checkins,
    habitDays,
    friends,
    today,
    zone,
    sentNudges,
    toggleCheckin,
    markAtRisk,
    clearAtRisk,
    setExcused,
    setLapse,
    sendNudge,
  } = useAppData()
  const { showToast } = useToast()

  const [actionsFor, setActionsFor] = useState<HabitStatus | null>(null)
  const [nudgeTarget, setNudgeTarget] = useState<{ habit: Habit; person: Profile } | null>(null)

  const mine = useMemo(
    () => (me ? buildPersonToday(me, habits, checkins, zone, undefined, habitDays) : null),
    [me, habits, checkins, zone, habitDays],
  )

  const theirs = useMemo(
    () => buildFriendsToday(friends, habits, checkins, undefined, habitDays),
    [friends, habits, checkins, habitDays],
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
                    onToggle={() => void toggleCheckin(item.habit, today, item.completedToday)}
                    onOpenActions={() => setActionsFor(item)}
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
              <FriendCard
                key={person.profile.id}
                person={person}
                viewerId={me?.id ?? ''}
                sentNudges={sentNudges}
                onNudge={(habit) => setNudgeTarget({ habit, person: person.profile })}
              />
            ))}
          </div>
        </Section>
      )}

      {actionsFor && (
        <HabitActionSheet
          open
          onClose={() => setActionsFor(null)}
          status={actionsFor}
          onComplete={() => void toggleCheckin(actionsFor.habit, today, false)}
          onUndoComplete={() => void toggleCheckin(actionsFor.habit, today, true)}
          onAtRisk={(note) => void markAtRisk(actionsFor.habit, note)}
          onClearAtRisk={() => void clearAtRisk(actionsFor.habit)}
          onExcuse={() => void setExcused(actionsFor.habit, today, true)}
          onUnexcuse={() => void setExcused(actionsFor.habit, today, false)}
          onLapse={() => void setLapse(actionsFor.habit, today, true)}
          onUndoLapse={() => void setLapse(actionsFor.habit, today, false)}
        />
      )}

      {nudgeTarget && (
        <NudgeSheet
          open
          onClose={() => setNudgeTarget(null)}
          habit={nudgeTarget.habit}
          recipient={nudgeTarget.person}
          onSend={async (message, preset) => {
            await sendNudge(nudgeTarget.habit, message, preset)
            showToast(`Nudged ${nudgeTarget.person.display_name} 👋`, 'info')
          }}
        />
      )}
    </Screen>
  )
}

/**
 * A friend's card is read-only by construction — it renders {@link FriendHabitRow},
 * which has no completion control at all. There is no disabled tick box to tap, so
 * the boundary reads as "this is theirs", not "you are not allowed".
 */
function FriendCard({
  person,
  viewerId,
  sentNudges,
  onNudge,
}: {
  person: PersonToday
  viewerId: string
  sentNudges: ReturnType<typeof useAppData>['sentNudges']
  onNudge: (habit: Habit) => void
}) {
  const { profile, items, date } = person
  const doneCount = items.filter(isDone).length
  const ordered = useMemo(() => prioritizeForFriendCard(items), [items])

  // The friend's own wall-clock time, for the "after a time" nudge policy. Derived
  // from their timezone rather than the viewer's, which is the whole point.
  const theirLocalTime = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: profile.timezone,
      }).format(new Date()),
    [profile.timezone],
  )

  return (
    <Card className="px-4 py-3.5">
      <div className="mb-1 flex items-center gap-2.5">
        <span aria-hidden="true" className="text-xl leading-none">
          {profile.avatar_emoji}
        </span>
        <h3 className="flex-1 text-[0.95rem] font-semibold">{profile.display_name}</h3>
        {person.atRiskCount > 0 && (
          <span className="rounded-full bg-flame/15 px-2 py-0.5 text-[0.7rem] font-semibold text-flame">
            Needs a push
          </span>
        )}
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
          {ordered.map((item) => {
            const availability = nudgeAvailability(item.habit, {
              viewerId,
              ownerToday: date,
              ownerZone: profile.timezone,
              lookup: item.lookup,
              checkins: item.checkins,
              atRisk: item.atRisk,
              sentNudges,
              ownerLocalTime: theirLocalTime,
            })

            return (
              <FriendHabitRow
                key={item.habit.id}
                status={item}
                nudgeLabel={describeNudgeBlock(availability.reason)}
                onNudge={availability.allowed ? () => onNudge(item.habit) : null}
              />
            )
          })}
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
