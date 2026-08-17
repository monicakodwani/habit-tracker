/**
 * The daily combined streak: consecutive local days on which a person handled
 * everything that actually mattered that day.
 *
 * This is a *different metric* from the per-habit streaks in `streaks.ts` and does not
 * replace them. "Read 🔥 12 days" is about one habit; "Daily streak 🔥 6 days" is about
 * whole days. Both are shown, and neither is derived from the other.
 *
 * DERIVED, NOT STORED
 * -------------------
 * Nothing here is persisted. Every number is recomputed from habits, check-ins and
 * day states, which means a correction to last Tuesday — a forgotten check-in added, an
 * excuse granted, a slip undone — is reflected immediately with no reconciliation step
 * and no possibility of a stored counter drifting out of line with the history.
 *
 * WHAT COUNTS
 * -----------
 * Only habits with a success/failure expectation tied to that specific local day:
 *
 *   - scheduled `do` habits, on days they are due
 *   - scheduled `avoid` habits, on days they are scheduled
 *
 * Weekly-target habits never count. They are not due on any particular date, so
 * "exercise 3× this week" being unfinished on Tuesday says nothing about Tuesday.
 *
 * Timezone handling is the owner's, throughout, via the existing date utilities.
 */
import type { Checkin, Habit, HabitDay, LocalDate } from '../types/models'
import { addDays, dateRange, todayIn } from './dates'
import { buildDayLookup, daysByHabit, habitStartDate, resolveDay } from './dayState'
import { checkinsByHabit } from './recurrence'
import type { DayLookup } from './dayState'

/**
 * How a whole day turned out.
 *
 * - `successful`  at least one habit applied, and every one was completed or excused
 * - `failed`      at least one applicable requirement definitively failed
 * - `neutral`     nothing applied — a rest day neither earns nor breaks anything
 * - `in_progress` the current local day, which is never finalised early
 */
export type DailyCombinedStatus = 'successful' | 'failed' | 'neutral' | 'in_progress'

export interface CombinedDay {
  date: LocalDate
  status: DailyCombinedStatus
  /** Habits that mattered on this day. */
  applicable: number
  /** Of those, how many were completed, clean, or excused. */
  handled: number
  /** Applicable habits that definitively failed — a miss or a slip. */
  failed: number
  /**
   * True when nothing is outstanding.
   *
   * On the current day this is what lets the UI say "Everything done today ✓" while
   * the streak itself still reports only completed days.
   */
  allHandled: boolean
}

/** How far back a streak is ever computed. Matches the app's own history window. */
export const MAX_STREAK_LOOKBACK_DAYS = 400

/**
 * Whether a habit has any bearing on a given local day.
 *
 * Weekly-target habits never do. An archived habit stops applying after it was
 * archived — see {@link archiveCutoff} for why `updated_at` is used and what that
 * costs. The lower bound (a habit cannot affect days before it existed) is enforced
 * inside `resolveDay`, which returns `off` for those.
 */
function appliesOn(habit: Habit, date: LocalDate, zone: string): boolean {
  if (habit.recurrence_type === 'weekly_target') return false
  if (habit.active) return true
  return date <= archiveCutoff(habit, zone)
}

/**
 * The last day an archived habit is treated as mattering.
 *
 * The schema records *that* a habit is archived, not *when*. `updated_at` is the only
 * available signal, and archiving is an update, so for a habit archived and then left
 * alone it is exactly right. If the habit was edited after being archived the window
 * stretches a little too far.
 *
 * The alternative readings are both worse. Ignoring archived habits entirely would
 * silently turn genuinely failed days in the past into successes. Counting them
 * forever would mean retiring a habit quietly broke every day since. This sits between
 * the two and errs toward not rewriting history.
 */
function archiveCutoff(habit: Habit, zone: string): LocalDate {
  return todayIn(zone, new Date(habit.updated_at))
}

/** Per-habit indexes, built once and reused across every day of the walk. */
type Lookups = Map<string, DayLookup>

function buildLookups(
  habits: readonly Habit[],
  checkins: readonly Checkin[],
  dayRows: readonly HabitDay[],
): Lookups {
  const byHabitCheckins = checkinsByHabit(checkins)
  const byHabitDays = daysByHabit(dayRows)
  const lookups: Lookups = new Map()

  for (const habit of habits) {
    lookups.set(
      habit.id,
      buildDayLookup(byHabitCheckins.get(habit.id) ?? [], byHabitDays.get(habit.id) ?? []),
    )
  }
  return lookups
}

const EMPTY_LOOKUP: DayLookup = { completed: new Set(), days: new Map() }

/**
 * Resolves one whole day for one person.
 *
 * `today` is the owner's current local date. It is what separates a pending habit
 * (today, still possible) from a missed one (in the past, definitively not done), and
 * it is why the current day is never reported as `successful`.
 */
