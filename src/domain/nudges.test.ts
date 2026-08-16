import { describe, expect, it } from 'vitest'
import { NUDGE_COOLDOWN_MS, describeNudgeBlock, nudgeAvailability } from './nudges'
import type { NudgeContext } from './nudges'
import { buildDayLookup } from './dayState'
import {
  EVERY_DAY,
  WEEKDAYS_ONLY,
  avoidHabit,
  checkinsOn,
  d,
  excusedOn,
  habitDay,
  lapsedOn,
  nudge,
  scheduledHabit,
  weeklyHabit,
} from './testFixtures'

const NY = 'America/New_York'
const TODAY = d('2026-08-16') // Sunday
const OWNER = 'owner-1'
const VIEWER = 'viewer-1'
const EARLY = { created_at: '2026-01-01T12:00:00Z', owner_id: OWNER }
const NOW = new Date('2026-08-16T18:00:00Z')

function ctx(overrides: Partial<NudgeContext> = {}): NudgeContext {
  return {
    viewerId: VIEWER,
    ownerToday: TODAY,
    ownerZone: NY,
    lookup: buildDayLookup([], []),
    checkins: [],
    atRisk: false,
    sentNudges: [],
    ownerLocalTime: '14:00',
    now: NOW,
    ...overrides,
  }
}

describe('nudgeAvailability — the happy path', () => {
  it('allows nudging a friend’s pending shared habit', () => {
    const habit = scheduledHabit(EVERY_DAY, EARLY)
    expect(nudgeAvailability(habit, ctx())).toEqual({
      allowed: true,
      reason: null,
      availableAt: null,
    })
  })
})

describe('nudgeAvailability — who and what', () => {
  it('refuses your own habit', () => {
    const habit = scheduledHabit(EVERY_DAY, EARLY)
    expect(nudgeAvailability(habit, ctx({ viewerId: OWNER })).reason).toBe('own-habit')
  })

  it('refuses a private habit', () => {
    // Belt and braces: RLS means a friend's private habit never reaches this
    // browser at all, so this branch should be unreachable in practice.
    const habit = scheduledHabit(EVERY_DAY, { ...EARLY, visibility: 'private' })
    expect(nudgeAvailability(habit, ctx()).reason).toBe('not-shared')
  })

  it('refuses an archived habit', () => {
    const habit = scheduledHabit(EVERY_DAY, { ...EARLY, active: false })
    expect(nudgeAvailability(habit, ctx()).reason).toBe('inactive')
  })

  it('refuses a habit not scheduled today', () => {
    const habit = scheduledHabit(WEEKDAYS_ONLY, EARLY) // today is Sunday
    expect(nudgeAvailability(habit, ctx()).reason).toBe('not-today')
  })
})

describe('nudgeAvailability — already satisfied', () => {
  it('refuses a completed habit', () => {
    const habit = scheduledHabit(EVERY_DAY, EARLY)
    const lookup = buildDayLookup(checkinsOn(habit, ['2026-08-16']), [])
    expect(nudgeAvailability(habit, ctx({ lookup })).reason).toBe('satisfied')
  })

  it('refuses a weekly habit that has hit its target', () => {
    const habit = weeklyHabit(2, EARLY)
    const checkins = checkinsOn(habit, ['2026-08-10', '2026-08-11'])
    expect(nudgeAvailability(habit, ctx({ checkins })).reason).toBe('satisfied')
  })

  it('allows a weekly habit still short of its target', () => {
    const habit = weeklyHabit(3, EARLY)
    const checkins = checkinsOn(habit, ['2026-08-10'])
    expect(nudgeAvailability(habit, ctx({ checkins })).allowed).toBe(true)
  })

  it('refuses an excused day', () => {
    const habit = scheduledHabit(EVERY_DAY, EARLY)
    const lookup = buildDayLookup([], excusedOn(habit, ['2026-08-16']))
    expect(nudgeAvailability(habit, ctx({ lookup })).reason).toBe('excused')
  })
})

describe('nudgeAvailability — avoidance habits', () => {
  it('allows encouragement while the day is still going', () => {
    const habit = avoidHabit(EVERY_DAY, EARLY)
    expect(nudgeAvailability(habit, ctx()).allowed).toBe(true)
  })

  it('refuses once a slip has been logged', () => {
    // Deliberate product decision: piling on after someone admits a lapse is
    // exactly what this app should not do.
    const habit = avoidHabit(EVERY_DAY, EARLY)
    const lookup = buildDayLookup([], lapsedOn(habit, ['2026-08-16']))
    expect(nudgeAvailability(habit, ctx({ lookup })).reason).toBe('lapsed')
  })
})

