/**
 * Streak and consistency calculations.
 *
 * The rule that matters: a streak counts **consecutive scheduled occurrences**, not
 * consecutive calendar days. A Monday–Friday habit does not lose its streak over the
 * weekend, because Saturday and Sunday were never due.
 *
 * A second rule matters almost as much: a scheduled day that is *today and not yet
 * done* is pending, not missed. The day is not over, so it neither extends nor breaks
 * the streak. Without this, every streak in the app would read zero each morning.
 *
 * Weekly-target habits are deliberately not forced into a daily streak model — they
 * report per-week consistency instead. See {@link recentWeeks} and {@link weeklyStreak}.
 */
import type { Checkin, Habit, LocalDate, Weekday } from '../types/models'
import { addDays, dateRange, daysBetween, startOfWeek, weekdayOf } from './dates'
import { weeklyProgress } from './recurrence'

export interface StreakInfo {
  /** Consecutive scheduled occurrences completed, ending at the most recent one. */
  current: number
  /** The best such run ever achieved. */
  longest: number
}

const NO_STREAK: StreakInfo = { current: 0, longest: 0 }

/** The earliest completion date, or null when there are none. */
function earliestCheckin(checkins: readonly Checkin[]): LocalDate | null {
  let earliest: LocalDate | null = null
  for (const c of checkins) {
    if (earliest === null || c.completion_date < earliest) earliest = c.completion_date
  }
  return earliest
}

/**
 * Current and longest streak for a scheduled-days habit.
 *
 * Returns zeroes for weekly-target habits, which have no meaningful daily streak.
 *
 * Walks every scheduled occurrence from the first ever completion up to `today`,
 * counting completed ones and resetting on a genuine miss. Starting from the first
 * completion rather than the habit's creation date keeps the walk short and cannot
 * change the answer: occurrences before it are all misses, so no run can span them.
 */
export function scheduledStreak(
  habit: Habit,
  checkins: readonly Checkin[],
  today: LocalDate,
  zone: string,
): StreakInfo {
  if (habit.recurrence_type !== 'scheduled_days') return NO_STREAK

  const scheduled = habit.scheduled_days ?? []
  if (scheduled.length === 0) return NO_STREAK

  const start = earliestCheckin(checkins)
  if (start === null || start > today) return NO_STREAK

  const completed = new Set(checkins.map((c) => c.completion_date))
  const isScheduled = new Set<Weekday>(scheduled)

  // Weekday is advanced arithmetically rather than re-derived per date: `dateRange`
  // already walks whole calendar days, so the weekday simply cycles 1..7.
  let weekday = weekdayOf(start, zone)
  let run = 0
  let longest = 0

  for (const date of dateRange(start, today, zone)) {
    if (isScheduled.has(weekday)) {
      if (completed.has(date)) {
        run += 1
        if (run > longest) longest = run
      } else if (date !== today) {
        // A missed occurrence in the past breaks the run. Today, still pending, does not.
        run = 0
      }
    }
    weekday = ((weekday % 7) + 1) as Weekday
  }

  return { current: run, longest }
}

export interface WeekSummary {
  /** Monday of this week. */
  weekStart: LocalDate
  completed: number
  target: number
  met: boolean
  /** True for the week containing the reference date — its count may still grow. */
  isCurrent: boolean
}

/**
 * Per-week completion counts for a weekly-target habit, oldest week first.
 *
 * This is what the habit detail screen shows instead of a streak: "3 / 3", "2 / 3",
 * week by week, which reads as consistency without pretending to be a daily streak.
 */
export function recentWeeks(
  habit: Habit,
  checkins: readonly Checkin[],
  today: LocalDate,
  zone: string,
  count = 6,
): WeekSummary[] {
  const currentWeekStart = startOfWeek(today, zone)

  return Array.from({ length: count }, (_, i) => {
    const weekStart = addDays(currentWeekStart, -7 * (count - 1 - i), zone)
    const progress = weeklyProgress(habit, checkins, weekStart, zone)
    return {
      weekStart,
      completed: progress.completed,
      target: progress.target,
      met: progress.met,
      isCurrent: weekStart === currentWeekStart,
    }
  })
}

/**
 * Consecutive completed weeks for a weekly-target habit, ending at the most recently
 * finished week.
 *
 * The in-progress week counts only once its target is already met — otherwise a
 * Monday morning would appear to wipe out weeks of consistency, which is exactly the
 * kind of discouraging behaviour this app is trying not to have.
 */
export function weeklyStreak(
  habit: Habit,
  checkins: readonly Checkin[],
  today: LocalDate,
  zone: string,
): number {
  if (habit.recurrence_type !== 'weekly_target') return 0

  const start = earliestCheckin(checkins)
  if (start === null) return 0

  let streak = 0
  let weekStart = startOfWeek(today, zone)
  const firstWeek = startOfWeek(start, zone)

  // The current week is skipped (not reset) when its target is not yet met.
  if (!weeklyProgress(habit, checkins, weekStart, zone).met) {
    weekStart = addDays(weekStart, -7, zone)
  }

  while (weekStart >= firstWeek) {
    if (!weeklyProgress(habit, checkins, weekStart, zone).met) break
    streak += 1
    weekStart = addDays(weekStart, -7, zone)
  }

  return streak
}

/** How many of a habit's scheduled occurrences fell in the window, and how many were done. */
export interface RangeSummary {
  completed: number
  /** Scheduled occurrences in the window. Zero for weekly-target habits. */
  scheduled: number
  days: number
}

/**
 * Completion summary over the last `days` days ending at `today` — the
 * "Last 30 days: 26 completed" line on the habit detail screen.
 */
export function summarizeRange(
  habit: Habit,
  checkins: readonly Checkin[],
  today: LocalDate,
  zone: string,
  days = 30,
): RangeSummary {
  const from = addDays(today, -(days - 1), zone)
  const completed = checkins.filter(
    (c) => c.completion_date >= from && c.completion_date <= today,
  ).length

  if (habit.recurrence_type !== 'scheduled_days') {
    return { completed, scheduled: 0, days }
  }

  const isScheduled = new Set<Weekday>(habit.scheduled_days ?? [])
  let weekday = weekdayOf(from, zone)
  let scheduled = 0
  for (let i = 0; i < days; i++) {
    if (isScheduled.has(weekday)) scheduled += 1
    weekday = ((weekday % 7) + 1) as Weekday
  }

  return { completed, scheduled, days }
}

/** The most recent completions, newest first. Drives the history list. */
export function recentCheckins(checkins: readonly Checkin[], limit = 14): Checkin[] {
  return [...checkins]
    .sort((a, b) => b.completion_date.localeCompare(a.completion_date))
    .slice(0, limit)
}

/**
 * How many days ago the habit was last completed, or null if never.
 * Negative values are impossible in practice but are clamped for safety.
 */
export function daysSinceLastCheckin(
  checkins: readonly Checkin[],
  today: LocalDate,
  zone: string,
): number | null {
  let latest: LocalDate | null = null
  for (const c of checkins) {
    if (latest === null || c.completion_date > latest) latest = c.completion_date
  }
  if (latest === null) return null
  return Math.max(0, daysBetween(latest, today, zone))
}
