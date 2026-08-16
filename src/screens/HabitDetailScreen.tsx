/**
 * Habit detail — streaks, a month calendar, and recent history.
 *
 * Loads this one habit's full check-in history rather than reusing the app-wide
 * window, so streaks and the "last 30 days" count are exact however long the habit
 * has been running.
 *
 * Only reachable for your own habits: a friend's habit is not linked from anywhere,
 * and RLS would refuse the check-in query for one you cannot see.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import { useToast } from '../components/Toast'
import type { Checkin, Habit, LocalDate } from '../types/models'
import { WEEKDAY_INITIALS, WEEKDAYS } from '../types/models'
import { describeRecurrence } from '../domain/recurrence'
import {
  formatMonthYear,
  formatRelativeDay,
  monthGrid,

} from '../domain/dates'
import {
  recentCheckins,
  recentWeeks,
  scheduledStreak,
  summarizeRange,
  weeklyStreak,
} from '../domain/streaks'
import { describeError } from '../lib/supabase'
import { fetchHabitCheckins } from '../services/checkins'
import { fetchHabitDayHistory } from '../services/social'
import { avoidStreak } from '../domain/streaks'
import { buildDayLookup, resolveDay } from '../domain/dayState'
import type { DayOutcome } from '../domain/dayState'
import type { HabitDay } from '../types/models'
import { Card, PageHeader, Screen, Section } from '../components/Layout'
import { Button, EmptyState, ListSkeleton } from '../components/ui'

export function HabitDetailScreen() {
  const { habitId } = useParams<{ habitId: string }>()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { status, me, habits, today, zone, setHabitActive, deleteHabit } = useAppData()

  const habit = habits.find((h) => h.id === habitId)
  const [history, setHistory] = useState<Checkin[] | null>(null)
  const [dayRows, setDayRows] = useState<HabitDay[]>([])
  const [busy, setBusy] = useState(false)

  // The habit's own history, independent of the app-wide check-in window.
  useEffect(() => {
    if (!habitId) return
    let active = true

    setHistory(null)
    Promise.all([fetchHabitCheckins(habitId), fetchHabitDayHistory(habitId)])
      .then(([checkins, days]) => {
        if (!active) return
        setHistory(checkins)
        setDayRows(days)
      })
      .catch((cause) => {
        if (!active) return
        showToast(describeError(cause))
        setHistory([])
      })

    return () => {
      active = false
    }
  }, [habitId, showToast])

  const handleArchive = useCallback(async () => {
    if (!habit) return
    setBusy(true)
    try {
      await setHabitActive(habit.id, !habit.active)
    } catch (cause) {
      showToast(describeError(cause))
    } finally {
      setBusy(false)
    }
  }, [habit, setHabitActive, showToast])

  const handleDelete = useCallback(async () => {
    if (!habit) return
    setBusy(true)
    try {
      await deleteHabit(habit.id)
      navigate('/me', { replace: true })
    } catch (cause) {
      showToast(describeError(cause))
      setBusy(false)
    }
  }, [habit, deleteHabit, navigate, showToast])

  if (status === 'loading') {
    return (
      <Screen>
        <PageHeader title=" " backTo="/" />
        <ListSkeleton rows={3} />
      </Screen>
    )
  }

  if (!habit || habit.owner_id !== me?.id) {
    return <Navigate to="/" replace />
  }

  return (
    <Screen>
      <PageHeader title={habit.name} backTo="/" backLabel="Today" />

      <div className="-mt-3 mb-1 flex items-center gap-2 text-[0.9rem] text-ink-soft">
        <span aria-hidden="true" className="text-xl leading-none">
          {habit.emoji}
        </span>
        <span>{describeRecurrence(habit)}</span>
        {habit.visibility === 'private' && <Tag>Private</Tag>}
        {!habit.active && <Tag>Archived</Tag>}
      </div>

      {history === null ? (
        <div className="mt-7">
          <ListSkeleton rows={3} />
        </div>
      ) : (
        <>
          <Consistency habit={habit} history={history} dayRows={dayRows} today={today} zone={zone} />
          <MonthCalendar habit={habit} history={history} dayRows={dayRows} today={today} zone={zone} />
          <History history={history} today={today} zone={zone} />
        </>
      )}

      <Section title="Manage">
        <div className="space-y-2.5">
          <Link
            to={`/habits/${habit.id}/edit`}
            className="flex min-h-12 w-full items-center justify-center rounded-full border border-line bg-surface px-5 text-[0.95rem] font-semibold hover:bg-sunken"
          >
            Edit habit
          </Link>
          <Button variant="secondary" full disabled={busy} onClick={() => void handleArchive()}>
            {habit.active ? 'Archive habit' : 'Restore habit'}
          </Button>
          <DeleteHabit habit={habit} count={history?.length ?? 0} busy={busy} onDelete={handleDelete} />
        </div>
      </Section>
    </Screen>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-sunken px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </span>
  )
}

/**
 * Streaks for scheduled habits, per-week counts for weekly-target ones, and the
 * "still going" form for avoidance habits.
 */
