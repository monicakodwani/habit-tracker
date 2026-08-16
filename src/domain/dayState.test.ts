import { describe, expect, it } from 'vitest'
import {
  atRiskNote,
  buildDayLookup,
  habitStartDate,
  isAtRiskNow,
  isNeutral,
  isSuccess,
  resolveDay,
} from './dayState'
import {
  EVERY_DAY,
  WEEKDAYS_ONLY,
  avoidHabit,
  checkinsOn,
  d,
  excusedOn,
  habitDay,
  lapsedOn,
  scheduledHabit,
  weeklyHabit,
} from './testFixtures'

const NY = 'America/New_York'
const TODAY = d('2026-08-16') // a Sunday
const EARLY = { created_at: '2026-01-01T12:00:00Z' }

const lookupOf = (checkins = [] as never[], days = [] as never[]) => buildDayLookup(checkins, days)

describe('resolveDay — do habits', () => {
  const habit = scheduledHabit(EVERY_DAY, EARLY)

  it('is done when completed', () => {
    const lookup = buildDayLookup(checkinsOn(habit, ['2026-08-16']), [])
    expect(resolveDay(habit, TODAY, TODAY, NY, lookup)).toBe('done')
  })

  it('is pending when due today and not done', () => {
    expect(resolveDay(habit, TODAY, TODAY, NY, lookupOf())).toBe('pending')
  })

  it('is missed when due on a past day and never done', () => {
    expect(resolveDay(habit, d('2026-08-14'), TODAY, NY, lookupOf())).toBe('missed')
  })

  it('is excused when the day is excused', () => {
    const lookup = buildDayLookup([], excusedOn(habit, ['2026-08-14']))
    expect(resolveDay(habit, d('2026-08-14'), TODAY, NY, lookup)).toBe('excused')
  })

  it('prefers done over excused when both are recorded', () => {
    // Excusing a day you then completed anyway should still read as a win.
    const lookup = buildDayLookup(
      checkinsOn(habit, ['2026-08-14']),
      excusedOn(habit, ['2026-08-14']),
    )
    expect(resolveDay(habit, d('2026-08-14'), TODAY, NY, lookup)).toBe('done')
  })

  it('is off on an unscheduled day', () => {
    const weekdays = scheduledHabit(WEEKDAYS_ONLY, EARLY)
    expect(resolveDay(weekdays, TODAY, TODAY, NY, lookupOf())).toBe('off')
  })

  it('is off in the future', () => {
    expect(resolveDay(habit, d('2026-08-20'), TODAY, NY, lookupOf())).toBe('off')
  })

  it('is off before the habit existed', () => {
    const recent = scheduledHabit(EVERY_DAY, { created_at: '2026-08-15T12:00:00Z' })
    expect(resolveDay(recent, d('2026-08-14'), TODAY, NY, lookupOf())).toBe('off')
    expect(resolveDay(recent, d('2026-08-15'), TODAY, NY, lookupOf())).toBe('missed')
  })

  it('lets a recorded check-in override the creation-date bound', () => {
    // A check-in is proof the habit existed that day, whatever created_at says —
    // which it genuinely can, after an edit or a backfill. Without this, a habit's
    // visible history could silently vanish.
    const recent = scheduledHabit(EVERY_DAY, { created_at: '2026-08-15T12:00:00Z' })
    const lookup = buildDayLookup(checkinsOn(recent, ['2026-08-10']), [])
    expect(resolveDay(recent, d('2026-08-10'), TODAY, NY, lookup)).toBe('done')
  })

  it('lets a recorded excuse override the creation-date bound too', () => {
    const recent = scheduledHabit(EVERY_DAY, { created_at: '2026-08-15T12:00:00Z' })
    const lookup = buildDayLookup([], excusedOn(recent, ['2026-08-10']))
    expect(resolveDay(recent, d('2026-08-10'), TODAY, NY, lookup)).toBe('excused')
  })
})

