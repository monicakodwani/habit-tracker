import { describe, expect, it } from 'vitest'
import {
  daysSinceLastCheckin,
  recentCheckins,
  recentWeeks,
  scheduledStreak,
  summarizeRange,
  weeklyStreak,
} from './streaks'
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
import { avoidStreak } from './streaks'

const NY = 'America/New_York'

// 2026-08-10 Mon  ...  2026-08-16 Sun  |  2026-08-17 Mon ...

describe('scheduledStreak — the weekend rule', () => {
  it('does not break a Mon–Fri streak over the weekend', () => {
    // The exact example from the spec: Friday, Monday, Tuesday is a 3-occurrence
    // streak, because Saturday and Sunday were never scheduled.
    const habit = scheduledHabit(WEEKDAYS_ONLY)
    const checkins = checkinsOn(habit, ['2026-08-14', '2026-08-17', '2026-08-18'])
    expect(scheduledStreak(habit, checkins, d('2026-08-18'), NY).current).toBe(3)
  })

  it('is not reset by unscheduled days in the middle of a week', () => {
    // Tue + Sat habit: completing both weeks running is a 4-occurrence streak,
    // even though several unscheduled days sit in between.
    const habit = scheduledHabit([2, 6])
    const checkins = checkinsOn(habit, ['2026-08-11', '2026-08-15', '2026-08-18', '2026-08-22'])
    expect(scheduledStreak(habit, checkins, d('2026-08-22'), NY).current).toBe(4)
  })

  it('counts a weekend-only habit across the intervening week', () => {
    const habit = scheduledHabit([6, 7])
    const checkins = checkinsOn(habit, ['2026-08-15', '2026-08-16', '2026-08-22', '2026-08-23'])
    expect(scheduledStreak(habit, checkins, d('2026-08-23'), NY).current).toBe(4)
  })
})

describe('scheduledStreak — misses', () => {
  it('breaks when a scheduled day is missed', () => {
    // Mon–Fri habit: Wednesday missed, so only Thu+Fri survive.
    const habit = scheduledHabit(WEEKDAYS_ONLY)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-11', '2026-08-13', '2026-08-14'])
    expect(scheduledStreak(habit, checkins, d('2026-08-14'), NY).current).toBe(2)
  })

  it('remembers the longest run even after it is broken', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, [
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04', // 4-day run
      // 5th missed
      '2026-08-06',
      '2026-08-07', // 2-day run
    ])
    expect(scheduledStreak(habit, checkins, d('2026-08-07'), NY)).toEqual({
      current: 2,
      longest: 4,
    })
  })

  it('reports zero when the most recent scheduled day was missed', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-11'])
    // Two days have passed since, both missed and both in the past.
    expect(scheduledStreak(habit, checkins, d('2026-08-13'), NY)).toEqual({
      current: 0,
      longest: 2,
    })
  })
})

describe('scheduledStreak — today is pending, not missed', () => {
  it('keeps the streak intact when today is scheduled but not yet done', () => {
    // Without this rule every streak in the app would read zero each morning.
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-14', '2026-08-15'])
    expect(scheduledStreak(habit, checkins, d('2026-08-16'), NY).current).toBe(2)
  })

  it('extends the streak once today is checked off', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-14', '2026-08-15', '2026-08-16'])
    expect(scheduledStreak(habit, checkins, d('2026-08-16'), NY).current).toBe(3)
  })

  it('still counts yesterday as a genuine miss', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-13', '2026-08-14'])
    // The 15th was due and missed; the 16th is today and pending.
    expect(scheduledStreak(habit, checkins, d('2026-08-16'), NY).current).toBe(0)
  })

  it('is unaffected when today is not a scheduled day', () => {
    const habit = scheduledHabit(WEEKDAYS_ONLY)
    const checkins = checkinsOn(habit, ['2026-08-13', '2026-08-14'])
    // Saturday: nothing due, so Thu+Fri still stand.
    expect(scheduledStreak(habit, checkins, d('2026-08-15'), NY).current).toBe(2)
  })
})