function Consistency({
  habit,
  history,
  dayRows,
  today,
  zone,
}: {
  habit: Habit
  history: Checkin[]
  dayRows: HabitDay[]
  today: LocalDate
  zone: string
}) {
  const isWeekly = habit.recurrence_type === 'weekly_target'
  const isAvoid = habit.kind === 'avoid'

  const streak = useMemo(
    () => scheduledStreak(habit, history, today, zone, dayRows),
    [habit, history, today, zone, dayRows],
  )
  const avoid = useMemo(
    () => (isAvoid ? avoidStreak(habit, dayRows, today, zone) : null),
    [isAvoid, habit, dayRows, today, zone],
  )
  const weeks = useMemo(
    () => (isWeekly ? recentWeeks(habit, history, today, zone, 6) : []),
    [isWeekly, habit, history, today, zone],
  )
  const weekStreak = useMemo(
    () => (isWeekly ? weeklyStreak(habit, history, today, zone) : 0),
    [isWeekly, habit, history, today, zone],
  )
  const range = useMemo(
    () => summarizeRange(habit, history, today, zone, 30, dayRows),
    [habit, history, today, zone, dayRows],
  )

  // An avoidance habit has meaningful history from the day it was created, even with
  // no records at all — silence *is* the success. Only 'do' habits need check-ins.
  if (history.length === 0 && !isAvoid) {
    return (
      <Section title="Consistency">
        <EmptyState title="No check-ins yet." compact />
      </Section>
    )
  }

  return (
    <Section title="Consistency">
      <div className="grid grid-cols-2 gap-2.5">
        {isWeekly ? (
          <>
            <Stat label="Weeks in a row" value={String(weekStreak)} accent={weekStreak > 0} />
            <Stat label="This week" value={`${weeks[weeks.length - 1]?.completed ?? 0} / ${habit.weekly_target ?? 0}`} />
          </>
        ) : avoid ? (
          <>
            <Stat
              label="Clean streak"
              value={avoid.current > 0 ? `🔥 ${avoid.current}` : '—'}
              accent={avoid.current > 0}
            />
            <Stat label="Longest" value={avoid.longest > 0 ? String(avoid.longest) : '—'} />
          </>
        ) : (
          <>
            <Stat
              label="Current streak"
              value={streak.current > 0 ? `🔥 ${streak.current}` : '—'}
              accent={streak.current > 0}
            />
            <Stat label="Longest streak" value={streak.longest > 0 ? String(streak.longest) : '—'} />
          </>
        )}
      </div>

      {/* Today is never folded into the number — it has not been won yet. */}
      {avoid?.stillGoingToday && (
        <p className="mt-2.5 px-1 text-[0.85rem] font-medium text-accent-ink">
          Still going today
        </p>
      )}

      {isWeekly && (
        <Card className="mt-2.5 px-4 py-3.5">
          <p className="mb-2.5 text-[0.8rem] font-semibold text-ink-faint">Recent weeks</p>
          <ul className="flex items-end justify-between gap-1.5">
            {weeks.map((week) => (
              <li key={week.weekStart} className="flex flex-1 flex-col items-center gap-1.5">
                <span
                  className={`w-full rounded-md py-1 text-center text-[0.75rem] font-semibold tabular-nums ${
                    week.met ? 'bg-accent text-bg' : 'bg-sunken text-ink-soft'
                  }`}
                >
                  {week.completed}
                </span>
                <span className="text-[0.65rem] text-ink-faint">
                  {week.isCurrent ? 'now' : `-${weeks.length - 1 - weeks.indexOf(week)}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-3 px-1 text-[0.82rem] text-ink-faint">
        Last 30 days · {range.completed} {isAvoid ? 'clean' : 'completed'}
        {range.scheduled > 0 && ` of ${range.scheduled} due`}
        {range.excused > 0 && ` · ${range.excused} excused`}
      </p>
    </Section>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[0.75rem] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? 'text-flame' : 'text-ink'}`}
      >
        {value}
      </p>
    </Card>
  )
}

/**
 * A month grid — deliberately a simple calendar rather than a chart.
 *
 * Five states, which is the most a calendar can carry before it stops being readable:
 * success, missed, excused, a lapse, and not-due. Keeping "not due" visually distinct
 * is what stops a Mon–Fri habit from looking like it fails every weekend, and keeping
 * "excused" distinct from "missed" is the whole point of grace.
 *
 * Colour is never the only signal — every cell carries a screen-reader label, and the
 * legend below names each state in words.
 */
function MonthCalendar({
  habit,
  history,
  dayRows,
  today,
  zone,
}: {
  habit: Habit
  history: Checkin[]
  dayRows: HabitDay[]
  today: LocalDate
  zone: string
}) {
  const grid = useMemo(() => monthGrid(today, zone), [today, zone])
  const lookup = useMemo(() => buildDayLookup(history, dayRows), [history, dayRows])
  const isAvoid = habit.kind === 'avoid'
  const isWeekly = habit.recurrence_type === 'weekly_target'

  return (
    <Section title={formatMonthYear(today, zone)}>
      <Card className="px-3 py-4">
        <div aria-hidden="true" className="mb-2 grid grid-cols-7 gap-1">
          {WEEKDAYS.map((day) => (
            <span key={day} className="text-center text-[0.68rem] font-semibold text-ink-faint">
              {WEEKDAY_INITIALS[day]}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.flat().map((date, i) => {
            if (!date) return <span key={`pad-${i}`} />
            const outcome = resolveDay(habit, date, today, zone, lookup)
            return (
              <DayCell
                key={date}
                date={date}
                outcome={outcome}
                isToday={date === today}
                isWeekly={isWeekly}
                completed={lookup.completed.has(date)}
              />
            )
          })}
        </div>
      </Card>

      <Legend isAvoid={isAvoid} />
    </Section>
  )
}

const CELL_STYLES: Record<DayOutcome, string> = {
  done: 'bg-accent font-semibold text-bg',
  clean: 'bg-accent font-semibold text-bg',
  missed: 'bg-sunken text-ink-soft',
  lapsed: 'bg-danger-soft font-semibold text-danger',
  excused: 'border border-dashed border-accent/50 text-accent-ink',
  pending: 'border border-line text-ink-soft',
  'still-going': 'border border-accent text-accent-ink',
  off: 'text-ink-faint/45',
}

const CELL_LABELS: Record<DayOutcome, string> = {
  done: 'done',
  clean: 'clean',
  missed: 'missed',
  lapsed: 'slip',
  excused: 'excused',
  pending: 'still to do',
  'still-going': 'still going',
  off: 'not scheduled',
}

function DayCell({
  date,
  outcome,
  isToday,
  isWeekly,
  completed,
}: {
  date: LocalDate
  outcome: DayOutcome
  isToday: boolean
  isWeekly: boolean
  completed: boolean
}) {
  // A weekly-target habit has no schedule, so an un-completed day is simply blank
  // rather than a judgement.
  const effective: DayOutcome = isWeekly ? (completed ? 'done' : 'off') : outcome

  return (
    <span
      className={`flex aspect-square items-center justify-center rounded-lg text-[0.72rem] tabular-nums ${
        CELL_STYLES[effective]
      } ${isToday ? 'ring-2 ring-accent/40' : ''}`}
    >
      <span className="sr-only">{`${date}: ${CELL_LABELS[effective]}`}</span>
      <span aria-hidden="true">{Number(date.slice(8, 10))}</span>
    </span>
  )
}

/** Names each calendar state in words, so colour is never the only cue. */
function Legend({ isAvoid }: { isAvoid: boolean }) {
  const items = [
    { className: 'bg-accent', label: isAvoid ? 'Clean day' : 'Done' },
    isAvoid
      ? { className: 'bg-danger-soft border border-danger/40', label: 'Slip' }
      : { className: 'bg-sunken', label: 'Missed' },
    { className: 'border border-dashed border-accent/50', label: 'Excused' },
  ]

  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[0.72rem] text-ink-faint">
          <span aria-hidden="true" className={`size-3 rounded ${item.className}`} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

function History({
  history,
  today,
  zone,
}: {
  history: Checkin[]
  today: LocalDate
  zone: string
}) {
  const recent = useMemo(() => recentCheckins(history, 10), [history])

  if (recent.length === 0) return null

  return (
    <Section title="Recent check-ins">
      <Card className="px-4">
        <ul>
          {recent.map((checkin) => (
            <li
              key={checkin.id}
              className="flex min-h-11 items-center justify-between gap-3 border-b border-line/70 py-2.5 text-[0.9rem] last:border-b-0"
            >
              <span>{formatRelativeDay(checkin.completion_date, today, zone)}</span>
              <span aria-hidden="true" className="text-accent">
                ✓
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  )
}

/**
 * Permanent deletion, behind a deliberate two-step confirmation that names exactly
 * what is about to be lost. Archiving is offered directly above it and is what most
 * people actually want.
 */
function DeleteHabit({
  habit,
  count,
  busy,
  onDelete,
}: {
  habit: Habit
  count: number
  busy: boolean
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <Button variant="quiet" full disabled={busy} onClick={() => setConfirming(true)}>
        Delete permanently
      </Button>
    )
  }

  return (
    <div className="rounded-2xl border border-danger/40 bg-danger-soft p-4">
      <p className="text-[0.9rem] font-medium text-danger">
        Delete &ldquo;{habit.name}&rdquo; and its {count}{' '}
        {count === 1 ? 'check-in' : 'check-ins'}? This cannot be undone.
      </p>
      <div className="mt-3 flex gap-2.5">
        <Button variant="danger" disabled={busy} onClick={() => void onDelete()}>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </div>
  )
}
