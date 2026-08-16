/**
 * Nudge eligibility.
 *
 * IMPORTANT: this is a **mirror** of the rules in `send_nudge()`, not the
 * enforcement. The database is the only thing that actually decides whether a nudge
 * is allowed; anyone can call the RPC directly from devtools and it will apply these
 * same checks server-side.
 *
 * The mirror exists so the UI never shows a button the server would reject, which is
 * a usability requirement rather than a security one. If the two ever disagree, the
 * server wins and the user sees the toast.
 *
 * Keep this file and the `send_nudge` function in
 * `supabase/migrations/20260817000000_social.sql` in step with each other.
 */
import type { Habit, LocalDate, Nudge } from '../types/models'
import { weeklyProgress } from './recurrence'
import { resolveDay } from './dayState'
import type { DayLookup } from './dayState'

/** How long a sender must wait before nudging the same habit again. Matches the RPC. */
export const NUDGE_COOLDOWN_MS = 2 * 60 * 60 * 1000

/**
 * Why a nudge is unavailable.
 *
 * These map to subdued UI, never to an explanation of somebody's private settings —
 * `policy` covers "never", "only when I ask" and "after a time" as one opaque bucket
 * so a friend cannot probe another person's preferences by reading the interface.
 */
export type NudgeBlock =
  | 'own-habit'
  | 'not-shared'
  | 'inactive'
  | 'not-today'
  | 'satisfied'
  | 'excused'
  | 'lapsed'
  | 'policy'
  | 'cooldown'

export interface NudgeAvailability {
  allowed: boolean
  reason: NudgeBlock | null
  /** When a cooldown is what blocks it, the moment it lifts. */
  availableAt: Date | null
}

const ALLOWED: NudgeAvailability = { allowed: true, reason: null, availableAt: null }

function blocked(reason: NudgeBlock, availableAt: Date | null = null): NudgeAvailability {
  return { allowed: false, reason, availableAt }
}

export interface NudgeContext {
  /** The signed-in user. */
  viewerId: string
  /** Today in the HABIT OWNER's timezone. */
  ownerToday: LocalDate
  ownerZone: string
  lookup: DayLookup
  /** The owner's check-ins for this habit, at least covering the current week. */
  checkins: readonly { completion_date: LocalDate }[]
  /** Whether the owner has an active at-risk marker for today. */
  atRisk: boolean
  /** Nudges the viewer has sent for this habit (RLS lets a sender read their own). */
  sentNudges: readonly Nudge[]
  /** The owner's current local wall-clock time, `HH:MM`, for the after_time policy. */
  ownerLocalTime: string
  now?: Date
}

/**
 * Whether the viewer may nudge this habit right now.
 *
 * The order of checks matters for privacy: ownership and sharing are tested first, so
 * a private habit is never distinguishable from one that is merely finished.
 */
export function nudgeAvailability(habit: Habit, ctx: NudgeContext): NudgeAvailability {
  if (habit.owner_id === ctx.viewerId) return blocked('own-habit')
  if (habit.visibility !== 'shared') return blocked('not-shared')
  if (!habit.active) return blocked('inactive')

  const day = ctx.lookup.days.get(ctx.ownerToday)
  if (day?.excused) return blocked('excused')

  if (habit.recurrence_type === 'weekly_target') {
    if (weeklyProgress(habit, ctx.checkins as never, ctx.ownerToday, ctx.ownerZone).met) {
      return blocked('satisfied')
    }
  } else {
    const outcome = resolveDay(habit, ctx.ownerToday, ctx.ownerToday, ctx.ownerZone, ctx.lookup)
    if (outcome === 'off') return blocked('not-today')
    if (outcome === 'done') return blocked('satisfied')
    // Encouragement is welcome while an avoidance day is still going, but once
    // someone has logged a slip, piling on is exactly what this app should not do.
    if (outcome === 'lapsed') return blocked('lapsed')
    if (outcome === 'excused') return blocked('excused')
  }

  // The owner's own policy. All three restrictive cases report the same opaque
  // reason so the UI cannot be read as a settings disclosure.
  if (habit.nudge_policy === 'never') return blocked('policy')
  if (habit.nudge_policy === 'at_risk_only' && !ctx.atRisk) return blocked('policy')
  if (habit.nudge_policy === 'after_time') {
    const after = (habit.nudge_after_time ?? '').slice(0, 5)
    if (after && ctx.ownerLocalTime < after) return blocked('policy')
  }

  const now = ctx.now ?? new Date()
  const recent = ctx.sentNudges
    .filter((n) => n.habit_id === habit.id)
    .map((n) => new Date(n.created_at).getTime())
    .filter((t) => now.getTime() - t < NUDGE_COOLDOWN_MS)
    .sort((a, b) => b - a)

  const latest = recent[0]
  if (latest !== undefined) {
    return blocked('cooldown', new Date(latest + NUDGE_COOLDOWN_MS))
  }

  return ALLOWED
}

/**
 * Short, non-revealing label for a blocked nudge.
 *
 * Returns null where the right thing is to show nothing at all — a completed or
 * unscheduled habit should simply not invite a nudge, rather than displaying a
 * greyed-out button explaining itself.
 */
export function describeNudgeBlock(reason: NudgeBlock | null): string | null {
  switch (reason) {
    case 'cooldown':
      return 'Nudged recently'
    case 'policy':
      return 'Nudges are off right now'
    case 'excused':
      return null
    case 'lapsed':
      return null
    default:
      return null
  }
}

/**
 * The preset nudges.
 *
 * Deliberately a plain array in code so the three of them can rewrite it in one
 * commit without a migration or an admin screen.
 */
export interface NudgePreset {
  key: string
  label: string
}

export const NUDGE_PRESETS: readonly NudgePreset[] = [
  { key: 'ahem', label: '👀 Ahem.' },
  { key: 'streak', label: '🔥 Protect the streak' },
  { key: 'do-the-thing', label: '🫡 Do the thing' },
  { key: 'girl', label: '💀 Girl.' },
  { key: 'gentle', label: '❤️ Gentle reminder' },
]

export const NUDGE_MAX_LENGTH = 200
export const AT_RISK_NOTE_MAX_LENGTH = 140