describe('resolveDay — avoid habits', () => {
  const habit = avoidHabit(EVERY_DAY, EARLY)

  it('is still-going on today with no lapse', () => {
    // The day is not over, so it is neither a success nor a failure yet.
    expect(resolveDay(habit, TODAY, TODAY, NY, lookupOf())).toBe('still-going')
  })

  it('is clean on a finished day with no lapse', () => {
    expect(resolveDay(habit, d('2026-08-15'), TODAY, NY, lookupOf())).toBe('clean')
  })

  it('is lapsed when a slip was logged', () => {
    const lookup = buildDayLookup([], lapsedOn(habit, ['2026-08-16']))
    expect(resolveDay(habit, TODAY, TODAY, NY, lookup)).toBe('lapsed')
  })

  it('is excused when excused, even today', () => {
    const lookup = buildDayLookup([], excusedOn(habit, ['2026-08-16']))
    expect(resolveDay(habit, TODAY, TODAY, NY, lookup)).toBe('excused')
  })

  it('never reports clean before the habit existed', () => {
    // Success is the absence of a record, so the creation bound is what stops an
    // avoidance habit claiming credit for all of history.
    const recent = avoidHabit(EVERY_DAY, { created_at: '2026-08-15T12:00:00Z' })
    expect(resolveDay(recent, d('2026-08-01'), TODAY, NY, lookupOf())).toBe('off')
    expect(resolveDay(recent, d('2026-08-15'), TODAY, NY, lookupOf())).toBe('clean')
  })

  it('but a recorded lapse before that date is still a lapse', () => {
    const recent = avoidHabit(EVERY_DAY, { created_at: '2026-08-15T12:00:00Z' })
    const lookup = buildDayLookup([], lapsedOn(recent, ['2026-08-10']))
    expect(resolveDay(recent, d('2026-08-10'), TODAY, NY, lookup)).toBe('lapsed')
  })
})

describe('resolveDay — weekly-target habits', () => {
  const habit = weeklyHabit(3, EARLY)

  it('reports done on days that were completed and off otherwise', () => {
    const lookup = buildDayLookup(checkinsOn(habit, ['2026-08-14']), [])
    expect(resolveDay(habit, d('2026-08-14'), TODAY, NY, lookup)).toBe('done')
    expect(resolveDay(habit, d('2026-08-13'), TODAY, NY, lookup)).toBe('off')
  })
})

describe('isSuccess / isNeutral', () => {
  it('classifies outcomes', () => {
    expect(['done', 'clean'].every(isSuccess as never)).toBe(true)
    expect(['pending', 'missed', 'lapsed'].some(isSuccess as never)).toBe(false)
    expect(['excused', 'off', 'still-going'].every(isNeutral as never)).toBe(true)
    expect(['done', 'missed'].some(isNeutral as never)).toBe(false)
  })
})

describe('habitStartDate', () => {
  it('resolves the creation instant in the owner’s timezone, not UTC', () => {
    // Midnight UTC is still the previous evening in New York — the difference that
    // silently added a day to every avoidance streak until it was pinned down.
    const habit = scheduledHabit(EVERY_DAY, { created_at: '2026-08-04T00:00:00Z' })
    expect(habitStartDate(habit, NY)).toBe('2026-08-03')
    expect(habitStartDate(habit, 'Europe/London')).toBe('2026-08-04')
  })
})

