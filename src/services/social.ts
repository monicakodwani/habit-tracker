/**
 * Nudges, at-risk markers, grace days and avoidance lapses.
 *
 * Almost everything here goes through a database RPC rather than a table write. That
 * is deliberate: these actions have rules — cooldowns, nudge policies, whose habit it
 * is, which local day it is — and rules enforced in the browser are not rules. The
 * functions in `supabase/migrations/20260817000000_social.sql` re-check every one of
 * them, so calling the REST endpoints by hand gets you nowhere.
 *
 * The client mirrors the same rules in `src/domain/nudges.ts` purely so the UI does
 * not offer buttons the server will refuse.
 */
import { supabase } from '../lib/supabase'
import type { HabitDay, LocalDate, Nudge } from '../types/models'

const DAY_COLUMNS = 'id, habit_id, user_id, day_date, excused, lapsed, at_risk_at, at_risk_note'

/**
 * Day states for a set of habits in a window.
 *
 * RLS returns the caller's own rows plus rows belonging to shared habits in their
 * group, so a friend's private habit's excused/lapsed/at-risk state never arrives.
 */
export async function fetchHabitDays(
  habitIds: readonly string[],
  from: LocalDate,
  to: LocalDate,
): Promise<HabitDay[]> {
  if (habitIds.length === 0) return []

  const { data, error } = await supabase
    .from('habit_days')
    .select(DAY_COLUMNS)
    .in('habit_id', [...habitIds])
    .gte('day_date', from)
    .lte('day_date', to)

  if (error) throw error
  return data ?? []
}

/** Every day-state row for one habit — used by the detail screen's history. */
export async function fetchHabitDayHistory(habitId: string): Promise<HabitDay[]> {
  const { data, error } = await supabase
    .from('habit_days')
    .select(DAY_COLUMNS)
    .eq('habit_id', habitId)
    .order('day_date', { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * Nudges the signed-in user has sent recently.
 *
 * Needed to show the cooldown state. RLS only lets someone read nudges they sent or
 * received, so this can never be used to observe traffic between two other people.
 */
export async function fetchMyRecentNudges(userId: string, since: string): Promise<Nudge[]> {
  const { data, error } = await supabase
    .from('nudges')
    .select('id, group_id, habit_id, sender_id, recipient_id, day_date, preset, message, created_at')
    .eq('sender_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

/** Nudges aimed at the signed-in user, newest first. */
export async function fetchNudgesForMe(userId: string, limit = 20): Promise<Nudge[]> {
  const { data, error } = await supabase
    .from('nudges')
    .select('id, group_id, habit_id, sender_id, recipient_id, day_date, preset, message, created_at')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

/**
 * Sends a nudge. Returns the new nudge's id.
 *
 * Every rule is checked inside `send_nudge`. A refusal comes back as a generic
 * "Not allowed right now" on purpose — a specific message would let a sender probe
 * another person's settings and habit state.
 */
export async function sendNudge(
  habitId: string,
  message: string,
  preset: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('send_nudge', {
    p_habit_id: habitId,
    p_message: message,
    p_preset: preset,
  })

  if (error) throw error
  return data as string
}

/** "I might miss this today — please bother me." Returns the owner's local date. */
export async function markAtRisk(habitId: string, note: string | null): Promise<LocalDate> {
  const { data, error } = await supabase.rpc('mark_at_risk', {
    p_habit_id: habitId,
    p_note: note,
  })

  if (error) throw error
  return data as LocalDate
}

export async function clearAtRisk(habitId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_at_risk', { p_habit_id: habitId })
  if (error) throw error
}

/** Excuse (or un-excuse) a scheduled occurrence. Rejected for weekly-target habits. */
export async function setExcused(
  habitId: string,
  date: LocalDate,
  excused: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_excused', {
    p_habit_id: habitId,
    p_date: date,
    p_excused: excused,
  })
  if (error) throw error
}

/** Log or undo a slip on an avoidance habit. */
export async function setLapse(
  habitId: string,
  date: LocalDate,
  lapsed: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_lapse', {
    p_habit_id: habitId,
    p_date: date,
    p_lapsed: lapsed,
  })
  if (error) throw error
}
