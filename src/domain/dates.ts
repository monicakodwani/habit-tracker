/**
 * Timezone-aware calendar-date helpers.
 *
 * The whole product is built on *local calendar days*, not UTC days. If a habit is
 * checked off at 11:30pm in New York, it belongs to that day — not to tomorrow,
 * which is what a naive `toISOString().slice(0, 10)` would produce.
 *
 * Every function here therefore takes an explicit IANA timezone and there is no
 * "current timezone" default anywhere. The timezone used is always the *habit
 * owner's*, so a friend in London sees Monica's day boundaries, not their own.
 *
 * Luxon does the arithmetic; nothing here hand-rolls offset maths.
 */
import { DateTime } from 'luxon'
import type { LocalDate, Weekday } from '../types/models'

/** Weeks run Monday -> Sunday. Isolated here so it can become a setting later. */
export const WEEK_STARTS_ON: Weekday = 1

/** Narrows a `YYYY-MM-DD` string to `LocalDate`. Use only where the value is known good. */
export function asLocalDate(value: string): LocalDate {
  return value as LocalDate
}

/** True when the string is a real `YYYY-MM-DD` calendar date. */
export function isLocalDate(value: string): value is LocalDate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value).isValid
}

/** True when the string names a timezone this runtime understands. */
export function isValidTimezone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid
}

/**
 * Falls back to a sane zone if a profile somehow carries a timezone this browser
 * does not recognise, so a bad value degrades to "wrong day boundaries" rather
 * than "app renders Invalid DateTime everywhere".
 */
export function safeZone(zone: string | null | undefined): string {
  return zone && isValidTimezone(zone) ? zone : guessTimezone()
}

/** The browser's best guess at the user's timezone; used to prefill the profile. */
export function guessTimezone(): string {
  const guess = Intl.DateTimeFormat().resolvedOptions().timeZone
  return guess && isValidTimezone(guess) ? guess : 'UTC'
}

/** Converts a date-only string into a Luxon DateTime anchored at midnight in `zone`. */
function fromLocalDate(date: LocalDate, zone: string): DateTime {
  return DateTime.fromISO(date, { zone }).startOf('day')
}

function toLocalDate(dt: DateTime): LocalDate {
  // `toISODate` is calendar-date-only, so it reflects the DateTime's zone, not UTC.
  return dt.toISODate() as LocalDate
}

/**
 * Today's calendar date in `zone`.
 *
 * `now` is injectable so tests can pin the clock; production callers omit it.
 */
export function todayIn(zone: string, now: Date = new Date()): LocalDate {
  return toLocalDate(DateTime.fromJSDate(now, { zone }))
}

/** The ISO weekday (1 = Mon .. 7 = Sun) that a local date falls on. */
export function weekdayOf(date: LocalDate, zone: string): Weekday {
  return fromLocalDate(date, zone).weekday as Weekday
}

/** Shifts a local date by whole days, staying on calendar days across DST changes. */
export function addDays(date: LocalDate, days: number, zone: string): LocalDate {
  return toLocalDate(fromLocalDate(date, zone).plus({ days }))
}

/** Whole calendar days between two local dates (`b - a`). Negative when `b` precedes `a`. */
export function daysBetween(a: LocalDate, b: LocalDate, zone: string): number {
  return Math.round(fromLocalDate(b, zone).diff(fromLocalDate(a, zone), 'days').days)
}

/** The Monday of the week containing `date`. */
export function startOfWeek(date: LocalDate, zone: string): LocalDate {
  const dt = fromLocalDate(date, zone)
  return toLocalDate(dt.minus({ days: dt.weekday - WEEK_STARTS_ON }))
}

/** The Sunday of the week containing `date`. */
export function endOfWeek(date: LocalDate, zone: string): LocalDate {
  return addDays(startOfWeek(date, zone), 6, zone)
}

/** The seven local dates of the week containing `date`, Monday first. */
export function weekDates(date: LocalDate, zone: string): LocalDate[] {
  const monday = startOfWeek(date, zone)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i, zone))
}

/** Every local date from `from` to `to` inclusive. */
export function dateRange(from: LocalDate, to: LocalDate, zone: string): LocalDate[] {
  const span = daysBetween(from, to, zone)
  if (span < 0) return []
  return Array.from({ length: span + 1 }, (_, i) => addDays(from, i, zone))
}

/** True when two local dates fall in the same Monday–Sunday week. */
export function isSameWeek(a: LocalDate, b: LocalDate, zone: string): boolean {
  return startOfWeek(a, zone) === startOfWeek(b, zone)
}

// --- Formatting -------------------------------------------------------------

/** e.g. "Sunday, August 16" — the Today screen heading. */
export function formatLongDate(date: LocalDate, zone: string): string {
  return fromLocalDate(date, zone).toFormat('cccc, LLLL d')
}

/** e.g. "Aug 16" — compact, for history rows. */
export function formatShortDate(date: LocalDate, zone: string): string {
  return fromLocalDate(date, zone).toFormat('LLL d')
}

/** e.g. "August 2026" — calendar headings. */
export function formatMonthYear(date: LocalDate, zone: string): string {
  return fromLocalDate(date, zone).toFormat('LLLL yyyy')
}

/** e.g. "Aug 10 – Aug 16" — the Week screen heading. */
export function formatWeekRange(date: LocalDate, zone: string): string {
  const start = fromLocalDate(startOfWeek(date, zone), zone)
  const end = fromLocalDate(endOfWeek(date, zone), zone)
  const endFormat = start.month === end.month ? 'd' : 'LLL d'
  return `${start.toFormat('LLL d')} – ${end.toFormat(endFormat)}`
}

/**
 * "Today" / "Yesterday" / "Aug 12" — relative to `today` in `zone`.
 * Used in history lists, where an absolute date for the last two days reads oddly.
 */
export function formatRelativeDay(date: LocalDate, today: LocalDate, zone: string): string {
  const delta = daysBetween(date, today, zone)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Yesterday'
  return formatShortDate(date, zone)
}

/**
 * The days of `date`'s month laid out as Monday-first calendar rows, with `null`
 * padding for the leading and trailing blanks. Drives the habit-detail calendar.
 */
export function monthGrid(date: LocalDate, zone: string): (LocalDate | null)[][] {
  const dt = fromLocalDate(date, zone)
  const first = dt.startOf('month')
  const daysInMonth = dt.daysInMonth ?? 30

  const cells: (LocalDate | null)[] = [
    // Blank cells before the 1st, so columns line up under M T W T F S S.
    ...Array.from({ length: first.weekday - WEEK_STARTS_ON }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toLocalDate(first.plus({ days: i }))),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7))
}
