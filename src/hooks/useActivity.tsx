/**
 * The activity feed's own data, loaded lazily.
 *
 * Kept out of `useAppData` on purpose: the feed is paginated and only one of four
 * tabs, so making every screen wait for it would slow down the one people actually
 * open. It refetches on the same realtime signal as everything else.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityEvent, EventReaction, ReactionEmoji } from '../types/models'
import * as activityService from '../services/activity'
import { describeError, supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'

interface ActivityState {
  events: ActivityEvent[]
  reactions: EventReaction[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string | null
}

const EMPTY: ActivityState = {
  events: [],
  reactions: [],
  loading: true,
  loadingMore: false,
  hasMore: false,
  error: null,
}

export function useActivity(groupId: string | null, userId: string | null) {
  const [state, setState] = useState<ActivityState>(EMPTY)
  const { showToast } = useToast()
  const token = useRef(0)

  const load = useCallback(async () => {
    if (!groupId) return
    const current = ++token.current

    try {
      const page = await activityService.fetchActivity(groupId)
      const reactions = await activityService.fetchReactions(page.events.map((e) => e.id))
      if (current !== token.current) return

      setState({
        events: page.events,
        reactions,
        loading: false,
        loadingMore: false,
        hasMore: page.hasMore,
        error: null,
      })
    } catch (cause) {
      if (current !== token.current) return
      setState((s) => ({ ...s, loading: false, error: describeError(cause) }))
    }
  }, [groupId])

  useEffect(() => {
    if (!groupId) return
    setState(EMPTY)
    void load()
  }, [groupId, load])

  // Same "something moved, refetch" pattern as the rest of the app. The payload is
  // never trusted; RLS decides what the refetch returns.
  useEffect(() => {
    if (!groupId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 1500)
    }

    const channel = supabase
      .channel('activity-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_events' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_reactions' }, schedule)
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [groupId, load])

  const loadMore = useCallback(async () => {
    if (!groupId || state.loadingMore || !state.hasMore) return
    const oldest = state.events[state.events.length - 1]
    if (!oldest) return

    setState((s) => ({ ...s, loadingMore: true }))
    try {
      const page = await activityService.fetchActivity(groupId, oldest.created_at)
      const more = await activityService.fetchReactions(page.events.map((e) => e.id))
      setState((s) => ({
        ...s,
        events: [...s.events, ...page.events],
        reactions: [...s.reactions, ...more],
        hasMore: page.hasMore,
        loadingMore: false,
      }))
    } catch (cause) {
      setState((s) => ({ ...s, loadingMore: false }))
      showToast(describeError(cause))
    }
  }, [groupId, state.loadingMore, state.hasMore, state.events, showToast])

  /**
   * Adds, replaces or removes the signed-in user's reaction.
   *
   * Tapping the reaction you already have removes it; tapping a different one
   * replaces it. Optimistic, with the exact previous list restored on failure.
   */
  const toggleReaction = useCallback(
    async (eventId: string, emoji: ReactionEmoji) => {
      if (!userId) return
      const previous = state.reactions
      const mine = previous.find((r) => r.event_id === eventId && r.user_id === userId)
      const removing = mine?.emoji === emoji

      setState((s) => ({
        ...s,
        reactions: removing
          ? s.reactions.filter((r) => !(r.event_id === eventId && r.user_id === userId))
          : [
              ...s.reactions.filter((r) => !(r.event_id === eventId && r.user_id === userId)),
              {
                id: mine?.id ?? `optimistic:${eventId}`,
                event_id: eventId,
                user_id: userId,
                emoji,
                created_at: new Date().toISOString(),
              },
            ],
      }))

      try {
        if (removing) {
          await activityService.removeReaction(eventId, userId)
        } else {
          const saved = await activityService.setReaction(eventId, userId, emoji)
          setState((s) => ({
            ...s,
            reactions: s.reactions.map((r) =>
              r.event_id === eventId && r.user_id === userId ? saved : r,
            ),
          }))
        }
      } catch (cause) {
        setState((s) => ({ ...s, reactions: previous }))
        showToast(describeError(cause))
      }
    },
    [userId, state.reactions, showToast],
  )

  return { ...state, reload: load, loadMore, toggleReaction }
}
