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
  checkinsOn,
  d,
  scheduledHabit,
  weeklyHabit,
} from './testFixtures'

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
