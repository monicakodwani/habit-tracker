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
import { formatWeekRange, weekDates } from '../domain/dates'
import { WEEKDAY_INITIALS, WEEKDAYS } from '../types/models'
import { describeRecurrence } from '../domain/recurrence'
import { Card, Screen, Section } from '../components/Layout'
import { ButtonLink, EmptyState, ListSkeleton } from '../components/ui'

export function WeekScreen() {
  const { status, me, habits, checkins, today, zone } = useAppData()

  const dates = useMemo(() => weekDates(today, zone), [today, zone])
  const rows = useMemo(
    () => (me ? buildWeekRows(me.id, habits, checkins, dates, today, zone) : []),
    [me, habits, checkins, dates, today, zone],
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

function DayCell({
  cell,
  habitName,
  isWeekly,
}: {
  cell: WeekRow['days'][number]
  habitName: string
  isWeekly: boolean
}) {
  // A scheduled habit's unscheduled days are shown as a faint dash rather than an
  // empty circle, so "not due" never looks like "not done".
  const notApplicable = !isWeekly && !cell.scheduled

  const label = cell.completed
    ? 'done'
    : notApplicable
      ? 'not scheduled'
      : cell.isFuture
        ? 'still to come'
        : 'missed'

  const base = 'flex size-7 items-center justify-center rounded-full text-[0.7rem]'

  return (
    <span
      className={`${base} ${
        cell.completed
          ? 'bg-accent text-bg'
          : notApplicable
            ? 'text-ink-faint/50'
            : cell.isFuture
              ? 'border border-dashed border-line'
              : 'border border-line'
      } ${cell.isToday ? 'ring-2 ring-accent/35 ring-offset-1 ring-offset-surface' : ''}`}
    >
      <span className="sr-only">{`${habitName}, ${cell.date}: ${label}`}</span>
      {cell.completed ? (
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
      ) : notApplicable ? (
        <span aria-hidden="true">·</span>
      ) : null}
    </span>
  )
}
