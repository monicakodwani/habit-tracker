/**
 * Check-in queries.
 *
 * A check-in's `completion_date` is always a *local* calendar date resolved in the
 * habit owner's timezone before it gets here. Nothing in this file computes dates —
 * that is `src/domain/dates.ts`'s job — so there is no path by which a UTC day can
 * sneak in.
 */
import { supabase } from '../lib/supabase'
import type { Checkin, LocalDate } from '../types/models'

const COLUMNS = 'id, habit_id, user_id, completion_date, created_at'

/**
 * Every check-in the user may see for a set of habits, within a date window.
 *
 * The window keeps the payload small: Today and Week need only a few weeks of
 * history, and the habit detail screen asks for a wider range separately.
 */
export async function fetchCheckins(
  habitIds: readonly string[],
  from: LocalDate,
  to: LocalDate,
): Promise<Checkin[]> {
  if (habitIds.length === 0) return []

  const { data, error } = await supabase
    .from('habit_checkins')
    .select(COLUMNS)
    .in('habit_id', [...habitIds])
    .gte('completion_date', from)
    .lte('completion_date', to)

  if (error) throw error
  return data ?? []
}

/** Every check-in for a single habit — used by the detail screen's history. */
export async function fetchHabitCheckins(habitId: string): Promise<Checkin[]> {
  const { data, error } = await supabase
    .from('habit_checkins')
    .select(COLUMNS)
    .eq('habit_id', habitId)
    .order('completion_date', { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * Marks a habit complete for a local date.
 *
 * Uses an upsert on the `(habit_id, completion_date)` unique constraint so a double
 * tap — or a retry after a flaky connection — is harmless rather than an error.
 *
 * `userId` must be the signed-in user. Both the RLS policy and the composite foreign
 * key on `habits(id, owner_id)` reject anything else, so a friend cannot check off
 * someone else's habit even by crafting the request by hand.
 */
export async function addCheckin(
  habitId: string,
  userId: string,
  date: LocalDate,
): Promise<Checkin> {
  const { data, error } = await supabase
    .from('habit_checkins')
    .upsert(
      { habit_id: habitId, user_id: userId, completion_date: date },
      { onConflict: 'habit_id,completion_date', ignoreDuplicates: false },
    )
    .select(COLUMNS)
    .single()

  if (error) throw error
  return data
}

/** Undoes a completion. Deleting something that is not there is not an error. */
export async function removeCheckin(habitId: string, date: LocalDate): Promise<void> {
  const { error } = await supabase
    .from('habit_checkins')
    .delete()
    .eq('habit_id', habitId)
    .eq('completion_date', date)

  if (error) throw error
}