describe('scheduledStreak — edge cases', () => {
  it('is zero with no check-ins', () => {
    expect(scheduledStreak(scheduledHabit(EVERY_DAY), [], d('2026-08-16'), NY)).toEqual({
      current: 0,
      longest: 0,
    })
  })

  it('is zero for a weekly-target habit, which has no daily streak', () => {
    const habit = weeklyHabit(3)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-11', '2026-08-12'])
    expect(scheduledStreak(habit, checkins, d('2026-08-13'), NY)).toEqual({
      current: 0,
      longest: 0,
    })
  })

  it('handles a single completion', () => {
    const habit = scheduledHabit(EVERY_DAY)
    expect(
      scheduledStreak(habit, checkinsOn(habit, ['2026-08-16']), d('2026-08-16'), NY),
    ).toEqual({ current: 1, longest: 1 })
  })

  it('ignores check-ins dated after the reference day', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-16', '2026-08-17', '2026-08-18'])
    expect(scheduledStreak(habit, checkins, d('2026-08-16'), NY).current).toBe(1)
  })

  it('is zero when every check-in is in the future', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-20'])
    expect(scheduledStreak(habit, checkins, d('2026-08-16'), NY).current).toBe(0)
  })

  it('is still computed for an archived habit, so history stays readable', () => {
    // Archiving hides a habit from Today, but its detail page should still show
    // what the streak was when it was retired.
    const habit = scheduledHabit(EVERY_DAY, { active: false })
    const checkins = checkinsOn(habit, ['2026-08-14', '2026-08-15', '2026-08-16'])
    expect(scheduledStreak(habit, checkins, d('2026-08-16'), NY).current).toBe(3)
  })

  it('counts correctly across a DST spring-forward', () => {
    // US DST begins 2026-03-08 (a 23-hour day). Every day in the run must still
    // be one calendar day apart.
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, [
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
    expect(scheduledStreak(habit, checkins, d('2026-03-10'), NY).current).toBe(5)
  })

  it('counts correctly across a DST fall-back', () => {
    // US DST ends 2026-11-01 (a 25-hour day).
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, [
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
    expect(scheduledStreak(habit, checkins, d('2026-11-02'), NY).current).toBe(4)
  })

  it('counts correctly across a year boundary', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, [
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ])
    expect(scheduledStreak(habit, checkins, d('2027-01-02'), NY).current).toBe(4)
  })

  it('handles a long run without drifting', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const dates = Array.from({ length: 200 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000)
      return date.toISOString().slice(0, 10)
    })
    const last = dates[dates.length - 1] as string
    expect(scheduledStreak(habit, checkinsOn(habit, dates), d(last), NY)).toEqual({
      current: 200,
      longest: 200,
    })
  })
})

describe('scheduledStreak — excused days are neutral', () => {
  it('keeps a Mon–Fri streak alive across an excused Wednesday', () => {
    // The exact example from the spec: Mon ✓ Tue ✓ Wed ❄️ Thu ✓ Fri ✓ is a streak of
    // four completed occurrences — Wednesday neither counts nor breaks.
    const habit = scheduledHabit(WEEKDAYS_ONLY)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-11', '2026-08-13', '2026-08-14'])
    const days = excusedOn(habit, ['2026-08-12'])

    expect(scheduledStreak(habit, checkins, d('2026-08-14'), NY, days)).toEqual({
      current: 4,
      longest: 4,
    })
  })

  it('does not increment the streak for the excused day itself', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-14', '2026-08-16'])
    const days = excusedOn(habit, ['2026-08-15'])

    // Two completions, one excused day in between: two, not three.
    expect(scheduledStreak(habit, checkins, d('2026-08-16'), NY, days).current).toBe(2)
  })

  it('still breaks on a genuine miss next to an excused day', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-11', '2026-08-14'])
    const days = excusedOn(habit, ['2026-08-12'])
    // The 13th was due, not excused, and not done.
    expect(scheduledStreak(habit, checkins, d('2026-08-14'), NY, days).current).toBe(1)
  })

  it('an excused today does not break a streak either', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-14', '2026-08-15'])
    const days = excusedOn(habit, ['2026-08-16'])
    expect(scheduledStreak(habit, checkins, d('2026-08-16'), NY, days).current).toBe(2)
  })

  it('behaves exactly as before when there are no excused days', () => {
    const habit = scheduledHabit(WEEKDAYS_ONLY)
    const checkins = checkinsOn(habit, ['2026-08-14', '2026-08-17', '2026-08-18'])
    expect(scheduledStreak(habit, checkins, d('2026-08-18'), NY, []).current).toBe(3)
  })
})

