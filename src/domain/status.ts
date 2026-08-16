/**
 * View models for the Today and Week screens.
 *
 * This is the layer that turns "a pile of habits, check-ins and day states" into the
 * exact rows a screen renders. Keeping it here rather than inside components means
 * the interesting logic is testable and the components stay close to markup.
 *
 * Note that each person's status is computed in **their own** timezone. When Monica
 * in New York looks at Ura in London, she sees Ura's day, not hers.
 */
import type { Checkin, Habit, HabitDay, LocalDate, Profile } from '../types/models'
import { todayIn } from './dates'
import { appearsOn, checkinsByHabit, isCompletedOn, weeklyProgress } from './recurrence'
import type { WeeklyProgress } from './recurrence'
import { avoidStreak, scheduledStreak } from './streaks'
import type { AvoidStreak, StreakInfo } from './streaks'
import { atRiskNote, buildDayLookup, daysByHabit, isAtRiskNow, resolveDay } from './dayState'
import type { DayOutcome, DayLookup } from './dayState'

/** One habit row, with everything a card needs to render it. */
export interface HabitStatus {
  habit: Habit
  /** What today is, for this habit. */
  outcome: DayOutcome
  /** Whether it is checked off for the reference day. */
  completedToday: boolean
  /** Present only for `do` scheduled-days habits. */
  streak: StreakInfo | null
  /** Present only for `avoid` habits. */
  avoid: AvoidStreak | null
  /** Present only for weekly-target habits. */
  weekly: WeeklyProgress | null
  /** The owner has asked for a push on this, today. */
  atRisk: boolean
  /** Optional note the owner attached when asking for help. */
  atRiskNote: string | null
  /** Today is formally excused. */
  excused: boolean
  /** Indexed check-ins and day rows, so callers can reuse them without rebuilding. */
  lookup: DayLookup
  /** This habit's check-ins, as loaded. */
  checkins: readonly Checkin[]
}

/** A person's Today section: who they are, what is on their list, how far along. */
export interface PersonToday {
  profile: Profile
  /** Today in *this person's* timezone. */
  date: LocalDate
  items: HabitStatus[]
  completedCount: number
  totalCount: number
  /** How many of their habits are currently asking for a push. */
  atRiskCount: number
}

function statusFor(
  habit: Habit,
  checkins: readonly Checkin[],
  days: readonly HabitDay[],
  date: LocalDate,
  zone: string,
): HabitStatus {
  const isWeekly = habit.recurrence_type === 'weekly_target'
  const isAvoid = habit.kind === 'avoid'
  const lookup = buildDayLookup(checkins, days)

  return {
    habit,
    outcome: resolveDay(habit, date, date, zone, lookup),
    completedToday: isCompletedOn(checkins, date),
    streak: isWeekly || isAvoid ? null : scheduledStreak(habit, checkins, date, zone, days),
    avoid: isAvoid ? avoidStreak(habit, days, date, zone) : null,
    weekly: isWeekly ? weeklyProgress(habit, checkins, date, zone) : null,
    atRisk: isAtRiskNow(habit, date, lookup, checkins, zone),
    atRiskNote: atRiskNote(date, lookup),
    excused: lookup.days.get(date)?.excused ?? false,
    lookup,
    checkins,
  }
}

/**
 * Orders habits for display.
 *
 * Deliberately *not* sorted by completion state. Re-sorting when a habit is checked
 * off would make rows jump out from under the user's finger mid-tap. A stable order
 * — oldest habit first, ties broken by name — is calmer and easier to build muscle
 * memory against.
 */
function displayOrder(a: Habit, b: Habit): number {
  return a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name)
}

/**
 * Builds one person's Today view.
 *
 * `habits` may contain anything the caller has; archived habits and habits not due
 * today are filtered out here. Only habits owned by `profile` are considered.
 *
 * A weekly-target habit whose target is already met still counts toward the day's
 * progress line as done, so "3 of 4 completed today" never sits stuck at a number
 * the user cannot move.
 */
