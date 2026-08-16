import { describe, expect, it } from 'vitest'
import {
  appearsOn,
  checkinsByHabit,
  describeDailyProgress,
  describeRecurrence,
  isCompletedOn,
  isScheduledOn,
  weeklyProgress,
} from './recurrence'
import {
  EVERY_DAY,
  WEEKDAYS_ONLY,
  checkinsOn,
  d,
  scheduledHabit,
  weeklyHabit,
} from './testFixtures'

const NY = 'America/New_York'

// Reference dates used throughout:
//   2026-08-10 Mon   2026-08-14 Fri
//   2026-08-11 Tue   2026-08-15 Sat
//   2026-08-12 Wed   2026-08-16 Sun
//   2026-08-13 Thu   2026-08-17 Mon (next week)

describe('isScheduledOn', () => {
  it('is true only on the habit’s selected weekdays', () => {
    const habit = scheduledHabit(WEEKDAYS_ONLY)
    expect(isScheduledOn(habit, d('2026-08-14'), NY)).toBe(true) // Friday
    expect(isScheduledOn(habit, d('2026-08-15'), NY)).toBe(false) // Saturday
    expect(isScheduledOn(habit, d('2026-08-16'), NY)).toBe(false) // Sunday
    expect(isScheduledOn(habit, d('2026-08-17'), NY)).toBe(true) // Monday
  })

  it('is true every day for an every-day habit', () => {
    const habit = scheduledHabit(EVERY_DAY)
    for (const date of ['2026-08-10', '2026-08-15', '2026-08-16']) {
      expect(isScheduledOn(habit, d(date), NY)).toBe(true)
    }
  })

  it('handles a single-day habit', () => {
    const sundays = scheduledHabit([7])
    expect(isScheduledOn(sundays, d('2026-08-16'), NY)).toBe(true)
    expect(isScheduledOn(sundays, d('2026-08-17'), NY)).toBe(false)
  })

  it('is always false for a weekly-target habit, which has no scheduled days', () => {
    const habit = weeklyHabit(3)
    expect(isScheduledOn(habit, d('2026-08-10'), NY)).toBe(false)
    expect(isScheduledOn(habit, d('2026-08-16'), NY)).toBe(false)
  })

  it('resolves the weekday in the owner’s timezone', () => {
    const sundays = scheduledHabit([7])
    // 2026-08-17 is Monday in New York but the habit is scheduled for Sundays;
    // the same calendar string in another zone is still that calendar day.
    expect(isScheduledOn(sundays, d('2026-08-16'), 'Asia/Tokyo')).toBe(true)
    expect(isScheduledOn(sundays, d('2026-08-17'), 'Asia/Tokyo')).toBe(false)
  })
})

describe('appearsOn', () => {
  it('hides archived habits entirely', () => {
    const archived = scheduledHabit(EVERY_DAY, { active: false })
    expect(appearsOn(archived, d('2026-08-16'), NY)).toBe(false)
  })

  it('hides an archived weekly habit too', () => {
    const archived = weeklyHabit(3, { active: false })
    expect(appearsOn(archived, d('2026-08-16'), NY)).toBe(false)
  })

  it('shows a weekday habit on weekdays and hides it at the weekend', () => {
    const habit = scheduledHabit(WEEKDAYS_ONLY)
    expect(appearsOn(habit, d('2026-08-14'), NY)).toBe(true)
    expect(appearsOn(habit, d('2026-08-15'), NY)).toBe(false)
  })

  it('shows a weekly-target habit every day of the week', () => {
    const habit = weeklyHabit(3)
    for (const date of ['2026-08-10', '2026-08-13', '2026-08-16']) {
      expect(appearsOn(habit, d(date), NY)).toBe(true)
    }
  })

  it('keeps a weekly-target habit visible after its target is met', () => {
    // The spec is explicit: it stays on Today in a completed state rather than
    // disappearing mid-week.
    const habit = weeklyHabit(2)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-11'])
    expect(weeklyProgress(habit, checkins, d('2026-08-14'), NY).met).toBe(true)
    expect(appearsOn(habit, d('2026-08-14'), NY)).toBe(true)
  })
})

