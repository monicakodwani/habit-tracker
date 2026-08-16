/**
 * The activity feed and its reactions.
 *
 * Events are read-only from the client: `authenticated` has no INSERT grant on
 * `activity_events` at all. They are written exclusively by database triggers (on
 * completion) and by the `send_nudge` / `mark_at_risk` RPCs, which means an actor,
 * a group or a habit can never be forged from a browser.
 *
 * Events exist only for SHARED habits, and a trigger deletes a habit's events if it
 * later becomes private — so nothing here needs to filter for privacy.
 */
import { supabase } from '../lib/supabase'
import type { ActivityEvent, EventReaction, ReactionEmoji } from '../types/models'

const EVENT_COLUMNS =
  'id, group_id, actor_id, target_user_id, habit_id, type, day_date, metadata, created_at'

/** How many events one page of the feed holds. */
export const FEED_PAGE_SIZE = 40

export interface FeedPage {
  events: ActivityEvent[]
  /** True when another page is likely available. */
  hasMore: boolean
}

/**
 * One page of the group's feed, newest first.
 *
 * Paginated by `created_at` rather than by offset so that new events arriving while
 * someone is scrolling cannot cause a row to be skipped or repeated.
 */
export async function fetchActivity(
  groupId: string,
  before?: string,
): Promise<FeedPage> {
  let query = supabase
    .from('activity_events')
    .select(EVENT_COLUMNS)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(FEED_PAGE_SIZE + 1)

  if (before) query = query.lt('created_at', before)

  const { data, error } = await query
  if (error) throw error

  const rows = data ?? []
  return {
    events: rows.slice(0, FEED_PAGE_SIZE),
    hasMore: rows.length > FEED_PAGE_SIZE,
  }
}

/** Reactions for a set of events. */
export async function fetchReactions(eventIds: readonly string[]): Promise<EventReaction[]> {
  if (eventIds.length === 0) return []

  const { data, error } = await supabase
    .from('event_reactions')
    .select('id, event_id, user_id, emoji, created_at')
    .in('event_id', [...eventIds])

  if (error) throw error
  return data ?? []
}

/**
 * Sets the signed-in user's reaction to an event.
 *
 * One reaction per person per event: choosing a different emoji replaces the
 * previous one rather than adding to it, which is what the unique constraint on
 * (event_id, user_id) enforces.
 */
export async function setReaction(
  eventId: string,
  userId: string,
  emoji: ReactionEmoji,
): Promise<EventReaction> {
  const { data, error } = await supabase
    .from('event_reactions')
    .upsert(
      { event_id: eventId, user_id: userId, emoji },
      { onConflict: 'event_id,user_id' },
    )
    .select('id, event_id, user_id, emoji, created_at')
    .single()

  if (error) throw error
  return data
}

/** Removes the signed-in user's reaction. Removing a missing one is not an error. */
export async function removeReaction(eventId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('event_reactions')
    .delete()
    .eq('event_id', eventId)
    .eq('user_id', userId)

  if (error) throw error
}
