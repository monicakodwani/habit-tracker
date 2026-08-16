/**
 * Habit queries.
 *
 * Note what is *not* here: any filter whose purpose is privacy. A query for group
 * habits returns the user's own habits plus other members' shared ones because the
 * `habits_select_own_or_shared_in_group` policy says so. Private habits belonging to
 * other people are never sent to this browser in the first place.
 */
import { supabase } from '../lib/supabase'
import type { Habit, HabitDraft } from '../types/models'

const COLUMNS =
  'id, owner_id, group_id, name, emoji, recurrence_type, scheduled_days, weekly_target, active, visibility, created_at, updated_at'

/**
 * Every habit the signed-in user is allowed to see in this group: all of their own
 * (active and archived, shared and private) plus every group member's shared ones.
 *
 * A single query for the whole Today screen — screens then slice it locally rather
 * than issuing one request per person.
 */
export async function fetchGroupHabits(groupId: string): Promise<Habit[]> {
  const { data, error } = await supabase
    .from('habits')
    .select(COLUMNS)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

/** One habit by id. Returns null when it does not exist or is not visible to the user. */
export async function fetchHabit(habitId: string): Promise<Habit | null> {
  const { data, error } = await supabase
    .from('habits')
    .select(COLUMNS)
    .eq('id', habitId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function createHabit(
  ownerId: string,
  groupId: string,
  draft: HabitDraft,
): Promise<Habit> {
  const { data, error } = await supabase
    .from('habits')
    .insert({ owner_id: ownerId, group_id: groupId, ...normalize(draft) })
    .select(COLUMNS)
    .single()

  if (error) throw error
  return data
}

export async function updateHabit(habitId: string, draft: HabitDraft): Promise<Habit> {
  const { data, error } = await supabase
    .from('habits')
    .update(normalize(draft))
    .eq('id', habitId)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return data
}

/**
 * Archives or restores a habit.
 *
 * Archiving is the default way to retire a habit: it disappears from Today and Week
 * but keeps every check-in, so its history stays readable.
 */
export async function setHabitActive(habitId: string, active: boolean): Promise<Habit> {
  const { data, error } = await supabase
    .from('habits')
    .update({ active })
    .eq('id', habitId)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return data
}

/**
 * Permanently deletes a habit and — via `on delete cascade` — all of its check-ins.
 *
 * Only ever called behind an explicit typed confirmation in the UI. Prefer
 * {@link setHabitActive}.
 */
export async function deleteHabit(habitId: string): Promise<void> {
  const { error } = await supabase.from('habits').delete().eq('id', habitId)
  if (error) throw error
}

/**
 * Shapes a draft to match the database's `habits_recurrence_shape` check constraint:
 * exactly one recurrence field populated, and `scheduled_days` sorted and distinct.
 *
 * Doing this once here means no caller has to remember the rule, and the constraint
 * stays a backstop rather than a routine source of errors.
 */
function normalize(draft: HabitDraft) {
  const isWeekly = draft.recurrence_type === 'weekly_target'
  return {
    name: draft.name.trim(),
    emoji: draft.emoji.trim() || '✅',
    recurrence_type: draft.recurrence_type,
    scheduled_days: isWeekly
      ? null
      : [...new Set(draft.scheduled_days ?? [])].sort((a, b) => a - b),
    weekly_target: isWeekly ? draft.weekly_target : null,
    visibility: draft.visibility,
  }
}
