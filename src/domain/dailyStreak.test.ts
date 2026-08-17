import { describe, expect, it } from 'vitest'
import {
  calculateDailyCombinedStreak,
  calculateLongestDailyCombinedStreak,
  describeToday,
  summarizeDailyStreak,
} from './dailyStreak'
import type { Checkin, Habit, HabitDay } from '../types/models'
import {
  EVERY_DAY,
  WEEKDAYS_ONLY,
  avoidHabit,
  checkinsOn,
  d,
  excusedOn,
  lapsedOn,
  scheduledHabit,
  weeklyHabit,
} from './testFixtures'

const NY = 'America/New_York'
const EARLY = { created_at: '2026-01-01T12:00:00Z' }

// 2026-08-10 Mon … 2026-08-16 Sun.  "Today" in most tests is Sunday the 16th.
const TODAY = d('2026-08-16')

/** Runs the summary over a set of habits and their records. */
function summarize(
  habits: Habit[],
  checkins: Checkin[] = [],
  days: HabitDay[] = [],
  today = TODAY,
  zone = NY,
) {
  return summarizeDailyStreak(habits, checkins, days, today, zone)
}

// ---------------------------------------------------------------------------
// Day status
// ---------------------------------------------------------------------------

describe('combined day status — scheduled do habits', () => {
  it('a past day with every scheduled habit completed is successful', () => {
    const read = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Read' })
    const vits = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Vitamins' })
    const result = summarize(
      [read, vits],
      [...checkinsOn(read, ['2026-08-15']), ...checkinsOn(vits, ['2026-08-15'])],
    )
    expect(result.current).toBe(1)
  })

  it('one missed scheduled habit fails the whole day', () => {
    const read = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Read' })
    const vits = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Vitamins' })
    // Vitamins done on the 15th, Read not.
    const result = summarize([read, vits], checkinsOn(vits, ['2026-08-15']))
    expect(result.current).toBe(0)
  })

  it('an excused occurrence still lets the day succeed', () => {
    // The point of grace: being ill on Saturday must not cost the day.
    const read = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Read' })
    const vits = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Vitamins' })
    const result = summarize(
      [read, vits],
      checkinsOn(vits, ['2026-08-15']),
      excusedOn(read, ['2026-08-15']),
    )
    expect(result.current).toBe(1)
  })

  it('a day with nothing scheduled is neutral, not successful', () => {
    // Weekday-only habit, and the 15th/16th are the weekend.
    const work = scheduledHabit(WEEKDAYS_ONLY, EARLY)
    const result = summarize([work], checkinsOn(work, ['2026-08-14']))
    // Friday the 14th succeeded; Saturday the 15th is neutral and skipped.
    expect(result.current).toBe(1)
  })

  it('does not count a day before the habit existed', () => {
    const read = scheduledHabit(EVERY_DAY, { created_at: '2026-08-15T12:00:00Z' })
    // The 14th predates the habit, so it cannot be a failure — and with nothing else
    // scheduled it is neutral, leaving the 15th as the only judged day.
    const result = summarize([read], checkinsOn(read, ['2026-08-15']))
    expect(result.current).toBe(1)
  })

  it('a habit created today does not retroactively fail yesterday', () => {
    const read = scheduledHabit(EVERY_DAY, { created_at: '2026-08-16T12:00:00Z' })
    const result = summarize([read])
    expect(result.current).toBe(0) // nothing finalised yet, but nothing failed either
    expect(result.today.status).toBe('in_progress')
  })
})

describe('combined day status — avoidance habits', () => {
  it('a finished day with no lapse is successful', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    // Every day from creation to yesterday is clean.
    const result = summarize([avoid])
    expect(result.current).toBeGreaterThan(0)
  })

  it('a lapse fails that day', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    const result = summarize([avoid], [], lapsedOn(avoid, ['2026-08-15']))
    expect(result.current).toBe(0)
  })

  it('an excused avoidance day is handled, not failed', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    const withExcuse = summarize([avoid], [], excusedOn(avoid, ['2026-08-15']))
    const without = summarize([avoid])
    // The excused day neither breaks the run nor is missing from it.
    expect(withExcuse.current).toBe(without.current)
  })

  it('today is in progress while an avoidance habit is still going', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    const result = summarize([avoid])
    expect(result.today.status).toBe('in_progress')
  })

  it('a lapse today fails today definitively', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    const result = summarize([avoid], [], lapsedOn(avoid, ['2026-08-16']))
    expect(result.today.status).toBe('failed')
  })
})

