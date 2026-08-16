/**
 * Week — a compact look at your own week.
 *
 * Deliberately not an analytics dashboard: one row per habit, seven cells, and a
 * count for weekly-target habits. No charts, no percentages, no friends' weeks.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import { buildWeekRows } from '../domain/status'
import type { WeekRow } from '../domain/status'
import type { DayOutcome } from '../domain/dayState'
import { formatWeekRange, weekDates } from '../domain/dates'
import { WEEKDAY_INITIALS, WEEKDAYS } from '../types/models'
import { describeRecurrence } from '../domain/recurrence'
import { Card, Screen, Section } from '../components/Layout'
import { ButtonLink, EmptyState, ListSkeleton } from '../components/ui'

export function WeekScreen() {
  const { status, me, habits, checkins, habitDays, today, zone } = useAppData()

  const dates = useMemo(() => weekDates(today, zone), [today, zone])
  const rows = useMemo(
    () => (me ? buildWeekRows(me.id, habits, checkins, dates, today, zone, habitDays) : []),
    [me, habits, checkins, dates, today, zone, habitDays],
  )

  return (
    <Screen>
      <header className="mb-7">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">This week</h1>
        <p className="mt-1 text-[0.95rem] text-ink-soft">{formatWeekRange(today, zone)}</p>
      </header>

      <Section>
        {status === 'loading' ? (
          <ListSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="You haven't added anything yet."
            action={<ButtonLink to="/habits/new">+ Add a habit</ButtonLink>}
          />
        ) : (
          <div className="space-y-2.5">
            {rows.map((row) => (
              <HabitWeekRow key={row.habit.id} row={row} />
            ))}
          </div>
        )}
      </Section>
    </Screen>
  )
}

function HabitWeekRow({ row }: { row: WeekRow }) {
  const { habit, days, weekly } = row

  return (
    <Card className="px-4 py-3.5">
      <Link to={`/habits/${habit.id}`} className="flex min-h-11 items-center gap-2.5">
        <span aria-hidden="true" className="text-lg leading-none">
          {habit.emoji}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.98rem] font-medium">{habit.name}</span>
        <span
          className={`shrink-0 text-[0.8rem] tabular-nums ${
            weekly?.met ? 'text-accent-ink' : 'text-ink-faint'
          }`}
        >
          {weekly ? `${weekly.completed} / ${weekly.target}` : describeRecurrence(habit)}
        </span>
      </Link>

      {/*
        A table would be semantically neater, but seven cells wide it forces either
        tiny text or horizontal scrolling on a 375px screen. A labelled list of days
        reads correctly to a screen reader and fits comfortably.
      */}
      <ul className="mt-2.5 flex justify-between">
        {days.map((cell, i) => {
          const weekday = WEEKDAYS[i]!
          return (
            <li key={cell.date} className="flex flex-col items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`text-[0.68rem] font-semibold ${
                  cell.isToday ? 'text-accent-ink' : 'text-ink-faint'
                }`}
              >
                {WEEKDAY_INITIALS[weekday]}
              </span>
              <DayCell cell={cell} habitName={habit.name} isWeekly={weekly !== null} />
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * One day cell.
 *
 * Renders from the resolved {@link DayOutcome}, not from "was there a check-in" —
 * an avoidance habit succeeds by the *absence* of a lapse and has no check-ins at
 * all, so keying off completions would show a perfect week as a blank one.
 *
 * The state is always in the accessible label as well as the shape, so colour is
 * never the only carrier.
 */
function DayCell({
  cell,
  habitName,
  isWeekly,
}: {
  cell: WeekRow['days'][number]
  habitName: string
  isWeekly: boolean
}) {
  // A weekly-target habit has no schedule: a day is either a completion or nothing.
  const outcome: DayOutcome = isWeekly ? (cell.completed ? 'done' : 'off') : cell.outcome

  const label =
    outcome === 'done'
      ? 'done'
      : outcome === 'clean'
        ? 'clean'
        : outcome === 'still-going'
          ? 'still going'
          : outcome === 'lapsed'
            ? 'slip'
            : outcome === 'excused'
              ? 'excused'
              : outcome === 'missed'
                ? 'missed'
                : outcome === 'pending'
                  ? 'still to come'
                  : 'not scheduled'

  const base = 'flex size-7 items-center justify-center rounded-full text-[0.7rem]'
  const style =
    outcome === 'done' || outcome === 'clean'
      ? 'bg-accent text-bg'
      : outcome === 'lapsed'
        ? 'bg-danger-soft text-danger'
        : outcome === 'excused'
          ? 'border border-dashed border-accent/60 text-accent-ink'
          : outcome === 'off'
            ? 'text-ink-faint/50'
            : outcome === 'pending' || outcome === 'still-going'
              ? 'border border-dashed border-line'
              : 'border border-line'

  return (
    <span
      className={`${base} ${style} ${
        cell.isToday ? 'ring-2 ring-accent/35 ring-offset-1 ring-offset-surface' : ''
      }`}
    >
      <span className="sr-only">{`${habitName}, ${cell.date}: ${label}`}</span>
      {outcome === 'done' || outcome === 'clean' ? (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3.5">
          <path
            d="m4.5 10.5 3.5 3.5 7.5-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : outcome === 'excused' ? (
        <span aria-hidden="true" className="text-[0.6rem]">❄</span>
      ) : outcome === 'lapsed' ? (
        <span aria-hidden="true" className="text-[0.7rem] font-bold">·</span>
      ) : outcome === 'off' ? (
        <span aria-hidden="true">·</span>
      ) : null}
    </span>
  )
}
