import { describe, expect, it } from 'vitest'
import { buildFriendsToday, buildPersonToday, buildWeekRows, isDone } from './status'
import { weekDates } from './dates'
import {
  EVERY_DAY,
  WEEKDAYS_ONLY,
  checkinsOn,
  d,
  noonUtc,
  profile,
  scheduledHabit,
  weeklyHabit,
} from './testFixtures'

const NY = 'America/New_York'
const me = profile({ id: 'me', display_name: 'Monica', timezone: NY })

// 2026-08-13 is a Thursday.
const THURSDAY = noonUtc('2026-08-13')

describe('buildPersonToday', () => {
  it('includes only habits due today, and only this person’s', () => {
    const mine = scheduledHabit(WEEKDAYS_ONLY, { owner_id: 'me', name: 'Dissertation' })
    const weekendOnly = scheduledHabit([6, 7], { owner_id: 'me', name: 'Deep clean' })
    const someoneElses = scheduledHabit(EVERY_DAY, { owner_id: 'ura', name: 'Yoga' })

    const today = buildPersonToday(me, [mine, weekendOnly, someoneElses], [], NY, THURSDAY)
    expect(today.items.map((i) => i.habit.name)).toEqual(['Dissertation'])
  })

  it('excludes archived habits', () => {
    const active = scheduledHabit(EVERY_DAY, { owner_id: 'me', name: 'Read' })
    const archived = scheduledHabit(EVERY_DAY, { owner_id: 'me', name: 'Piano', active: false })

    const today = buildPersonToday(me, [active, archived], [], NY, THURSDAY)
    expect(today.items.map((i) => i.habit.name)).toEqual(['Read'])
  })

  it('includes the owner’s own private habits', () => {
    const secret = scheduledHabit(EVERY_DAY, {
      owner_id: 'me',
      name: 'Therapy',
      visibility: 'private',
    })
    const today = buildPersonToday(me, [secret], [], NY, THURSDAY)
    expect(today.items.map((i) => i.habit.name)).toEqual(['Therapy'])
  })

  it('resolves today in the given timezone', () => {
    // 2026-08-14T02:00Z is still Thursday the 13th in New York, but Friday in Tokyo.
    const fridayOnly = scheduledHabit([5], { owner_id: 'me', name: 'Friday thing' })
    const lateNight = new Date('2026-08-14T02:00:00Z')

    expect(buildPersonToday(me, [fridayOnly], [], NY, lateNight).date).toBe('2026-08-13')
    expect(buildPersonToday(me, [fridayOnly], [], NY, lateNight).items).toHaveLength(0)
    expect(buildPersonToday(me, [fridayOnly], [], 'Asia/Tokyo', lateNight).items).toHaveLength(1)
  })

  it('reports per-day completion and progress counts', () => {
    const read = scheduledHabit(EVERY_DAY, { owner_id: 'me', name: 'Read', created_at: '2026-01-01T00:00:00Z' })
    const walk = scheduledHabit(EVERY_DAY, { owner_id: 'me', name: 'Walk', created_at: '2026-01-02T00:00:00Z' })

    const today = buildPersonToday(
      me,
      [read, walk],
      checkinsOn(read, ['2026-08-13']),
      NY,
      THURSDAY,
    )
    expect(today.completedCount).toBe(1)
    expect(today.totalCount).toBe(2)
    expect(today.items[0]?.completedToday).toBe(true)
    expect(today.items[1]?.completedToday).toBe(false)
  })

  it('attaches a streak to scheduled habits and weekly progress to weekly ones', () => {
    const read = scheduledHabit(EVERY_DAY, { owner_id: 'me', created_at: '2026-01-01T00:00:00Z' })
    const exercise = weeklyHabit(3, { owner_id: 'me', created_at: '2026-01-02T00:00:00Z' })

    const today = buildPersonToday(
      me,
      [read, exercise],
      [
        ...checkinsOn(read, ['2026-08-11', '2026-08-12', '2026-08-13']),
        ...checkinsOn(exercise, ['2026-08-10', '2026-08-12']),
      ],
      NY,
      THURSDAY,
    )

    expect(today.items[0]?.streak).toEqual({ current: 3, longest: 3 })
    expect(today.items[0]?.weekly).toBeNull()
    expect(today.items[1]?.streak).toBeNull()
    expect(today.items[1]?.weekly).toMatchObject({ completed: 2, target: 3, met: false })
  })

  it('does not reorder habits when they are completed', () => {
    // Rows must not jump out from under the user's finger mid-tap, so ordering is
    // by creation date and stays fixed regardless of completion state.
    const first = scheduledHabit(EVERY_DAY, { owner_id: 'me', name: 'A', created_at: '2026-01-01T00:00:00Z' })
    const second = scheduledHabit(EVERY_DAY, { owner_id: 'me', name: 'B', created_at: '2026-01-02T00:00:00Z' })
    const third = scheduledHabit(EVERY_DAY, { owner_id: 'me', name: 'C', created_at: '2026-01-03T00:00:00Z' })

    const order = (checkins: ReturnType<typeof checkinsOn>) =>
      buildPersonToday(me, [first, second, third], checkins, NY, THURSDAY).items.map(
        (i) => i.habit.name,
      )

    expect(order([])).toEqual(['A', 'B', 'C'])
    expect(order(checkinsOn(second, ['2026-08-13']))).toEqual(['A', 'B', 'C'])
  })

  it('is empty when nothing is due', () => {
    const today = buildPersonToday(me, [], [], NY, THURSDAY)
    expect(today.items).toEqual([])
    expect(today.totalCount).toBe(0)
    expect(today.completedCount).toBe(0)
  })
})

