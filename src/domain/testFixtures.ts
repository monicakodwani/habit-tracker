/**
 * Small builders used by the domain tests.
 *
 * Kept out of the `.test.ts` files so the assertions stay readable — a test should
 * show the schedule and the check-ins it cares about, not fifteen lines of
 * boilerplate object literals.
 */
import type {
  Checkin,
  Habit,
  HabitDay,
  HabitVisibility,
  LocalDate,
  Nudge,
  NudgePolicy,
  Profile,
  Weekday,
} from '../types/models'
import { asLocalDate } from './dates'

export const d = asLocalDate

let seq = 0
const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`

interface HabitOverrides {
  id?: string
  owner_id?: string
  name?: string
  emoji?: string
  active?: boolean
  visibility?: HabitVisibility
  created_at?: string
  nudge_policy?: NudgePolicy
  nudge_after_time?: string | null
}

/** A scheduled-days habit due on the given ISO weekdays (1 = Mon .. 7 = Sun). */
export function scheduledHabit(days: Weekday[], overrides: HabitOverrides = {}): Habit {
  return {
    id: overrides.id ?? nextId('habit'),
    owner_id: overrides.owner_id ?? 'user-1',
    group_id: 'group-1',
    name: overrides.name ?? 'Read',
    emoji: overrides.emoji ?? '📖',
    kind: 'do',
    recurrence_type: 'scheduled_days',
    scheduled_days: [...days].sort((a, b) => a - b),
    weekly_target: null,
    active: overrides.active ?? true,
    visibility: overrides.visibility ?? 'shared',
    nudge_policy: overrides.nudge_policy ?? 'anytime',
    nudge_after_time: overrides.nudge_after_time ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/**
 * An avoidance habit — success is a scheduled day ending with no lapse.
 *
 * `created_at` defaults early so tests can walk a long history; avoidance streaks are
 * bounded by the creation date, so a late default would silently truncate them.
 */
export function avoidHabit(days: Weekday[], overrides: HabitOverrides = {}): Habit {
  return {
    ...scheduledHabit(days, overrides),
    kind: 'avoid',
    name: overrides.name ?? 'No takeout',
    emoji: overrides.emoji ?? '🍟',
  }
}

/** A habit_days row. Pass only the flags the test cares about. */
export function habitDay(
  habit: Habit,
  date: string,
  flags: Partial<Pick<HabitDay, 'excused' | 'lapsed' | 'at_risk_at' | 'at_risk_note'>> = {},
): HabitDay {
  return {
    id: nextId('day'),
    habit_id: habit.id,
    user_id: habit.owner_id,
    day_date: d(date),
    excused: flags.excused ?? false,
    lapsed: flags.lapsed ?? false,
    at_risk_at: flags.at_risk_at ?? null,
    at_risk_note: flags.at_risk_note ?? null,
  }
}

/** Excused days for a habit. */
export function excusedOn(habit: Habit, dates: string[]): HabitDay[] {
  return dates.map((date) => habitDay(habit, date, { excused: true }))
}

/** Lapse days for an avoidance habit. */
export function lapsedOn(habit: Habit, dates: string[]): HabitDay[] {
  return dates.map((date) => habitDay(habit, date, { lapsed: true }))
}

export function nudge(habit: Habit, senderId: string, createdAt: string): Nudge {
  return {
    id: nextId('nudge'),
    group_id: habit.group_id,
    habit_id: habit.id,
    sender_id: senderId,
    recipient_id: habit.owner_id,
    day_date: d(createdAt.slice(0, 10)),
    preset: null,
    message: 'hi',
    created_at: createdAt,
  }
}

/** A habit due `target` times per Monday–Sunday week, on no particular days. */
export function weeklyHabit(target: number, overrides: HabitOverrides = {}): Habit {
  return {
    ...scheduledHabit([1], overrides),
    name: overrides.name ?? 'Exercise',
    emoji: overrides.emoji ?? '🏃',
    recurrence_type: 'weekly_target',
    scheduled_days: null,
    weekly_target: target,
  }
}

export const EVERY_DAY: Weekday[] = [1, 2, 3, 4, 5, 6, 7]
export const WEEKDAYS_ONLY: Weekday[] = [1, 2, 3, 4, 5]

/** Check-ins for a habit on the given dates. */
export function checkinsOn(habit: Habit, dates: string[]): Checkin[] {
  return dates.map((date) => ({
    id: nextId('checkin'),
    habit_id: habit.id,
    user_id: habit.owner_id,
    completion_date: d(date),
    created_at: `${date}T12:00:00Z`,
  }))
}

export function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    display_name: 'Monica',
    avatar_emoji: '🌻',
    timezone: 'America/New_York',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** A `Date` at noon UTC on the given day — unambiguous for US/EU timezone tests. */
export function noonUtc(date: string): Date {
  return new Date(`${date}T12:00:00Z`)
}

export type { LocalDate }