export function buildPersonToday(
  profile: Profile,
  habits: readonly Habit[],
  checkins: readonly Checkin[],
  zone: string,
  now?: Date,
  days: readonly HabitDay[] = [],
): PersonToday {
  const date = todayIn(zone, now)
  const byHabit = checkinsByHabit(checkins)
  const dayRows = daysByHabit(days)

  const items = habits
    .filter((h) => h.owner_id === profile.id && appearsOn(h, date, zone))
    .sort(displayOrder)
    .map((h) => statusFor(h, byHabit.get(h.id) ?? [], dayRows.get(h.id) ?? [], date, zone))

  return {
    profile,
    date,
    items,
    completedCount: items.filter(isDone).length,
    totalCount: items.length,
    atRiskCount: items.filter((i) => i.atRisk).length,
  }
}

/**
 * Whether a row should read as "settled" on Today — nothing left to do about it.
 *
 * For a scheduled habit that is today's check-in. For a weekly-target habit, hitting
 * the week's target also counts, otherwise a habit finished for the week would sit
 * unchecked every remaining day, which reads as nagging. An excused day is settled
 * too — that is the point of grace. An avoidance day is NOT settled while it is still
 * going, because it has not been won yet.
 */
export function isDone(status: HabitStatus): boolean {
  if (status.excused) return true
  if (status.weekly?.met === true) return true
  return status.completedToday
}

/**
 * Builds the friends' section of Today, each in that friend's own timezone.
 *
 * The `visibility === 'shared'` filter here is defence in depth, not the privacy
 * mechanism. Row Level Security is what actually guarantees another person's private
 * habits never reach this browser — see the `habits_select_own_or_shared_in_group`
 * policy. This filter simply means that if a future query is widened by mistake, the
 * UI still does not render something it should not.
 */
export function buildFriendsToday(
  friends: readonly Profile[],
  habits: readonly Habit[],
  checkins: readonly Checkin[],
  now?: Date,
  days: readonly HabitDay[] = [],
): PersonToday[] {
  const shared = habits.filter((h) => h.visibility === 'shared')
  return friends
    .map((friend) => buildPersonToday(friend, shared, checkins, friend.timezone, now, days))
    .sort((a, b) => a.profile.display_name.localeCompare(b.profile.display_name))
}

/**
 * Orders a friend's rows so anything asking for help floats to the top.
 *
 * This is the one place ordering is not stable, and it is justified: a friend's rows
 * carry no tap targets that could shift under a finger, and "needs a push" is the
 * only thing on that card worth acting on.
 */
export function prioritizeForFriendCard(items: readonly HabitStatus[]): HabitStatus[] {
  return [...items].sort((a, b) => Number(b.atRisk) - Number(a.atRisk))
}

// --- Week screen ------------------------------------------------------------

/** One habit's row on the Week screen. */
export interface WeekRow {
  habit: Habit
  /** Seven cells, Monday first. */
  days: WeekDayCell[]
  /** Present only for weekly-target habits. */
  weekly: WeeklyProgress | null
}

export interface WeekDayCell {
  date: LocalDate
  /** Whether the habit was due this day. Always false for weekly-target habits. */
  scheduled: boolean
  completed: boolean
  outcome: DayOutcome
  isToday: boolean
  /** Days after today, which cannot be judged yet. */
  isFuture: boolean
}

/**
 * Builds the current user's week grid.
 *
 * Includes every active habit — even a scheduled habit with no occurrences this week
 * would be odd to hide, but in practice all recurrences touch at least one day.
 */
export function buildWeekRows(
  ownerId: string,
  habits: readonly Habit[],
  checkins: readonly Checkin[],
  dates: readonly LocalDate[],
  today: LocalDate,
  zone: string,
  days: readonly HabitDay[] = [],
): WeekRow[] {
  const byHabit = checkinsByHabit(checkins)
  const dayRows = daysByHabit(days)

  return habits
    .filter((h) => h.owner_id === ownerId && h.active)
    .sort(displayOrder)
    .map((habit) => {
      const habitCheckins = byHabit.get(habit.id) ?? []
      const lookup = buildDayLookup(habitCheckins, dayRows.get(habit.id) ?? [])
      const done = new Set(habitCheckins.map((c) => c.completion_date))

      return {
        habit,
        days: dates.map((date) => ({
          date,
          scheduled:
            habit.recurrence_type === 'scheduled_days' && appearsOn(habit, date, zone),
          completed: done.has(date),
          outcome: resolveDay(habit, date, today, zone, lookup),
          isToday: date === today,
          isFuture: date > today,
        })),
        weekly:
          habit.recurrence_type === 'weekly_target'
            ? weeklyProgress(habit, habitCheckins, today, zone)
            : null,
      }
    })
}