describe('avoidStreak', () => {
  // Created well before the test window so the creation-date bound is not the thing
  // under test here.
  const early = { created_at: '2026-07-01T12:00:00Z' }

  it('counts finished days with no lapse, and does not count today', () => {
    // Aug 10..15 finished cleanly; the 16th is today and still going.
    const habit = avoidHabit(EVERY_DAY, early)
    const result = avoidStreak(habit, [], d('2026-08-16'), NY)

    expect(result.stillGoingToday).toBe(true)
    // Jul 1 .. Aug 15 inclusive is 46 finished days, all clean.
    expect(result.current).toBe(46)
  })

  it('does not prematurely count today as a success', () => {
    // The spec is explicit: 12 finished days plus an unfinished today is
    // "12 days • still going", never 13.
    const habit = avoidHabit(EVERY_DAY, { created_at: '2026-08-04T12:00:00Z' })
    const result = avoidStreak(habit, [], d('2026-08-16'), NY)

    expect(result.current).toBe(12) // Aug 4..15
    expect(result.stillGoingToday).toBe(true)
  })

  it('resets when a lapse is logged today', () => {
    const habit = avoidHabit(EVERY_DAY, { created_at: '2026-08-04T12:00:00Z' })
    const result = avoidStreak(habit, lapsedOn(habit, ['2026-08-16']), d('2026-08-16'), NY)

    expect(result.current).toBe(0)
    expect(result.stillGoingToday).toBe(false)
    expect(result.longest).toBe(12)
  })

  it('restarts after a lapse in the past', () => {
    const habit = avoidHabit(EVERY_DAY, { created_at: '2026-08-01T12:00:00Z' })
    const result = avoidStreak(habit, lapsedOn(habit, ['2026-08-12']), d('2026-08-16'), NY)

    expect(result.current).toBe(3) // 13, 14, 15 — today is still going
    expect(result.longest).toBe(11) // Aug 1..11
  })

  it('treats an excused day as neutral', () => {
    const habit = avoidHabit(EVERY_DAY, { created_at: '2026-08-10T12:00:00Z' })
    const days = excusedOn(habit, ['2026-08-13'])
    const result = avoidStreak(habit, days, d('2026-08-16'), NY)

    // Aug 10,11,12,14,15 are clean finished days; the 13th is neutral, not a break.
    expect(result.current).toBe(5)
  })

  it('never counts days before the habit existed', () => {
    // Without the creation-date bound this would report an enormous streak, because
    // success is the absence of a record.
    const habit = avoidHabit(EVERY_DAY, { created_at: '2026-08-14T12:00:00Z' })
    const result = avoidStreak(habit, [], d('2026-08-16'), NY)
    expect(result.current).toBe(2) // the 14th and 15th only
  })

  it('skips unscheduled days without breaking the streak', () => {
    const habit = avoidHabit(WEEKDAYS_ONLY, { created_at: '2026-08-03T12:00:00Z' })
    // Mon 10th is today; the weekend was never scheduled.
    const result = avoidStreak(habit, [], d('2026-08-10'), NY)
    expect(result.current).toBe(5) // Aug 3..7, the previous working week
    expect(result.stillGoingToday).toBe(true)
  })

  it('is not still going on an unscheduled day', () => {
    const habit = avoidHabit(WEEKDAYS_ONLY, { created_at: '2026-08-03T12:00:00Z' })
    const result = avoidStreak(habit, [], d('2026-08-16'), NY) // a Sunday
    expect(result.stillGoingToday).toBe(false)
  })

  it('counts correctly across a DST transition', () => {
    // US DST ends 2026-11-01, a 25-hour day.
    const habit = avoidHabit(EVERY_DAY, { created_at: '2026-10-28T12:00:00Z' })
    const result = avoidStreak(habit, [], d('2026-11-03'), NY)
    expect(result.current).toBe(6) // Oct 28..Nov 2
  })

  it('counts correctly across a year boundary', () => {
    const habit = avoidHabit(EVERY_DAY, { created_at: '2026-12-28T12:00:00Z' })
    const result = avoidStreak(habit, [], d('2027-01-03'), NY)
    expect(result.current).toBe(6) // Dec 28..Jan 2
  })

  it('is zero for a do-habit, which uses scheduledStreak instead', () => {
    const habit = scheduledHabit(EVERY_DAY)
    expect(avoidStreak(habit, [], d('2026-08-16'), NY)).toEqual({
      current: 0,
      longest: 0,
      stillGoingToday: false,
    })
  })

  it('and scheduledStreak is zero for an avoid habit', () => {
    const habit = avoidHabit(EVERY_DAY, early)
    expect(scheduledStreak(habit, [], d('2026-08-16'), NY)).toEqual({ current: 0, longest: 0 })
  })

  it('an at-risk marker alone does not affect the streak', () => {
    const habit = avoidHabit(EVERY_DAY, { created_at: '2026-08-10T12:00:00Z' })
    const days = [habitDay(habit, '2026-08-16', { at_risk_at: '2026-08-16T12:00:00Z' })]
    expect(avoidStreak(habit, days, d('2026-08-16'), NY).current).toBe(6)
  })
})

describe('recentWeeks', () => {
  const habit = weeklyHabit(3)

  it('returns the requested number of weeks, oldest first, ending this week', () => {
    const weeks = recentWeeks(habit, [], d('2026-08-13'), NY, 3)
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-07-27', '2026-08-03', '2026-08-10'])
    expect(weeks[2]?.isCurrent).toBe(true)
    expect(weeks[0]?.isCurrent).toBe(false)
  })

  it('counts each week independently', () => {
    const checkins = checkinsOn(habit, [
      '2026-08-03',
      '2026-08-05',
      '2026-08-07', // previous week: 3/3
      '2026-08-11', // current week: 1/3
    ])
    const weeks = recentWeeks(habit, checkins, d('2026-08-13'), NY, 2)
    expect(weeks[0]).toMatchObject({ completed: 3, target: 3, met: true })
    expect(weeks[1]).toMatchObject({ completed: 1, target: 3, met: false })
  })
})