describe('combined day status — weekly-target habits are ignored', () => {
  it('an unfinished weekly target does not fail a day', () => {
    const exercise = weeklyHabit(3, EARLY)
    const read = scheduledHabit(EVERY_DAY, EARLY)
    // Read done on the 15th; the weekly target has no completions at all.
    const result = summarize([exercise, read], checkinsOn(read, ['2026-08-15']))
    expect(result.current).toBe(1)
  })

  it('a weekly target alone leaves every day neutral', () => {
    const exercise = weeklyHabit(3, EARLY)
    const result = summarize([exercise], checkinsOn(exercise, ['2026-08-12']))
    expect(result.current).toBe(0)
    expect(result.today.status).toBe('neutral')
  })
})

describe('combined day status — private habits count for the owner', () => {
  it('a missed private habit fails the owner’s day', () => {
    const shared = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Read' })
    const secret = scheduledHabit(EVERY_DAY, {
      ...EARLY,
      name: 'Therapy',
      visibility: 'private',
    })
    const result = summarize([shared, secret], checkinsOn(shared, ['2026-08-15']))
    expect(result.current).toBe(0)
  })

  it('and a completed private habit contributes to success', () => {
    const shared = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Read' })
    const secret = scheduledHabit(EVERY_DAY, {
      ...EARLY,
      name: 'Therapy',
      visibility: 'private',
    })
    const result = summarize(
      [shared, secret],
      [...checkinsOn(shared, ['2026-08-15']), ...checkinsOn(secret, ['2026-08-15'])],
    )
    expect(result.current).toBe(1)
  })
})

