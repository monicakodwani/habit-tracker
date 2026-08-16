/**
 * What a single habit-day actually *means*.
 *
 * Phase 1 had two states — done or not. There are now six, and the differences
 * matter: a missed day breaks a streak, an excused day does not, and an avoidance
 * day that has not ended yet is neither a success nor a failure.
 *
 * Everything here is pure and takes an explicit timezone, which is always the
 * **habit owner's**. A friend in London looking at a habit in New York sees New
 * York's day boundaries.
 */
import type { Checkin, Habit, HabitDay, LocalDate } from '../types/models'
import { todayIn, weekdayOf } from './dates'
import { isScheduledOn, weeklyProgress } from './recurrence'

/**
 * The state of one habit on one local day.
 *
 * - `done`        a `do` habit was completed
 * - `clean`       an `avoid` habit's scheduled day ended with no lapse — a success
 * - `still-going` an `avoid` habit's scheduled day is *today* and no lapse yet.
 *                 Deliberately NOT a success: the day is not over.
 * - `lapsed`      an `avoid` habit slipped
 * - `excused`     grace. Not a success, but does not break anything either
 * - `pending`     a `do` habit is due today and not done yet
 * - `missed`      a `do` habit was due on a past day and never done
 * - `off`         not scheduled, before the habit existed, or still in the future
 */
export type DayOutcome =
  | 'done'
  | 'clean'
  | 'still-going'
  | 'lapsed'
  | 'excused'
  | 'pending'
  | 'missed'
  | 'off'

/** Indexes a habit's check-ins and day rows for repeated lookups. */
export interface DayLookup {
  completed: Set<LocalDate>
  days: Map<LocalDate, HabitDay>
}

export function buildDayLookup(
  checkins: readonly Checkin[],
  days: readonly HabitDay[],
): DayLookup {
  return {
    completed: new Set(checkins.map((c) => c.completion_date)),
    days: new Map(days.map((d) => [d.day_date, d])),
  }
}

export function daysByHabit(days: readonly HabitDay[]): Map<string, HabitDay[]> {
  const byHabit = new Map<string, HabitDay[]>()
  for (const day of days) {
    const existing = byHabit.get(day.habit_id)
    if (existing) existing.push(day)
    else byHabit.set(day.habit_id, [day])
  }
  return byHabit
}

/**
 * The local date a habit was created, in the owner's timezone.
 *
 * Matters for avoidance habits: their success is the *absence* of a lapse, so
 * without a lower bound a habit created yesterday would appear to have a streak
 * stretching back to the beginning of time.
 *
 * Uses the same Luxon-backed conversion as everything else rather than slicing the
 * ISO string, which would silently give the UTC day.
 */
export function habitStartDate(habit: Habit, zone: string): LocalDate {
  return todayIn(zone, new Date(habit.created_at))
}

/**
 * Resolves one habit-day.
 *
 * `today` is the owner's current local date, which is what separates "pending" from
 * "missed" and "still-going" from "clean".
 */
export function resolveDay(
  habit: Habit,
  date: LocalDate,
  today: LocalDate,
  zone: string,
  lookup: DayLookup,
): DayOutcome {
  // Weekly-target habits have no per-day schedule; only completion is meaningful.
  if (habit.recurrence_type === 'weekly_target') {
    return lookup.completed.has(date) ? 'done' : 'off'
  }

  if (!isScheduledOn(habit, date, zone)) return 'off'
  if (date > today) return 'off' // the future is unknowable

  const day = lookup.days.get(date)
  const startedAt = habitStartDate(habit, zone)

  /*
   * Recorded evidence always wins over the creation-date bound.
   *
   * A check-in, a lapse or an excuse on a given day is proof the habit existed then,
   * whatever `created_at` says — and `created_at` genuinely can disagree, if a habit
   * was edited, recreated, or backfilled. The bound only decides what an *absence* of
   * records means, which is the case where it matters: for an avoidance habit,
   * silence before the habit existed must not be counted as success.
   */
  if (habit.kind === 'avoid') {
    if (day?.lapsed) return 'lapsed'
    if (day?.excused) return 'excused'
    if (date < startedAt) return 'off'
    // The key rule: today is not a success yet, because it has not finished.
    return date === today ? 'still-going' : 'clean'
  }

  if (lookup.completed.has(date)) return 'done'
  if (day?.excused) return 'excused'
  if (date < startedAt) return 'off'
  return date === today ? 'pending' : 'missed'
}

/** Whether an outcome counts as a success for consistency purposes. */
export function isSuccess(outcome: DayOutcome): boolean {
  return outcome === 'done' || outcome === 'clean'
}

/** Whether an outcome is neutral — it neither helps nor hurts a streak. */
export function isNeutral(outcome: DayOutcome): boolean {
  return outcome === 'excused' || outcome === 'off' || outcome === 'still-going'
}

/**
 * Whether a habit is currently asking for help.
 *
 * The database clears the flag when the habit is completed or excused, but a
 * weekly-target habit reaching its target is only knowable here, so that case is
 * resolved client-side too. An at-risk marker also only means anything on the day it
 * was set — it expires with the owner's local day rather than lingering.
 */
export function isAtRiskNow(
  habit: Habit,
  today: LocalDate,
  lookup: DayLookup,
  checkins: readonly Checkin[],
  zone: string,
): boolean {
  const day = lookup.days.get(today)
  if (!day?.at_risk_at) return false
  if (habit.visibility !== 'shared' || !habit.active) return false

  if (habit.recurrence_type === 'weekly_target') {
    return !weeklyProgress(habit, checkins, today, zone).met
  }

  const outcome = resolveDay(habit, today, today, zone, lookup)
  return outcome === 'pending' || outcome === 'still-going'
}

/** The note the owner left when asking for a push, if any. */
export function atRiskNote(today: LocalDate, lookup: DayLookup): string | null {
  return lookup.days.get(today)?.at_risk_note ?? null
}

/**
 * Every scheduled occurrence of a habit between two dates, oldest first.
 *
 * Weekday is advanced arithmetically rather than re-derived per date — the dates are
 * whole calendar days apart, so the ISO weekday simply cycles 1..7. This keeps long
 * walks cheap without hand-rolling any timezone maths.
 */
export function scheduledDatesBetween(
  habit: Habit,
  from: LocalDate,
  to: LocalDate,
  zone: string,
  addDaysFn: (d: LocalDate, n: number, z: string) => LocalDate,
): LocalDate[] {
  if (habit.recurrence_type !== 'scheduled_days') return []
  const scheduled = new Set(habit.scheduled_days ?? [])
  if (scheduled.size === 0 || from > to) return []

  const dates: LocalDate[] = []
  let cursor = from
  let weekday = weekdayOf(from, zone)
  let guard = 0

  while (cursor <= to && guard < 1000) {
    if (scheduled.has(weekday)) dates.push(cursor)
    cursor = addDaysFn(cursor, 1, zone)
    weekday = ((weekday % 7) + 1) as typeof weekday
    guard += 1
  }

  return dates
}
