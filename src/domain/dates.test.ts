import { describe, expect, it } from 'vitest'
import {
  addDays,
  asLocalDate,
  dateRange,
  daysBetween,
  endOfWeek,
  formatLongDate,
  formatRelativeDay,
  formatWeekRange,
  isSameWeek,
  isValidTimezone,
  monthGrid,
  safeZone,
  startOfWeek,
  todayIn,
  weekDates,
  weekdayOf,
} from './dates'

const NY = 'America/New_York'
const LONDON = 'Europe/London'
const TOKYO = 'Asia/Tokyo'
const d = asLocalDate

describe('todayIn', () => {
  it('uses the local calendar day, not the UTC day', () => {
    // 2026-08-17T02:30:00Z is still 10:30pm on the 16th in New York.
    const nearMidnight = new Date('2026-08-17T02:30:00Z')
    expect(todayIn(NY, nearMidnight)).toBe('2026-08-16')
    expect(todayIn(LONDON, nearMidnight)).toBe('2026-08-17')
  })

  it('a check-in at 11:30pm local belongs to that day, not the next', () => {
    // The exact bug the product spec calls out: 11:30pm in New York during EDT is
    // 03:30 UTC the following day. Naive UTC handling would file it under tomorrow.
    const lateEvening = new Date('2026-08-17T03:30:00Z')
    expect(todayIn(NY, lateEvening)).toBe('2026-08-16')
  })

  it('a check-in just after midnight local belongs to the new day', () => {
    const justAfterMidnight = new Date('2026-08-17T04:05:00Z') // 12:05am EDT
    expect(todayIn(NY, justAfterMidnight)).toBe('2026-08-17')
  })

  it('handles timezones ahead of UTC', () => {
    const evening = new Date('2026-08-16T16:00:00Z') // 1am on the 17th in Tokyo
    expect(todayIn(TOKYO, evening)).toBe('2026-08-17')
    expect(todayIn(NY, evening)).toBe('2026-08-16')
  })
})

describe('weekdayOf', () => {
  it('uses ISO weekdays, 1 = Monday through 7 = Sunday', () => {
    expect(weekdayOf(d('2026-08-17'), NY)).toBe(1) // Monday
    expect(weekdayOf(d('2026-08-21'), NY)).toBe(5) // Friday
    expect(weekdayOf(d('2026-08-22'), NY)).toBe(6) // Saturday
    expect(weekdayOf(d('2026-08-16'), NY)).toBe(7) // Sunday
  })
})

describe('addDays', () => {
  it('moves whole calendar days', () => {
    expect(addDays(d('2026-08-16'), 1, NY)).toBe('2026-08-17')
    expect(addDays(d('2026-08-16'), -1, NY)).toBe('2026-08-15')
    expect(addDays(d('2026-08-16'), 0, NY)).toBe('2026-08-16')
  })

  it('crosses month and year boundaries', () => {
    expect(addDays(d('2026-08-31'), 1, NY)).toBe('2026-09-01')
    expect(addDays(d('2026-12-31'), 1, NY)).toBe('2027-01-01')
    expect(addDays(d('2026-01-01'), -1, NY)).toBe('2025-12-31')
  })

  it('handles leap days', () => {
    expect(addDays(d('2028-02-28'), 1, NY)).toBe('2028-02-29')
    expect(addDays(d('2027-02-28'), 1, NY)).toBe('2027-03-01')
  })

  it('still advances exactly one calendar day across a DST spring-forward', () => {
    // US DST begins 2026-03-08. That day is only 23 hours long; adding "1 day"
    // must still land on the 8th, not on the 7th at 11pm.
    expect(addDays(d('2026-03-07'), 1, NY)).toBe('2026-03-08')
    expect(addDays(d('2026-03-08'), 1, NY)).toBe('2026-03-09')
  })

  it('still advances exactly one calendar day across a DST fall-back', () => {
    // US DST ends 2026-11-01, a 25-hour day.
    expect(addDays(d('2026-10-31'), 1, NY)).toBe('2026-11-01')
    expect(addDays(d('2026-11-01'), 1, NY)).toBe('2026-11-02')
  })

  it('handles a southern-hemisphere DST transition too', () => {
    // Australian DST starts 2026-10-04.
    expect(addDays(d('2026-10-03'), 1, 'Australia/Sydney')).toBe('2026-10-04')
    expect(addDays(d('2026-10-04'), 1, 'Australia/Sydney')).toBe('2026-10-05')
  })
})

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween(d('2026-08-16'), d('2026-08-20'), NY)).toBe(4)
    expect(daysBetween(d('2026-08-20'), d('2026-08-16'), NY)).toBe(-4)
    expect(daysBetween(d('2026-08-16'), d('2026-08-16'), NY)).toBe(0)
  })

  it('is not thrown off by DST-shortened or -lengthened days', () => {
    // Spanning both US transitions: 23-hour and 25-hour days must still count as 1.
    expect(daysBetween(d('2026-03-07'), d('2026-03-09'), NY)).toBe(2)
    expect(daysBetween(d('2026-10-31'), d('2026-11-02'), NY)).toBe(2)
    // A full year across both transitions.
    expect(daysBetween(d('2026-01-01'), d('2027-01-01'), NY)).toBe(365)
  })
})