describe('isDone', () => {
  const exercise = weeklyHabit(2, { owner_id: 'me' })

  it('is true for a weekly habit whose target is met, even on an unchecked day', () => {
    // Otherwise a habit finished for the week would sit unchecked every remaining
    // day, which reads as nagging.
    const today = buildPersonToday(
      me,
      [exercise],
      checkinsOn(exercise, ['2026-08-10', '2026-08-11']),
      NY,
      THURSDAY,
    )
    const item = today.items[0]!
    expect(item.completedToday).toBe(false)
    expect(isDone(item)).toBe(true)
    expect(today.completedCount).toBe(1)
  })

  it('is false for a weekly habit still short of its target', () => {
    const today = buildPersonToday(
      me,
      [exercise],
      checkinsOn(exercise, ['2026-08-10']),
      NY,
      THURSDAY,
    )
    expect(isDone(today.items[0]!)).toBe(false)
    expect(today.completedCount).toBe(0)
  })
})

describe('buildFriendsToday', () => {
  const ura = profile({ id: 'ura', display_name: 'Ura', timezone: 'Europe/London' })
  const ojas = profile({ id: 'ojas', display_name: 'Ojas', timezone: NY })

  it('builds one section per friend, sorted by name', () => {
    const yoga = scheduledHabit(EVERY_DAY, { owner_id: 'ura', name: 'Yoga' })
    const walk = scheduledHabit(EVERY_DAY, { owner_id: 'ojas', name: 'Walk' })

    const sections = buildFriendsToday([ura, ojas], [yoga, walk], [], THURSDAY)
    expect(sections.map((s) => s.profile.display_name)).toEqual(['Ojas', 'Ura'])
    expect(sections[1]?.items.map((i) => i.habit.name)).toEqual(['Yoga'])
  })

  it('never surfaces a friend’s private habit', () => {
    // RLS is what actually prevents this data from reaching the browser; this
    // asserts the view layer would not render it even if it somehow did.
    const shared = scheduledHabit(EVERY_DAY, { owner_id: 'ura', name: 'Yoga' })
    const secret = scheduledHabit(EVERY_DAY, {
      owner_id: 'ura',
      name: 'Therapy',
      visibility: 'private',
    })

    const sections = buildFriendsToday([ura], [shared, secret], [], THURSDAY)
    expect(sections[0]?.items.map((i) => i.habit.name)).toEqual(['Yoga'])
  })

  it('uses each friend’s own timezone to decide their day', () => {
    // 2026-08-14T01:00Z: already Friday in London, still Thursday in New York.
    const fridayHabitLondon = scheduledHabit([5], { owner_id: 'ura', name: 'Friday (London)' })
    const fridayHabitNY = scheduledHabit([5], { owner_id: 'ojas', name: 'Friday (NY)' })
    const crossover = new Date('2026-08-14T01:00:00Z')

    const sections = buildFriendsToday(
      [ura, ojas],
      [fridayHabitLondon, fridayHabitNY],
      [],
      crossover,
    )
    const byName = new Map(sections.map((s) => [s.profile.display_name, s]))
    expect(byName.get('Ura')?.date).toBe('2026-08-14')
    expect(byName.get('Ura')?.items).toHaveLength(1)
    expect(byName.get('Ojas')?.date).toBe('2026-08-13')
    expect(byName.get('Ojas')?.items).toHaveLength(0)
  })

  it('gives a friend with nothing due an empty section rather than omitting them', () => {
    const sections = buildFriendsToday([ura], [], [], THURSDAY)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.items).toEqual([])
  })
})

describe('buildWeekRows', () => {
  const dates = weekDates(d('2026-08-13'), NY) // Mon 10th – Sun 16th
  const today = d('2026-08-13') // Thursday

  it('marks which days a scheduled habit was due, completed, and still ahead', () => {
    const habit = scheduledHabit(WEEKDAYS_ONLY, { owner_id: 'me' })
    const rows = buildWeekRows(
      'me',
      [habit],
      checkinsOn(habit, ['2026-08-10', '2026-08-11']),
      dates,
      today,
      NY,
    )

    const row = rows[0]!
    expect(row.days.map((c) => c.scheduled)).toEqual([true, true, true, true, true, false, false])
    expect(row.days.map((c) => c.completed)).toEqual([
      true, true, false, false, false, false, false,
    ])
    expect(row.days.map((c) => c.isFuture)).toEqual([
      false, false, false, false, true, true, true,
    ])
    expect(row.days.filter((c) => c.isToday).map((c) => c.date)).toEqual(['2026-08-13'])
  })

  it('gives weekly habits progress instead of scheduled days', () => {
    const habit = weeklyHabit(3, { owner_id: 'me' })
    const rows = buildWeekRows(
      'me',
      [habit],
      checkinsOn(habit, ['2026-08-10', '2026-08-12']),
      dates,
      today,
      NY,
    )

    const row = rows[0]!
    expect(row.days.every((c) => !c.scheduled)).toBe(true)
    expect(row.days.map((c) => c.completed)).toEqual([
      true, false, true, false, false, false, false,
    ])
    expect(row.weekly).toMatchObject({ completed: 2, target: 3, met: false })
  })

  it('excludes archived habits and other people’s habits', () => {
    const archived = scheduledHabit(EVERY_DAY, { owner_id: 'me', name: 'Piano', active: false })
    const theirs = scheduledHabit(EVERY_DAY, { owner_id: 'ura', name: 'Yoga' })
    const mine = scheduledHabit(EVERY_DAY, { owner_id: 'me', name: 'Read' })

    const rows = buildWeekRows('me', [archived, theirs, mine], [], dates, today, NY)
    expect(rows.map((r) => r.habit.name)).toEqual(['Read'])
  })
})