export function getCombinedDayStatus(
  habits: readonly Habit[],
  date: LocalDate,
  today: LocalDate,
  zone: string,
  lookups: Lookups,
): CombinedDay {
  let applicable = 0
  let handled = 0
  let failed = 0
  let pending = 0

  for (const habit of habits) {
    if (!appliesOn(habit, date, zone)) continue

    const outcome = resolveDay(habit, date, today, zone, lookups.get(habit.id) ?? EMPTY_LOOKUP)

    switch (outcome) {
      case 'off':
        // Not scheduled, before the habit existed, or in the future.
        continue
      case 'done':
      case 'clean':
        applicable += 1
        handled += 1
        break
      case 'excused':
        // Grace counts as handled. It does not earn the *habit* a completion, but it
        // must not cost the person their day — that is the whole point of an excuse.
        applicable += 1
        handled += 1
        break
      case 'missed':
      case 'lapsed':
        applicable += 1
        failed += 1
        break
      case 'pending':
      case 'still-going':
        // Only ever reachable for the current day; `resolveDay` resolves past days
        // definitively.
        applicable += 1
        pending += 1
        break
    }
  }

  const allHandled = applicable > 0 && handled === applicable

  let status: DailyCombinedStatus
  if (applicable === 0) {
    status = 'neutral'
  } else if (failed > 0) {
    // A miss or a slip is definitive even today — nothing later can undo it.
    status = 'failed'
  } else if (date >= today) {
    /*
     * The current day is never finalised early, even with everything already done.
     *
     * An avoidance habit is only won once the day ends, and a completion can still be
     * undone before midnight. Waiting means the number only ever moves forward, which
     * is what makes it trustworthy. The UI shows "Everything done today ✓" from
     * `allHandled` instead of inflating the count.
     */
    status = 'in_progress'
  } else if (pending > 0) {
    status = 'in_progress'
  } else {
    status = 'successful'
  }

  return { date, status, applicable, handled, failed, allHandled }
}

/**
 * The earliest day worth examining: the oldest habit's local creation date, floored so
 * a long-lived account never walks an unbounded range.
 */
function earliestRelevantDate(
  habits: readonly Habit[],
  today: LocalDate,
  zone: string,
): LocalDate {
  const floor = addDays(today, -MAX_STREAK_LOOKBACK_DAYS, zone)
  let earliest: LocalDate | null = null

  for (const habit of habits) {
    if (habit.recurrence_type === 'weekly_target') continue
    const start = habitStartDate(habit, zone)
    if (earliest === null || start < earliest) earliest = start
  }

  if (earliest === null) return today
  return earliest < floor ? floor : earliest
}

export interface DailyStreakSummary {
  /**
   * Consecutive successful days ending yesterday.
   *
   * Today is excluded on purpose — see the `in_progress` branch above. Neutral days
   * are transparent: they neither add to the run nor break it.
   */
  current: number
  /** The best such run in the available history. */
  longest: number
  /** Today's status, reported separately so the UI can be honest about it. */
  today: CombinedDay
}

/**
 * Everything the UI needs, in one pass over the history.
 *
 * Current and longest are computed together because they walk the same days; doing
 * them separately would double the work for no benefit.
 */
export function summarizeDailyStreak(
  habits: readonly Habit[],
  checkins: readonly Checkin[],
  dayRows: readonly HabitDay[],
  today: LocalDate,
  zone: string,
): DailyStreakSummary {
  const relevant = habits.filter((h) => h.recurrence_type !== 'weekly_target')
  const lookups = buildLookups(relevant, checkins, dayRows)

  const todayStatus = getCombinedDayStatus(relevant, today, today, zone, lookups)

  if (relevant.length === 0) {
    return { current: 0, longest: 0, today: todayStatus }
  }

  const from = earliestRelevantDate(relevant, today, zone)
  const to = addDays(today, -1, zone)

  let longest = 0
  let run = 0
  // Days from `from` to yesterday, oldest first.
  const days = from > to ? [] : dateRange(from, to, zone)

  for (const date of days) {
    const day = getCombinedDayStatus(relevant, date, today, zone, lookups)
    if (day.status === 'successful') {
      run += 1
      if (run > longest) longest = run
    } else if (day.status === 'failed') {
      run = 0
    }
    // `neutral` is transparent: a weekend with nothing scheduled must not break a
    // weekday-only habit's run, and must not award credit either.
  }

  return { current: run, longest, today: todayStatus }
}

/** Just the current streak, for callers that need nothing else. */
export function calculateDailyCombinedStreak(
  habits: readonly Habit[],
  checkins: readonly Checkin[],
  dayRows: readonly HabitDay[],
  today: LocalDate,
  zone: string,
): number {
  return summarizeDailyStreak(habits, checkins, dayRows, today, zone).current
}

/** Just the longest streak. */
export function calculateLongestDailyCombinedStreak(
  habits: readonly Habit[],
  checkins: readonly Checkin[],
  dayRows: readonly HabitDay[],
  today: LocalDate,
  zone: string,
): number {
  return summarizeDailyStreak(habits, checkins, dayRows, today, zone).longest
}

/**
 * One short line describing where today stands.
 *
 * Warm, never punitive: a missed habit is already visible on the row itself, so this
 * has no business scolding anyone about it.
 */
export function describeToday(day: CombinedDay): string {
  switch (day.status) {
    case 'neutral':
      return 'No scheduled habits today'
    case 'failed':
      return 'Start fresh tomorrow'
    case 'in_progress':
      return day.allHandled ? 'Everything done today ✓' : 'On track today'
    case 'successful':
      // Not reachable for the current day, but harmless to answer sensibly.
      return 'Everything done today ✓'
  }
}
