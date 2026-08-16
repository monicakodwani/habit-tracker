/**
 * Recurrence rules: when a habit is due, and how it is progressing.
 *
 * All of this is pure — it takes habits, check-ins, a date and a timezone, and
 * returns plain data. Nothing here knows about React, Supabase, or the DOM, which
 * is what makes it testable and what keeps the screens thin.
 *
 * The timezone passed in is always the *habit owner's*, so a friend viewing the app
 * from another timezone sees the owner's day boundaries rather than their own.
 */
import type { Checkin, Habit, LocalDate, Weekday } from '../types/models'
import { WEEKDAY_NAMES, WEEKDAYS } from '../types/models'
import { endOfWeek, startOfWeek, weekdayOf } from './dates'

/** The set of dates a habit was completed on. Cheap membership tests for the UI. */
export function checkinDates(checkins: readonly Checkin[]): Set<LocalDate> {
  return new Set(checkins.map((c) => c.completion_date))
}

/** Groups check-ins by habit id, so a screen can load one batch and fan it out. */
export function checkinsByHabit(checkins: readonly Checkin[]): Map<string, Checkin[]> {
  const byHabit = new Map<string, Checkin[]>()
  for (const checkin of checkins) {
    const existing = byHabit.get(checkin.habit_id)
    if (existing) existing.push(checkin)
    else byHabit.set(checkin.habit_id, [checkin])
  }
  return byHabit
}

/**
 * Whether a scheduled-days habit falls on this weekday.
 *
 * Always false for weekly-target habits: they are deliberately not tied to
 * particular days, so asking "is it scheduled today" has no meaningful answer.
 * Ignores `active` — this is the schedule question alone. Use {@link appearsOn}
 * to decide what to render.
 */
export function isScheduledOn(habit: Habit, date: LocalDate, zone: string): boolean {
  if (habit.recurrence_type !== 'scheduled_days') return false
  return habit.scheduled_days?.includes(weekdayOf(date, zone)) ?? false
}

/**
 * Whether a habit belongs on the Today screen for the given date.
 *
 * Archived habits never appear. Scheduled habits appear on their scheduled days.
 * Weekly-target habits appear every day of the week — including after the target
 * has been met, where they show as done rather than vanishing.
 */
export function appearsOn(habit: Habit, date: LocalDate, zone: string): boolean {
  if (!habit.active) return false
  if (habit.recurrence_type === 'weekly_target') return true
  return isScheduledOn(habit, date, zone)
}

export interface WeeklyProgress {
  /** Completions inside the Monday–Sunday week containing the reference date. */
  completed: number
  /** The habit's `weekly_target`. */
  target: number
  /** How many more are needed. Never negative. */
  remaining: number
  /** True once `completed >= target`. */
  met: boolean
}

/**
 * Progress toward a weekly-target habit's goal, for the week containing `date`.
 *
 * Completions on any day of that week count; the habit is not tied to specific days.
 * Check-ins outside the week are ignored, which is what makes the counter reset
 * cleanly at the Monday boundary.
 */
export function weeklyProgress(
  habit: Habit,
  checkins: readonly Checkin[],
  date: LocalDate,
  zone: string,
): WeeklyProgress {
  const target = habit.weekly_target ?? 0
  const from = startOfWeek(date, zone)
  const to = endOfWeek(date, zone)

  const completed = checkins.filter(
    (c) => c.completion_date >= from && c.completion_date <= to,
  ).length

  return {
    completed,
    target,
    remaining: Math.max(0, target - completed),
    met: target > 0 && completed >= target,
  }
}

/**
 * Whether a habit counts as "done" for the given day.
 *
 * For scheduled habits this is simply whether it was checked off that day. For
 * weekly-target habits it is *also* per-day — the tappable control on Today marks
 * today specifically — while the week's total is reported separately by
 * {@link weeklyProgress}.
 */
export function isCompletedOn(checkins: readonly Checkin[], date: LocalDate): boolean {
  return checkins.some((c) => c.completion_date === date)
}

// --- Human-readable descriptions --------------------------------------------

const EVERY_DAY: readonly Weekday[] = WEEKDAYS
const WEEKDAYS_ONLY: readonly Weekday[] = [1, 2, 3, 4, 5]
const WEEKEND_ONLY: readonly Weekday[] = [6, 7]

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i])
}

/** True when the days are consecutive in ISO order, e.g. [2,3,4]. */
function isConsecutive(days: readonly Weekday[]): boolean {
  return days.length > 2 && days.every((d, i) => i === 0 || d === (days[i - 1] as number) + 1)
}

/**
 * A short, friendly description of a habit's recurrence.
 *
 * "Every day", "Weekdays", "Weekends", "Mon–Thu", "Tue & Sat", "3× per week".
 */
export function describeRecurrence(habit: Habit): string {
  if (habit.recurrence_type === 'weekly_target') {
    const target = habit.weekly_target ?? 0
    return target === 1 ? 'Once per week' : `${target}× per week`
  }

  const days = habit.scheduled_days ?? []
  if (days.length === 0) return 'No days selected'
  if (sameDays(days, EVERY_DAY)) return 'Every day'
  if (sameDays(days, WEEKDAYS_ONLY)) return 'Weekdays'
  if (sameDays(days, WEEKEND_ONLY)) return 'Weekends'

  const short = days.map((d) => WEEKDAY_NAMES[d].slice(0, 3))
  if (isConsecutive(days)) return `${short[0]}–${short[short.length - 1]}`
  if (short.length === 1) return `${WEEKDAY_NAMES[days[0] as Weekday]}s`
  if (short.length === 2) return `${short[0]} & ${short[1]}`
  return short.join(', ')
}

/** "2 of 4 completed today" — the Today screen's progress line. */
export function describeDailyProgress(completed: number, total: number): string {
  if (total === 0) return 'Nothing due today'
  if (completed === total) return `All ${total} done today`
  return `${completed} of ${total} completed today`
}
