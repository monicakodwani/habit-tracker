/**
 * Habit rows for the Today screen.
 *
 * Two variants, deliberately different shapes:
 *
 *   - {@link OwnHabitRow} has a completion control and opens the habit's detail page.
 *   - {@link FriendHabitRow} has neither. A friend's habit is information, not
 *     something to act on, and the UI should not imply otherwise.
 */
import { Link } from 'react-router-dom'
import type { HabitStatus } from '../domain/status'
import { CheckButton, CheckIndicator } from './CheckButton'

/** "🔥 12 days" or "2 / 3 this week" — whichever the habit's recurrence calls for. */
function HabitMeta({ status }: { status: HabitStatus }) {
  const { streak, weekly } = status

  if (weekly) {
    return (
      <span className={weekly.met ? 'text-accent-ink' : 'text-ink-faint'}>
        {weekly.completed} / {weekly.target} this week
      </span>
    )
  }

  if (streak && streak.current > 0) {
    return (
      <span className="text-ink-faint">
        <span aria-hidden="true">🔥</span> {streak.current}
        {streak.current === 1 ? ' day' : ' days'}
      </span>
    )
  }

  return null
}

export function OwnHabitRow({
  status,
  onToggle,
}: {
  status: HabitStatus
  onToggle: () => void
}) {
  const { habit, completedToday } = status
  const meta = <HabitMeta status={status} />

  return (
    <li className="flex items-center gap-1 border-b border-line/70 last:border-b-0">
      {/*
        The name area navigates to the habit's history; the circle on the right
        completes it. Keeping them as two separate controls means neither action can
        be triggered by accident while reaching for the other.
      */}
      <Link
        to={`/habits/${habit.id}`}
        className="flex min-h-16 flex-1 items-center gap-3 py-3 pr-2 text-left"
      >
        <span aria-hidden="true" className="text-2xl leading-none">
          {habit.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[1.02rem] font-medium transition-colors ${
              completedToday ? 'text-ink-soft' : 'text-ink'
            }`}
          >
            {habit.name}
          </span>
          {meta && <span className="mt-0.5 block text-[0.82rem]">{meta}</span>}
        </span>
      </Link>
      <CheckButton checked={completedToday} label={habit.name} onToggle={onToggle} />
    </li>
  )
}

export function FriendHabitRow({ status }: { status: HabitStatus }) {
  const { habit, completedToday, weekly } = status
  const done = completedToday || weekly?.met === true

  return (
    <li className="flex min-h-11 items-center gap-2.5 py-1.5">
      <CheckIndicator checked={done} />
      <span aria-hidden="true" className="text-base leading-none">
        {habit.emoji}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[0.95rem] ${done ? 'text-ink-soft' : 'text-ink'}`}>
        {habit.name}
      </span>
      {weekly && (
        <span className="shrink-0 text-[0.8rem] tabular-nums text-ink-faint">
          {weekly.completed} / {weekly.target}
        </span>
      )}
    </li>
  )
}
