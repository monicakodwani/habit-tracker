/**
 * Application-level types.
 *
 * These mirror the database tables in supabase/migrations. They are hand-written
 * rather than generated so the shape stays readable, and so `LocalDate` can be
 * distinguished from an arbitrary string at the type level.
 */

/**
 * ISO-8601 weekday. 1 = Monday ... 7 = Sunday.
 *
 * This convention is used consistently across the database (`habits.scheduled_days`),
 * the domain logic, and the UI. It matches Luxon's `DateTime.weekday` exactly, so no
 * conversion is ever needed.
 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7]

/** Single-letter weekday labels for the M T W T F S S picker, in ISO order. */
export const WEEKDAY_INITIALS: Readonly<Record<Weekday, string>> = {
  1: 'M',
  2: 'T',
  3: 'W',
  4: 'T',
  5: 'F',
  6: 'S',
  7: 'S',
}

export const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

/**
 * A calendar date in `YYYY-MM-DD` form, always meaning a *local* day in some
 * person's timezone — never a UTC instant.
 *
 * The branding is a compile-time marker only; at runtime this is a plain string.
 * It exists to stop a raw `new Date().toISOString()` from being passed where a
 * timezone-resolved local date is required, which is the single easiest way to
 * introduce an off-by-one-day bug in an app like this.
 */
export type LocalDate = string & { readonly __localDate: unique symbol }

export type RecurrenceType = 'scheduled_days' | 'weekly_target'
export type HabitVisibility = 'shared' | 'private'

export interface Profile {
  id: string
  display_name: string
  avatar_emoji: string
  /** IANA timezone name, e.g. `America/New_York`. */
  timezone: string
  created_at: string
  updated_at: string
}

export interface Group {
  id: string
  name: string
  created_at: string
}

export interface GroupMember {
  group_id: string
  user_id: string
  joined_at: string
}

export interface Habit {
  id: string
  owner_id: string
  group_id: string
  name: string
  emoji: string
  recurrence_type: RecurrenceType
  /** Populated only when `recurrence_type` is `scheduled_days`. Sorted ascending. */
  scheduled_days: Weekday[] | null
  /** Populated only when `recurrence_type` is `weekly_target`. 1–7. */
  weekly_target: number | null
  active: boolean
  visibility: HabitVisibility
  created_at: string
  updated_at: string
}

export interface Checkin {
  id: string
  habit_id: string
  user_id: string
  completion_date: LocalDate
  created_at: string
}

/** The fields a user actually chooses when creating or editing a habit. */
export interface HabitDraft {
  name: string
  emoji: string
  recurrence_type: RecurrenceType
  scheduled_days: Weekday[] | null
  weekly_target: number | null
  visibility: HabitVisibility
}