describe('nudgeAvailability — the owner’s policy', () => {
  it('refuses when the owner set nudges to never', () => {
    const habit = scheduledHabit(EVERY_DAY, { ...EARLY, nudge_policy: 'never' })
    expect(nudgeAvailability(habit, ctx()).reason).toBe('policy')
  })

  it('refuses at_risk_only until the owner asks for a push', () => {
    const habit = scheduledHabit(EVERY_DAY, { ...EARLY, nudge_policy: 'at_risk_only' })
    expect(nudgeAvailability(habit, ctx()).reason).toBe('policy')
    expect(nudgeAvailability(habit, ctx({ atRisk: true })).allowed).toBe(true)
  })

  it('respects a preferred time in the owner’s timezone', () => {
    const habit = scheduledHabit(EVERY_DAY, {
      ...EARLY,
      nudge_policy: 'after_time',
      nudge_after_time: '18:00:00',
    })
    expect(nudgeAvailability(habit, ctx({ ownerLocalTime: '17:59' })).reason).toBe('policy')
    expect(nudgeAvailability(habit, ctx({ ownerLocalTime: '18:00' })).allowed).toBe(true)
    expect(nudgeAvailability(habit, ctx({ ownerLocalTime: '21:30' })).allowed).toBe(true)
  })

  it('reports every policy refusal identically, so settings cannot be probed', () => {
    // A friend must not be able to tell "never" from "not yet" by reading the UI.
    const never = scheduledHabit(EVERY_DAY, { ...EARLY, nudge_policy: 'never' })
    const atRiskOnly = scheduledHabit(EVERY_DAY, { ...EARLY, nudge_policy: 'at_risk_only' })
    const timed = scheduledHabit(EVERY_DAY, {
      ...EARLY,
      nudge_policy: 'after_time',
      nudge_after_time: '23:00:00',
    })

    const reasons = [never, atRiskOnly, timed].map((h) => nudgeAvailability(h, ctx()).reason)
    expect(new Set(reasons)).toEqual(new Set(['policy']))
  })
})

describe('nudgeAvailability — cooldown', () => {
  const habit = scheduledHabit(EVERY_DAY, EARLY)

  it('blocks a second nudge for the same habit within two hours', () => {
    const sent = [nudge(habit, VIEWER, '2026-08-16T17:30:00Z')]
    const result = nudgeAvailability(habit, ctx({ sentNudges: sent }))

    expect(result.reason).toBe('cooldown')
    expect(result.availableAt?.toISOString()).toBe('2026-08-16T19:30:00.000Z')
  })

  it('allows it again once the cooldown has passed', () => {
    const sent = [nudge(habit, VIEWER, '2026-08-16T15:00:00Z')] // 3h before NOW
    expect(nudgeAvailability(habit, ctx({ sentNudges: sent })).allowed).toBe(true)
  })

  it('is exactly two hours', () => {
    const justInside = new Date(NOW.getTime() - NUDGE_COOLDOWN_MS + 1000).toISOString()
    const justOutside = new Date(NOW.getTime() - NUDGE_COOLDOWN_MS - 1000).toISOString()

    expect(nudgeAvailability(habit, ctx({ sentNudges: [nudge(habit, VIEWER, justInside)] })).allowed).toBe(false)
    expect(nudgeAvailability(habit, ctx({ sentNudges: [nudge(habit, VIEWER, justOutside)] })).allowed).toBe(true)
  })

  it('is per habit, not per person', () => {
    const other = scheduledHabit(EVERY_DAY, EARLY)
    const sent = [nudge(other, VIEWER, '2026-08-16T17:30:00Z')]
    expect(nudgeAvailability(habit, ctx({ sentNudges: sent })).allowed).toBe(true)
  })

  it('picks the most recent nudge when several are in the window', () => {
    const sent = [
      nudge(habit, VIEWER, '2026-08-16T16:10:00Z'),
      nudge(habit, VIEWER, '2026-08-16T17:45:00Z'),
    ]
    expect(nudgeAvailability(habit, ctx({ sentNudges: sent })).availableAt?.toISOString()).toBe(
      '2026-08-16T19:45:00.000Z',
    )
  })
})

describe('describeNudgeBlock', () => {
  it('explains only what is safe to explain', () => {
    expect(describeNudgeBlock('cooldown')).toBe('Nudged recently')
    expect(describeNudgeBlock('policy')).toBe('Nudges are off right now')
    // These should render nothing at all rather than a greyed-out button that
    // draws attention to somebody's excused or lapsed day.
    expect(describeNudgeBlock('excused')).toBeNull()
    expect(describeNudgeBlock('lapsed')).toBeNull()
    expect(describeNudgeBlock('satisfied')).toBeNull()
    expect(describeNudgeBlock(null)).toBeNull()
  })
})

describe('at-risk interaction', () => {
  it('an at-risk habit is still nudgeable under the default policy', () => {
    const habit = scheduledHabit(EVERY_DAY, EARLY)
    const lookup = buildDayLookup([], [
      habitDay(habit, '2026-08-16', { at_risk_at: '2026-08-16T14:00:00Z' }),
    ])
    expect(nudgeAvailability(habit, ctx({ lookup, atRisk: true })).allowed).toBe(true)
  })
})