describe('weeklyProgress', () => {
  const habit = weeklyHabit(3)

  it('counts completions on any day of the week', () => {
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-13', '2026-08-16'])
    expect(weeklyProgress(habit, checkins, d('2026-08-14'), NY)).toEqual({
      completed: 3,
      target: 3,
      remaining: 0,
      met: true,
    })
  })

  it('reports what is still outstanding', () => {
    const checkins = checkinsOn(habit, ['2026-08-11'])
    expect(weeklyProgress(habit, checkins, d('2026-08-13'), NY)).toEqual({
      completed: 1,
      target: 3,
      remaining: 2,
      met: false,
    })
  })

  it('does not count check-ins from the previous week', () => {
    // Mon 10th – Sun 16th is one week; the 9th is the previous Sunday.
    const checkins = checkinsOn(habit, ['2026-08-08', '2026-08-09', '2026-08-10'])
    expect(weeklyProgress(habit, checkins, d('2026-08-12'), NY).completed).toBe(1)
  })

  it('does not count check-ins from the following week', () => {
    const checkins = checkinsOn(habit, ['2026-08-16', '2026-08-17', '2026-08-18'])
    expect(weeklyProgress(habit, checkins, d('2026-08-12'), NY).completed).toBe(1)
  })

  it('resets at the Monday boundary', () => {
    // Three completions Mon–Sun, then a new week begins with nothing.
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-13', '2026-08-16'])
    expect(weeklyProgress(habit, checkins, d('2026-08-16'), NY).completed).toBe(3)
    expect(weeklyProgress(habit, checkins, d('2026-08-17'), NY).completed).toBe(0)
    expect(weeklyProgress(habit, checkins, d('2026-08-17'), NY).met).toBe(false)
  })

  it('counts a Sunday check-in in the week that is ending, not the one starting', () => {
    const checkins = checkinsOn(habit, ['2026-08-16'])
    expect(weeklyProgress(habit, checkins, d('2026-08-10'), NY).completed).toBe(1)
    expect(weeklyProgress(habit, checkins, d('2026-08-17'), NY).completed).toBe(0)
  })

  it('never reports negative remaining when the target is exceeded', () => {
    const twice = weeklyHabit(2)
    const checkins = checkinsOn(twice, ['2026-08-10', '2026-08-11', '2026-08-12'])
    expect(weeklyProgress(twice, checkins, d('2026-08-13'), NY)).toEqual({
      completed: 3,
      target: 2,
      remaining: 0,
      met: true,
    })
  })

  it('is not met when there are no check-ins', () => {
    expect(weeklyProgress(habit, [], d('2026-08-13'), NY)).toEqual({
      completed: 0,
      target: 3,
      remaining: 3,
      met: false,
    })
  })
})

describe('isCompletedOn', () => {
  const habit = scheduledHabit(EVERY_DAY)

  it('matches an exact date', () => {
    const checkins = checkinsOn(habit, ['2026-08-16'])
    expect(isCompletedOn(checkins, d('2026-08-16'))).toBe(true)
    expect(isCompletedOn(checkins, d('2026-08-15'))).toBe(false)
  })

  it('is false with no check-ins at all', () => {
    expect(isCompletedOn([], d('2026-08-16'))).toBe(false)
  })
})

describe('checkinsByHabit', () => {
  it('groups check-ins by habit and leaves unknown habits absent', () => {
    const a = scheduledHabit(EVERY_DAY, { id: 'a' })
    const b = scheduledHabit(EVERY_DAY, { id: 'b' })
    const grouped = checkinsByHabit([
      ...checkinsOn(a, ['2026-08-15', '2026-08-16']),
      ...checkinsOn(b, ['2026-08-16']),
    ])
    expect(grouped.get('a')).toHaveLength(2)
    expect(grouped.get('b')).toHaveLength(1)
    expect(grouped.get('c')).toBeUndefined()
  })
})

describe('describeRecurrence', () => {
  it('names the common schedules', () => {
    expect(describeRecurrence(scheduledHabit(EVERY_DAY))).toBe('Every day')
    expect(describeRecurrence(scheduledHabit(WEEKDAYS_ONLY))).toBe('Weekdays')
    expect(describeRecurrence(scheduledHabit([6, 7]))).toBe('Weekends')
  })

  it('renders a consecutive run as a range', () => {
    expect(describeRecurrence(scheduledHabit([1, 2, 3, 4]))).toBe('Mon–Thu')
  })

  it('renders one day as a plural', () => {
    expect(describeRecurrence(scheduledHabit([7]))).toBe('Sundays')
  })

  it('renders two days with an ampersand', () => {
    expect(describeRecurrence(scheduledHabit([2, 6]))).toBe('Tue & Sat')
  })

  it('lists scattered days', () => {
    expect(describeRecurrence(scheduledHabit([1, 3, 5]))).toBe('Mon, Wed, Fri')
  })

  it('describes weekly targets', () => {
    expect(describeRecurrence(weeklyHabit(3))).toBe('3× per week')
    expect(describeRecurrence(weeklyHabit(1))).toBe('Once per week')
  })
})

describe('describeDailyProgress', () => {
  it('reads naturally at each stage', () => {
    expect(describeDailyProgress(0, 0)).toBe('Nothing due today')
    expect(describeDailyProgress(2, 4)).toBe('2 of 4 completed today')
    expect(describeDailyProgress(4, 4)).toBe('All 4 done today')
  })
})