describe('isAtRiskNow', () => {
  const habit = scheduledHabit(EVERY_DAY, EARLY)
  const marked = (date: string, note?: string) => [
    habitDay(habit, date, { at_risk_at: `${date}T14:00:00Z`, at_risk_note: note ?? null }),
  ]

  it('is true for a pending shared habit marked today', () => {
    const lookup = buildDayLookup([], marked('2026-08-16'))
    expect(isAtRiskNow(habit, TODAY, lookup, [], NY)).toBe(true)
  })

  it('resolves once the habit is completed', () => {
    const lookup = buildDayLookup(checkinsOn(habit, ['2026-08-16']), marked('2026-08-16'))
    expect(isAtRiskNow(habit, TODAY, lookup, [], NY)).toBe(false)
  })

  it('resolves when the day is excused', () => {
    const lookup = buildDayLookup([], [
      habitDay(habit, '2026-08-16', { at_risk_at: '2026-08-16T14:00:00Z', excused: true }),
    ])
    expect(isAtRiskNow(habit, TODAY, lookup, [], NY)).toBe(false)
  })

  it('expires with the local day — yesterday’s marker is not current', () => {
    const lookup = buildDayLookup([], marked('2026-08-15'))
    expect(isAtRiskNow(habit, TODAY, lookup, [], NY)).toBe(false)
  })

  it('is false for a private habit, which has no social meaning', () => {
    const secret = scheduledHabit(EVERY_DAY, { ...EARLY, visibility: 'private' })
    const lookup = buildDayLookup([], [
      habitDay(secret, '2026-08-16', { at_risk_at: '2026-08-16T14:00:00Z' }),
    ])
    expect(isAtRiskNow(secret, TODAY, lookup, [], NY)).toBe(false)
  })

  it('is false for an archived habit', () => {
    const archived = scheduledHabit(EVERY_DAY, { ...EARLY, active: false })
    const lookup = buildDayLookup([], [
      habitDay(archived, '2026-08-16', { at_risk_at: '2026-08-16T14:00:00Z' }),
    ])
    expect(isAtRiskNow(archived, TODAY, lookup, [], NY)).toBe(false)
  })

  it('is false on a day the habit is not scheduled', () => {
    const weekdays = scheduledHabit(WEEKDAYS_ONLY, EARLY)
    const lookup = buildDayLookup([], [
      habitDay(weekdays, '2026-08-16', { at_risk_at: '2026-08-16T14:00:00Z' }),
    ])
    expect(isAtRiskNow(weekdays, TODAY, lookup, [], NY)).toBe(false)
  })

  it('resolves for a weekly habit once the target is met', () => {
    const weekly = weeklyHabit(2, EARLY)
    const done = checkinsOn(weekly, ['2026-08-10', '2026-08-11'])
    const lookup = buildDayLookup(done, [
      habitDay(weekly, '2026-08-16', { at_risk_at: '2026-08-16T14:00:00Z' }),
    ])
    expect(isAtRiskNow(weekly, TODAY, lookup, done, NY)).toBe(false)
  })

  it('stays active for a weekly habit still short of its target', () => {
    const weekly = weeklyHabit(3, EARLY)
    const done = checkinsOn(weekly, ['2026-08-10'])
    const lookup = buildDayLookup(done, [
      habitDay(weekly, '2026-08-16', { at_risk_at: '2026-08-16T14:00:00Z' }),
    ])
    expect(isAtRiskNow(weekly, TODAY, lookup, done, NY)).toBe(true)
  })

  it('stays active for an avoidance habit still going', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    const lookup = buildDayLookup([], [
      habitDay(avoid, '2026-08-16', { at_risk_at: '2026-08-16T14:00:00Z' }),
    ])
    expect(isAtRiskNow(avoid, TODAY, lookup, [], NY)).toBe(true)
  })

  it('resolves for an avoidance habit once a slip is logged', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    const lookup = buildDayLookup([], [
      habitDay(avoid, '2026-08-16', { at_risk_at: '2026-08-16T14:00:00Z', lapsed: true }),
    ])
    expect(isAtRiskNow(avoid, TODAY, lookup, [], NY)).toBe(false)
  })

  it('carries the note through', () => {
    const lookup = buildDayLookup([], marked('2026-08-16', 'make me do 10 pages'))
    expect(atRiskNote(TODAY, lookup)).toBe('make me do 10 pages')
    expect(atRiskNote(d('2026-08-15'), lookup)).toBeNull()
  })
})