describe('combined day status — archived habits', () => {
  it('stops applying after the habit was archived', () => {
    // Archived on the 13th (updated_at), so the 14th and 15th are unaffected by it.
    const retired: Habit = {
      ...scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Piano' }),
      active: false,
      updated_at: '2026-08-13T12:00:00Z',
    }
    const read = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Read' })
    const result = summarize([retired, read], checkinsOn(read, ['2026-08-14', '2026-08-15']))
    expect(result.current).toBe(2)
  })

  it('still counts against days while it was active', () => {
    // Same habit, but the days in question are before it was archived — those days
    // genuinely failed at the time and must not be rewritten.
    const retired: Habit = {
      ...scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Piano' }),
      active: false,
      updated_at: '2026-08-20T12:00:00Z',
    }
    const read = scheduledHabit(EVERY_DAY, { ...EARLY, name: 'Read' })
    const result = summarize([retired, read], checkinsOn(read, ['2026-08-14', '2026-08-15']))
    expect(result.current).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Streak sequences
// ---------------------------------------------------------------------------

describe('streak sequences', () => {
  const read = scheduledHabit(EVERY_DAY, EARLY)

  it('counts a simple run of successes', () => {
    const result = summarize([read], checkinsOn(read, ['2026-08-13', '2026-08-14', '2026-08-15']))
    expect(result.current).toBe(3)
  })

  it('is zero when the most recent finalised day failed', () => {
    const result = summarize([read], checkinsOn(read, ['2026-08-13', '2026-08-14']))
    // The 15th was due and missed.
    expect(result.current).toBe(0)
  })

  it('restarts after a failure', () => {
    const result = summarize([read], checkinsOn(read, ['2026-08-12', '2026-08-14', '2026-08-15']))
    // The 13th was missed; the 14th and 15th rebuilt a run of two.
    expect(result.current).toBe(2)
  })

  it('treats neutral days as transparent', () => {
    const weekdays = scheduledHabit(WEEKDAYS_ONLY, EARLY)
    // Mon–Fri all done; Sat 15th is neutral; today is Sun 16th.
    const result = summarize(
      [weekdays],
      checkinsOn(weekdays, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']),
    )
    expect(result.current).toBe(5)
  })

  it('carries a run across a whole neutral weekend', () => {
    const weekdays = scheduledHabit(WEEKDAYS_ONLY, { created_at: '2026-08-03T12:00:00Z' })
    const done = [
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', // week 1
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', // week 2
    ]
    const result = summarize([weekdays], checkinsOn(weekdays, done), [], d('2026-08-17'))
    // Ten weekdays, with two neutral weekends passed through.
    expect(result.current).toBe(10)
  })

  it('keeps a run alive through an excused day', () => {
    const result = summarize(
      [read],
      checkinsOn(read, ['2026-08-13', '2026-08-15']),
      excusedOn(read, ['2026-08-14']),
    )
    expect(result.current).toBe(3)
  })

  it('mixes do and avoidance habits', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    const bothFine = summarize([read, avoid], checkinsOn(read, ['2026-08-14', '2026-08-15']))
    expect(bothFine.current).toBe(2)

    const slipped = summarize(
      [read, avoid],
      checkinsOn(read, ['2026-08-14', '2026-08-15']),
      lapsedOn(avoid, ['2026-08-15']),
    )
    expect(slipped.current).toBe(0)
  })
})

describe('longest streak', () => {
  const read = scheduledHabit(EVERY_DAY, { created_at: '2026-07-01T12:00:00Z' })

  it('is independent of the current run', () => {
    // Aug 1–10 done (a run of 10), the 11th and 12th missed, then 13–15 done.
    const earlierRun = [
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05',
      '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10',
    ]
    const recentRun = ['2026-08-13', '2026-08-14', '2026-08-15']
    const result = summarize([read], checkinsOn(read, [...earlierRun, ...recentRun]))

    expect(result.current).toBe(3)
    expect(result.longest).toBe(10)
  })

  it('does not let neutral days split a run', () => {
    const weekdays = scheduledHabit(WEEKDAYS_ONLY, { created_at: '2026-08-03T12:00:00Z' })
    const done = [
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
    ]
    const result = summarize([weekdays], checkinsOn(weekdays, done), [], d('2026-08-17'))
    expect(result.longest).toBe(10)
  })

  it('excludes the unfinished current day', () => {
    const result = summarize([read], checkinsOn(read, ['2026-08-14', '2026-08-15', '2026-08-16']))
    // Today is done but not finalised, so it counts toward neither number.
    expect(result.current).toBe(2)
    expect(result.longest).toBe(2)
  })

  it('has convenience wrappers that agree with the summary', () => {
    const checkins = checkinsOn(read, ['2026-08-14', '2026-08-15'])
    expect(calculateDailyCombinedStreak([read], checkins, [], TODAY, NY)).toBe(2)
    expect(calculateLongestDailyCombinedStreak([read], checkins, [], TODAY, NY)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// The current day
// ---------------------------------------------------------------------------

describe('the current day is never finalised early', () => {
  const read = scheduledHabit(EVERY_DAY, EARLY)

  it('an unfinished today does not erase yesterday’s streak', () => {
    const result = summarize(
      [read],
      checkinsOn(read, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']),
    )
    expect(result.current).toBe(6)
    expect(result.today.status).toBe('in_progress')
    expect(result.today.allHandled).toBe(false)
  })

  it('a fully completed today still shows only yesterday’s number', () => {
    // The rule that makes the metric trustworthy: it only ever moves forward.
    const result = summarize(
      [read],
      checkinsOn(read, [
        '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15',
        '2026-08-16',
      ]),
    )
    expect(result.current).toBe(6)
    expect(result.today.status).toBe('in_progress')
    expect(result.today.allHandled).toBe(true)
  })

  it('and becomes 7 once that day is in the past', () => {
    const checkins = checkinsOn(read, [
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15',
      '2026-08-16',
    ])
    const tomorrow = summarize([read], checkins, [], d('2026-08-17'))
    expect(tomorrow.current).toBe(7)
  })

  it('today failing does not retroactively remove finalised days', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    const result = summarize(
      [read, avoid],
      checkinsOn(read, ['2026-08-14', '2026-08-15']),
      lapsedOn(avoid, ['2026-08-16']),
    )
    expect(result.current).toBe(2)
    expect(result.today.status).toBe('failed')
  })

  it('reports neutral when nothing is scheduled today', () => {
    const weekdays = scheduledHabit(WEEKDAYS_ONLY, EARLY)
    const result = summarize([weekdays], checkinsOn(weekdays, ['2026-08-14']))
    expect(result.today.status).toBe('neutral')
  })
})

describe('historical corrections recalculate', () => {
  const read = scheduledHabit(EVERY_DAY, EARLY)

  it('adding a forgotten check-in restores the run', () => {
    const broken = summarize([read], checkinsOn(read, ['2026-08-13', '2026-08-15']))
    expect(broken.current).toBe(1)

    const corrected = summarize([read], checkinsOn(read, ['2026-08-13', '2026-08-14', '2026-08-15']))
    expect(corrected.current).toBe(3)
  })

  it('granting an excuse after the fact restores the run', () => {
    const corrected = summarize(
      [read],
      checkinsOn(read, ['2026-08-13', '2026-08-15']),
      excusedOn(read, ['2026-08-14']),
    )
    expect(corrected.current).toBe(3)
  })

  it('undoing a slip restores the run', () => {
    const avoid = avoidHabit(EVERY_DAY, EARLY)
    expect(summarize([avoid], [], lapsedOn(avoid, ['2026-08-15'])).current).toBe(0)
    expect(summarize([avoid], [], []).current).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Timezones
// ---------------------------------------------------------------------------

describe('timezones', () => {
  const read = scheduledHabit(EVERY_DAY, EARLY)

  it('uses the owner’s local day, not the UTC day', () => {
    // 2026-08-17T02:00Z is still the 16th in New York but the 17th in London, so the
    // two zones disagree about which day is finalised.
    const checkins = checkinsOn(read, ['2026-08-14', '2026-08-15', '2026-08-16'])
    const inNY = summarizeDailyStreak([read], checkins, [], d('2026-08-16'), NY)
    const inLondon = summarizeDailyStreak([read], checkins, [], d('2026-08-17'), 'Europe/London')

    expect(inNY.current).toBe(2) // through the 15th
    expect(inLondon.current).toBe(3) // through the 16th
  })

  it('counts correctly across a DST spring-forward', () => {
    // US DST begins 2026-03-08, a 23-hour day.
    const habit = scheduledHabit(EVERY_DAY, { created_at: '2026-03-01T12:00:00Z' })
    const checkins = checkinsOn(habit, [
      '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09',
    ])
    const result = summarizeDailyStreak([habit], checkins, [], d('2026-03-10'), NY)
    expect(result.current).toBe(4)
  })

  it('counts correctly across a DST fall-back', () => {
    // US DST ends 2026-11-01, a 25-hour day.
    const habit = scheduledHabit(EVERY_DAY, { created_at: '2026-10-25T12:00:00Z' })
    const checkins = checkinsOn(habit, [
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ])
    const result = summarizeDailyStreak([habit], checkins, [], d('2026-11-03'), NY)
    expect(result.current).toBe(4)
  })

  it('counts correctly across a year boundary', () => {
    const habit = scheduledHabit(EVERY_DAY, { created_at: '2026-12-20T12:00:00Z' })
    const checkins = checkinsOn(habit, [
      '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ])
    const result = summarizeDailyStreak([habit], checkins, [], d('2027-01-03'), NY)
    expect(result.current).toBe(4)
  })

  it('counts a leap day', () => {
    const habit = scheduledHabit(EVERY_DAY, { created_at: '2028-02-20T12:00:00Z' })
    const checkins = checkinsOn(habit, ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01'])
    const result = summarizeDailyStreak([habit], checkins, [], d('2028-03-02'), NY)
    expect(result.current).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

describe('describeToday', () => {
  const base = { date: TODAY, applicable: 2, handled: 1, failed: 0, allHandled: false }

  it('is encouraging, never punitive', () => {
    expect(describeToday({ ...base, status: 'in_progress' })).toBe('On track today')
    expect(describeToday({ ...base, status: 'in_progress', allHandled: true })).toBe(
      'Everything done today ✓',
    )
    expect(describeToday({ ...base, status: 'failed', failed: 1 })).toBe('Start fresh tomorrow')
    expect(describeToday({ ...base, status: 'neutral', applicable: 0 })).toBe(
      'No scheduled habits today',
    )
  })
})

describe('no habits at all', () => {
  it('reports zero without throwing', () => {
    const result = summarize([])
    expect(result).toMatchObject({ current: 0, longest: 0 })
    expect(result.today.status).toBe('neutral')
  })
})
