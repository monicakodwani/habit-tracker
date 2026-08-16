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

/**
 * What counts as success.
 *
 * Kept separate from recurrence on purpose: "how often" and "what winning means" are
 * different questions. An avoidance habit succeeds by a scheduled day *ending*
 * without a lapse, so it is never something you tick off.
 */
export type HabitKind = 'do' | 'avoid'

/** Who may nudge this habit, and when. Enforced in SQL — the client only mirrors it. */
export type NudgePolicy = 'anytime' | 'after_time' | 'at_risk_only' | 'never'

export type ActivityType = 'habit_completed' | 'at_risk' | 'nudge'

/** The six reactions. Fixed set — no custom emoji picker. */
export const REACTION_EMOJI = ['❤️', '🎉', '👏', '🫡', '😂', '🔥'] as const
export type ReactionEmoji = (typeof REACTION_EMOJI)[number]

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
  /** `avoid` habits are always `scheduled_days`; the database enforces it. */
  kind: HabitKind
  nudge_policy: NudgePolicy
  /** Local wall-clock `HH:MM:SS` in the OWNER's timezone. Only for `after_time`. */
  nudge_after_time: string | null
  created_at: string
  updated_at: string
}

/**
 * Everything about a habit on one local day that is *not* a completion:
 * grace, avoidance lapses, and "please bother me".
 *
 * Completions stay in {@link Checkin} — that table predates this one and moving it
 * would have been a destructive rewrite of live data.
 */
export interface HabitDay {
  id: string
  habit_id: string
  user_id: string
  day_date: LocalDate
  /** Grace: doesn't count as done, doesn't break the streak. */
  excused: boolean
  /** Avoidance only: the thing happened. */
  lapsed: boolean
  /** When the owner asked for a push. Null means not at risk. */
  at_risk_at: string | null
  at_risk_note: string | null
}

export interface Nudge {
  id: string
  group_id: string
  habit_id: string
  sender_id: string
  recipient_id: string
  day_date: LocalDate
  preset: string | null
  message: string
  created_at: string
}

export interface ActivityEvent {
  id: string
  group_id: string
  actor_id: string
  target_user_id: string | null
  habit_id: string | null
  type: ActivityType
  day_date: LocalDate
  /**
   * Event-specific extras. Habit name and emoji are snapshotted here so the feed
   * renders without a join, and so a deleted habit leaves a readable row. Safe
   * because events exist only for shared habits, and a database trigger deletes
   * them if a habit later turns private.
   */
  metadata: {
    habit_name?: string
    habit_emoji?: string
    streak?: number
    preset?: string
    note?: string
  }
  created_at: string
}

export interface EventReaction {
  id: string
  event_id: string
  user_id: string
  emoji: ReactionEmoji
  created_at: string
}

export interface NotificationPrefs {
  user_id: string
  nudges: boolean
  at_risk: boolean
  reactions: boolean
  /** When false, push text says "a habit" rather than naming it. */
  show_habit_names: boolean
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
  kind: HabitKind
  recurrence_type: RecurrenceType
  scheduled_days: Weekday[] | null
  weekly_target: number | null
  visibility: HabitVisibility
  nudge_policy: NudgePolicy
  /** `HH:MM` from the form; normalised to `HH:MM:SS` before it reaches the database. */
  nudge_after_time: string | null
}
