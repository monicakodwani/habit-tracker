/**
 * Activity — a small, warm group feed.
 *
 * Deliberately not a social network: no comments, no threads, no follower counts, no
 * ranking. Just what the three of them did today, and a way to cheer.
 *
 * Everything here comes from `activity_events`, which only ever contains SHARED
 * habits. Private habits produce no events at all, so there is nothing to filter.
 */
import { useMemo } from 'react'
import { useAppData } from '../hooks/useAppData'
import { useActivity } from '../hooks/useActivity'
import type { ActivityEvent, Profile, ReactionEmoji } from '../types/models'
import { REACTION_EMOJI } from '../types/models'
import { formatRelativeDay } from '../domain/dates'
import type { LocalDate } from '../types/models'
import { Card, PageTitle, Screen, Section } from '../components/Layout'
import { Button, EmptyState, ListSkeleton } from '../components/ui'

export function ActivityScreen() {
  const { group, me, members, today, zone } = useAppData()
  const { events, reactions, loading, loadingMore, hasMore, error, loadMore, toggleReaction } =
    useActivity(group?.id ?? null, me?.id ?? null)

  const byId = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  )

  // Grouped by the day the event happened, newest day first, so the feed reads as
  // "today, then yesterday" rather than an undifferentiated stream.
  const grouped = useMemo(() => groupByDay(events), [events])

  return (
    /*
     * A feed is prose-shaped, so it keeps a comfortable measure rather than
     * stretching across the shell. The remaining desktop space is deliberately left
     * empty — there is nothing already in the product worth putting there, and
     * inventing a widget to fill it would make this look like a dashboard.
     */
    <Screen width="reading">
      <PageTitle>Activity</PageTitle>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <EmptyState title={error} />
      ) : events.length === 0 ? (
        <EmptyState title="Nothing has happened yet. Go do something ✨" />
      ) : (
        <>
          {grouped.map(([day, dayEvents]) => (
            <Section key={day} title={formatRelativeDay(day as LocalDate, today, zone)}>
              <div className="space-y-2">
                {dayEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    actor={byId.get(event.actor_id)}
                    target={event.target_user_id ? byId.get(event.target_user_id) : undefined}
                    reactions={reactions.filter((r) => r.event_id === event.id)}
                    viewerId={me?.id ?? ''}
                    members={byId}
                    onReact={(emoji) => void toggleReaction(event.id, emoji)}
                  />
                ))}
              </div>
            </Section>
          ))}

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? 'Loading…' : 'Show older'}
              </Button>
            </div>
          )}
        </>
      )}
    </Screen>
  )
}

/**
 * Groups **consecutive** runs of the same day, not all events sharing a day.
 *
 * The feed is ordered by `created_at` (when it happened) while headings show
 * `day_date` (the day it was about). Those usually agree, but backfilled or
 * late-logged entries can separate them — and a Map-based grouping would then hoist a
 * later event up into an earlier group, producing headings out of order. Grouping
 * only adjacent events keeps the headings monotonic with the feed itself.
 */
function groupByDay(events: readonly ActivityEvent[]): [string, ActivityEvent[]][] {
  const groups: [string, ActivityEvent[]][] = []
  for (const event of events) {
    const last = groups[groups.length - 1]
    if (last && last[0] === event.day_date) last[1].push(event)
    else groups.push([event.day_date, [event]])
  }
  return groups
}

/** The one-line description of an event, in plain human language. */
function describeEvent(
  event: ActivityEvent,
  actorName: string,
  targetName: string | undefined,
): { icon: string; text: string; note?: string } {
  const habit = event.metadata.habit_name ?? 'a habit'
  const emoji = event.metadata.habit_emoji

  switch (event.type) {
    case 'habit_completed':
      return {
        icon: emoji ?? '🎉',
        text: `${actorName} completed ${habit}`,
        // Only shown when it is worth celebrating, so an ordinary Tuesday stays quiet.
        note:
          event.metadata.streak && event.metadata.streak >= 3
            ? `🔥 ${event.metadata.streak}-day streak`
            : undefined,
      }
    case 'at_risk':
      return {
        icon: '⚠️',
        text: `${actorName} needs a push with ${habit}`,
        note: event.metadata.note ? `“${event.metadata.note}”` : undefined,
      }
    case 'nudge':
      return {
        icon: '👀',
        text: `${actorName} nudged ${targetName ?? 'someone'} about ${habit}`,
        // The preset label is fun to show; a custom message stays between those two.
        note: event.metadata.preset ? undefined : undefined,
      }
  }
}

function EventCard({
  event,
  actor,
  target,
  reactions,
  viewerId,
  members,
  onReact,
}: {
  event: ActivityEvent
  actor: Profile | undefined
  target: Profile | undefined
  reactions: { user_id: string; emoji: string }[]
  viewerId: string
  members: Map<string, Profile>
  onReact: (emoji: ReactionEmoji) => void
}) {
  const actorName = actor?.display_name ?? 'Someone'
  const { icon, text, note } = describeEvent(event, actorName, target?.display_name)

  const mine = reactions.find((r) => r.user_id === viewerId)
  const counts = new Map<string, string[]>()
  for (const r of reactions) {
    const names = counts.get(r.emoji) ?? []
    names.push(members.get(r.user_id)?.display_name ?? 'Someone')
    counts.set(r.emoji, names)
  }

  const time = new Date(event.created_at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <Card className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 text-xl leading-none">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] leading-snug">
            {actor && (
              <span aria-hidden="true" className="mr-1">
                {actor.avatar_emoji}
              </span>
            )}
            {text}
          </p>
          {note && <p className="mt-1 text-[0.85rem] italic text-ink-soft">{note}</p>}
          <p className="mt-1 text-[0.72rem] text-ink-faint">{time}</p>

          {counts.size > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {[...counts.entries()].map(([emoji, names]) => (
                <li
                  key={emoji}
                  title={names.join(', ')}
                  className="rounded-full bg-sunken px-2 py-0.5 text-[0.78rem]"
                >
                  <span aria-hidden="true">{emoji}</span>{' '}
                  <span className="tabular-nums text-ink-soft">{names.length}</span>
                  <span className="sr-only">{` from ${names.join(', ')}`}</span>
                </li>
              ))}
            </ul>
          )}

          <ReactionBar current={mine?.emoji} onReact={onReact} />
        </div>
      </div>
    </Card>
  )
}

/**
 * The six reactions.
 *
 * Tapping your current one removes it; tapping another replaces it. One per person
 * per event, which is enough for three friends and avoids a wall of duplicates.
 */
function ReactionBar({
  current,
  onReact,
}: {
  current: string | undefined
  onReact: (emoji: ReactionEmoji) => void
}) {
  return (
    <ul className="mt-2 flex flex-wrap gap-0.5">
      {REACTION_EMOJI.map((emoji) => {
        const active = current === emoji
        return (
          <li key={emoji}>
            <button
              type="button"
              onClick={() => onReact(emoji)}
              aria-pressed={active}
              aria-label={active ? `Remove ${emoji} reaction` : `React with ${emoji}`}
              // 44px so it is a comfortable thumb target; the emoji inside stays
              // small, so the row still reads as a quiet strip rather than buttons.
              className={`flex size-11 items-center justify-center rounded-full text-[0.95rem] transition-colors ${
                active ? 'bg-accent-soft' : 'hover:bg-sunken'
              }`}
            >
              <span aria-hidden="true" className={active ? '' : 'opacity-45'}>
                {emoji}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
