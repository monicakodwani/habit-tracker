/**
 * Group and profile queries.
 *
 * Every query here is already scoped by Row Level Security — `select('*')` on
 * `profiles` returns only the people you share a group with, because that is what the
 * policy allows. The client never has to filter for privacy, and must not rely on
 * doing so.
 */
import { supabase } from '../lib/supabase'
import type { Group, Profile } from '../types/models'

/** The signed-in user's profile, or null if the row does not exist yet. */
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * The user's group. Phase 1 assumes exactly one; if somehow there are several, the
 * oldest wins so the choice is at least stable across reloads.
 */
export async function fetchMyGroup(): Promise<Group | null> {
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

/** Everyone in the group, including the signed-in user. */
export async function fetchGroupMembers(groupId: string): Promise<Profile[]> {
  // One round trip: join through group_members to the embedded profile rows.
  const { data, error } = await supabase
    .from('group_members')
    .select('profiles!inner(*)')
    .eq('group_id', groupId)

  if (error) throw error

  return (data ?? [])
    .map((row) => (row as unknown as { profiles: Profile }).profiles)
    .filter(Boolean)
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
}

export interface ProfileUpdate {
  display_name?: string
  avatar_emoji?: string
  timezone?: string
}

/** Updates the signed-in user's profile. RLS rejects any attempt to update another's. */
export async function updateProfile(userId: string, patch: ProfileUpdate): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Creates the profile row if the `on_auth_user_created` trigger did not (for example
 * for an account created before the migration ran). Safe to call on every sign-in.
 */
export async function ensureProfile(
  userId: string,
  defaults: { display_name: string; timezone: string },
): Promise<Profile> {
  const existing = await fetchMyProfile(userId)
  if (existing) return existing

  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: userId, ...defaults })
    .select()
    .single()

  if (error) throw error
  return data
}
