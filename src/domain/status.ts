/**
 * View models for the Today and Week screens.
 *
 * This is the layer that turns "a pile of habits and a pile of check-ins" into the
 * exact rows a screen renders. Keeping it here rather than inside components means
 * the interesting logic is testable and the components stay close to markup.
 *
 * Note that each person's status is computed in **their own** timezone. When Monica
 * in New York looks at Ura in London, she sees Ura's day, not hers.
 */
import type { Checkin, Habit, LocalDate, Profile } from '../types/models'
import { todayIn } from './dates'
import { appearsOn, checkinsByHabit, isCompletedOn, weeklyProgress } from './recurrence'
import type { WeeklyProgress } from './recurrence'
import { scheduledStreak } from './streaks'
import type { StreakInfo } from './streaks'

/** One habit row, with everything a card needs to render it. */
export interface HabitStatus {
  habit: Habit
  /** Whether it is checked off for the reference day. */
  completedToday: boolean
  /** Present only for scheduled-days habits. */
  streak: StreakInfo | null
  /** Present only for weekly-target habits. */
  weekly: WeeklyProgress | null
}

/** A person's Today section: who they are, what is on their list, how far along. */
export interface PersonToday {
  profile: Profile
  /** Today in *this person's* timezone. */
  date: LocalDate
  items: HabitStatus[]
  completedCount: number
  totalCount: number
}

function statusFor(
  habit: Habit,
  checkins: readonly Checkin[],
  date: LocalDate,
  zone: string,
): HabitStatus {
  const isWeekly = habit.recurrence_type === 'weekly_target'
  return {
    habit,
    completedToday: isCompletedOn(checkins, date),
    streak: isWeekly ? null : scheduledStreak(habit, checkins, date, zone),
    weekly: isWeekly ? weeklyProgress(habit, checkins, date, zone) : null,
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
): PersonToday {
  const date = todayIn(zone, now)
  const byHabit = checkinsByHabit(checkins)

  const items = habits
    .filter((h) => h.owner_id === profile.id && appearsOn(h, date, zone))
    .sort(displayOrder)
    .map((h) => statusFor(h, byHabit.get(h.id) ?? [], date, zone))

  return {
    profile,
    date,
    items,
    completedCount: items.filter(isDone).length,
    totalCount: items.length,
  }
}

/**
 * Whether a row should read as "done" on Today.
 *
 * For a scheduled habit that is simply today's check-in. For a weekly-target habit,
 * hitting the week's target also counts — otherwise a habit that is finished for the
 * week would sit unchecked every remaining day, which reads as nagging.
 */
export function isDone(status: HabitStatus): boolean {
  return status.completedToday || status.weekly?.met === true
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
): PersonToday[] {
  const shared = habits.filter((h) => h.visibility === 'shared')
  return friends
    .map((friend) => buildPersonToday(friend, shared, checkins, friend.timezone, now))
    .sort((a, b) => a.profile.display_name.localeCompare(b.profile.display_name))
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
): WeekRow[] {
  const byHabit = checkinsByHabit(checkins)

  return habits
    .filter((h) => h.owner_id === ownerId && h.active)
    .sort(displayOrder)
    .map((habit) => {
      const habitCheckins = byHabit.get(habit.id) ?? []
      const done = new Set(habitCheckins.map((c) => c.completion_date))

      return {
        habit,
        days: dates.map((date) => ({
          date,
          scheduled:
            habit.recurrence_type === 'scheduled_days' &&
            appearsOn(habit, date, zone),
          completed: done.has(date),
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
