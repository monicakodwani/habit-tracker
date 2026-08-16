/**
 * Small builders used by the domain tests.
 *
 * Kept out of the `.test.ts` files so the assertions stay readable — a test should
 * show the schedule and the check-ins it cares about, not fifteen lines of
 * boilerplate object literals.
 */
import type { Checkin, Habit, HabitVisibility, LocalDate, Profile, Weekday } from '../types/models'
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
}

/** A scheduled-days habit due on the given ISO weekdays (1 = Mon .. 7 = Sun). */
export function scheduledHabit(days: Weekday[], overrides: HabitOverrides = {}): Habit {
  return {
    id: overrides.id ?? nextId('habit'),
    owner_id: overrides.owner_id ?? 'user-1',
    group_id: 'group-1',
    name: overrides.name ?? 'Read',
    emoji: overrides.emoji ?? '📖',
    recurrence_type: 'scheduled_days',
    scheduled_days: [...days].sort((a, b) => a - b),
    weekly_target: null,
    active: overrides.active ?? true,
    visibility: overrides.visibility ?? 'shared',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
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