describe('startOfWeek / endOfWeek', () => {
  it('treats Monday as the first day of the week', () => {
    expect(startOfWeek(d('2026-08-16'), NY)).toBe('2026-08-10') // Sunday -> previous Monday
    expect(startOfWeek(d('2026-08-10'), NY)).toBe('2026-08-10') // Monday -> itself
    expect(startOfWeek(d('2026-08-13'), NY)).toBe('2026-08-10') // Thursday
  })

  it('treats Sunday as the last day of the week', () => {
    expect(endOfWeek(d('2026-08-10'), NY)).toBe('2026-08-16')
    expect(endOfWeek(d('2026-08-16'), NY)).toBe('2026-08-16')
  })

  it('produces seven consecutive dates starting on Monday', () => {
    expect(weekDates(d('2026-08-13'), NY)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ])
  })

  it('spans a DST transition without losing or duplicating a day', () => {
    expect(weekDates(d('2026-11-01'), NY)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ])
  })
})

describe('isSameWeek', () => {
  it('groups Monday through Sunday together', () => {
    expect(isSameWeek(d('2026-08-10'), d('2026-08-16'), NY)).toBe(true)
  })

  it('separates Sunday from the following Monday', () => {
    // The week boundary that a weekly-target counter resets on.
    expect(isSameWeek(d('2026-08-16'), d('2026-08-17'), NY)).toBe(false)
  })
})

describe('dateRange', () => {
  it('is inclusive at both ends', () => {
    expect(dateRange(d('2026-08-14'), d('2026-08-16'), NY)).toEqual([
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ])
  })

  it('returns a single date when the ends match', () => {
    expect(dateRange(d('2026-08-16'), d('2026-08-16'), NY)).toEqual(['2026-08-16'])
  })

  it('returns nothing when the range is inverted', () => {
    expect(dateRange(d('2026-08-16'), d('2026-08-14'), NY)).toEqual([])
  })
})

describe('timezone validation', () => {
  it('accepts real IANA names and rejects nonsense', () => {
    expect(isValidTimezone(NY)).toBe(true)
    expect(isValidTimezone('Europe/London')).toBe(true)
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })

  it('falls back rather than producing invalid dates', () => {
    expect(isValidTimezone(safeZone('Mars/Olympus_Mons'))).toBe(true)
    expect(isValidTimezone(safeZone(null))).toBe(true)
    expect(safeZone(NY)).toBe(NY)
  })
})

describe('formatting', () => {
  it('formats the Today heading', () => {
    expect(formatLongDate(d('2026-08-16'), NY)).toBe('Sunday, August 16')
  })

  it('formats a week range, omitting the repeated month', () => {
    expect(formatWeekRange(d('2026-08-13'), NY)).toBe('Aug 10 – 16')
  })

  it('includes both months when a week spans two', () => {
    expect(formatWeekRange(d('2026-09-02'), NY)).toBe('Aug 31 – Sep 6')
  })

  it('says Today and Yesterday before falling back to a date', () => {
    const today = d('2026-08-16')
    expect(formatRelativeDay(today, today, NY)).toBe('Today')
    expect(formatRelativeDay(d('2026-08-15'), today, NY)).toBe('Yesterday')
    expect(formatRelativeDay(d('2026-08-12'), today, NY)).toBe('Aug 12')
  })
})

describe('monthGrid', () => {
  it('pads so that columns line up under Monday-first headings', () => {
    // August 2026 starts on a Saturday and has 31 days.
    const grid = monthGrid(d('2026-08-16'), NY)
    expect(grid[0]).toEqual([null, null, null, null, null, '2026-08-01', '2026-08-02'])
    expect(grid.every((row) => row.length === 7)).toBe(true)
    expect(grid.flat().filter(Boolean)).toHaveLength(31)
  })

  it('needs no leading padding for a month starting on Monday', () => {
    // June 2026 starts on a Monday.
    const grid = monthGrid(d('2026-06-15'), NY)
    expect(grid[0]?.[0]).toBe('2026-06-01')
  })

  it('includes the leap day in February of a leap year', () => {
    expect(monthGrid(d('2028-02-10'), NY).flat().filter(Boolean)).toHaveLength(29)
  })
})