describe('weeklyStreak', () => {
  const habit = weeklyHabit(2)

  it('counts consecutive weeks that met their target', () => {
    const checkins = checkinsOn(habit, [
      '2026-07-27', '2026-07-28', // week of Jul 27: 2/2
      '2026-08-03', '2026-08-05', // week of Aug 3:  2/2
      '2026-08-10', '2026-08-12', // week of Aug 10: 2/2 (current)
    ])
    expect(weeklyStreak(habit, checkins, d('2026-08-13'), NY)).toBe(3)
  })

  it('does not punish a current week that is still in progress', () => {
    // Monday morning must not appear to wipe out weeks of consistency.
    const checkins = checkinsOn(habit, [
      '2026-07-27', '2026-07-28',
      '2026-08-03', '2026-08-05',
      '2026-08-10', // current week: only 1/2 so far
    ])
    expect(weeklyStreak(habit, checkins, d('2026-08-12'), NY)).toBe(2)
  })

  it('breaks on a week that fell short', () => {
    const checkins = checkinsOn(habit, [
      '2026-07-27', '2026-07-28', // met
      '2026-08-03', // missed target
      '2026-08-10', '2026-08-11', // met (current)
    ])
    expect(weeklyStreak(habit, checkins, d('2026-08-13'), NY)).toBe(1)
  })

  it('is zero with no check-ins, and zero for scheduled habits', () => {
    expect(weeklyStreak(habit, [], d('2026-08-13'), NY)).toBe(0)
    const scheduled = scheduledHabit(EVERY_DAY)
    expect(
      weeklyStreak(scheduled, checkinsOn(scheduled, ['2026-08-13']), d('2026-08-13'), NY),
    ).toBe(0)
  })
})

describe('summarizeRange', () => {
  it('counts completions and scheduled occurrences in the window', () => {
    const habit = scheduledHabit(WEEKDAYS_ONLY)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-11', '2026-08-14'])
    // Aug 10–16 inclusive is one week: 5 weekdays scheduled, 3 completed.
    expect(summarizeRange(habit, checkins, d('2026-08-16'), NY, 7)).toEqual({
      completed: 3,
      scheduled: 5,
      excused: 0,
      days: 7,
    })
  })

  it('drops excused occurrences from the denominator', () => {
    // Being ill on Wednesday should not make the week look worse than it was.
    const habit = scheduledHabit(WEEKDAYS_ONLY)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-11', '2026-08-14'])
    const days = excusedOn(habit, ['2026-08-12'])

    expect(summarizeRange(habit, checkins, d('2026-08-16'), NY, 7, days)).toEqual({
      completed: 3,
      scheduled: 4, // 5 weekdays minus the excused one
      excused: 1,
      days: 7,
    })
  })

  it('excludes completions outside the window', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-01', '2026-08-15', '2026-08-16'])
    expect(summarizeRange(habit, checkins, d('2026-08-16'), NY, 7).completed).toBe(2)
  })

  it('reports no scheduled occurrences for a weekly-target habit', () => {
    const habit = weeklyHabit(3)
    const checkins = checkinsOn(habit, ['2026-08-14', '2026-08-16'])
    expect(summarizeRange(habit, checkins, d('2026-08-16'), NY, 7)).toEqual({
      completed: 2,
      scheduled: 0,
      excused: 0,
      days: 7,
    })
  })
})

describe('recentCheckins', () => {
  it('returns the newest first and respects the limit', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-16', '2026-08-13'])
    expect(recentCheckins(checkins, 2).map((c) => c.completion_date)).toEqual([
      '2026-08-16',
      '2026-08-13',
    ])
  })

  it('does not mutate its input', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-16'])
    const before = checkins.map((c) => c.completion_date)
    recentCheckins(checkins)
    expect(checkins.map((c) => c.completion_date)).toEqual(before)
  })
})

describe('daysSinceLastCheckin', () => {
  it('measures from the most recent completion', () => {
    const habit = scheduledHabit(EVERY_DAY)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-13'])
    expect(daysSinceLastCheckin(checkins, d('2026-08-16'), NY)).toBe(3)
  })

  it('is zero when completed today, and null when never completed', () => {
    const habit = scheduledHabit(EVERY_DAY)
    expect(daysSinceLastCheckin(checkinsOn(habit, ['2026-08-16']), d('2026-08-16'), NY)).toBe(0)
    expect(daysSinceLastCheckin([], d('2026-08-16'), NY)).toBeNull()
  })
})
