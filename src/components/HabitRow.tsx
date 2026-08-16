/**
 * Habit rows for the Today screen.
 *
 * Two variants, deliberately different shapes:
 *
 *   - {@link OwnHabitRow} has a completion control, a "more" button for the less
 *     common actions, and opens the habit's detail page.
 *   - {@link FriendHabitRow} has no completion control at all. A friend's habit is
 *     information, not something to act on, and the UI should not imply otherwise.
 *     The only thing it can offer is a nudge.
 *
 * State is never carried by colour or emoji alone — every status has a text label,
 * and the check control carries an accessible name.
 */
import { Link } from 'react-router-dom'
import type { HabitStatus } from '../domain/status'
import type { DayOutcome } from '../domain/dayState'
import { CheckButton, CheckIndicator } from './CheckButton'

/** "🔥 12 days", "2 / 3 this week", "still going today". */
function HabitMeta({ status }: { status: HabitStatus }) {
  const { streak, weekly, avoid, excused, outcome } = status

  if (excused) {
    return <span className="text-ink-faint">❄️ Excused today</span>
  }

  if (avoid) {
    const parts: string[] = []
    if (avoid.current > 0) parts.push(`🔥 ${avoid.current} ${avoid.current === 1 ? 'day' : 'days'}`)
    if (outcome === 'lapsed') parts.push('slip logged today')
    else if (avoid.stillGoingToday) parts.push('still going today')
    return <span className="text-ink-faint">{parts.join(' • ') || 'Avoiding this'}</span>
  }

  if (weekly) {
    return (
      <span className={weekly.met ? 'text-accent-ink' : 'text-ink-faint'}>
        {weekly.completed} / {weekly.target} this week
      </span>
    )
  }

  if (streak && streak.current > 0) {
    return (
      <span className="text-ink-faint">
        <span aria-hidden="true">🔥</span> {streak.current}
        {streak.current === 1 ? ' day' : ' days'}
      </span>
    )
  }

  return null
}

/** A small "…" button opening the action sheet. */
function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`More options for ${label}`}
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5">
        <circle cx="4" cy="10" r="1.6" fill="currentColor" />
        <circle cx="10" cy="10" r="1.6" fill="currentColor" />
        <circle cx="16" cy="10" r="1.6" fill="currentColor" />
      </svg>
    </button>
  )
}

export function OwnHabitRow({
  status,
  onToggle,
  onOpenActions,
}: {
  status: HabitStatus
  onToggle: () => void
  onOpenActions: () => void
}) {
  const { habit, completedToday, atRisk, atRiskNote, excused, outcome } = status
  const isAvoid = habit.kind === 'avoid'
  const settled = completedToday || excused

  return (
    <li className="border-b border-line/70 last:border-b-0">
      <div className="flex items-center gap-1">
        {/*
          The name area navigates to history; the control on the right completes it.
          Two separate targets means neither action fires while reaching for the other.
        */}
        <Link
          to={`/habits/${habit.id}`}
          // `min-w-0` lets this shrink so a long habit name truncates instead of
          // pushing the row past the viewport.
          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl py-3 pr-2 text-left transition-colors hover:bg-sunken/50"
        >
          <span aria-hidden="true" className="text-2xl leading-none">
            {habit.emoji}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-[1.02rem] font-medium transition-colors ${
                settled ? 'text-ink-soft' : 'text-ink'
              }`}
            >
              {habit.name}
            </span>
            <span className="mt-0.5 block text-[0.82rem]">
              <HabitMeta status={status} />
            </span>
          </span>
        </Link>

        {/*
          Avoidance habits get no tick box: there is nothing to complete, and asking
          someone to confirm every night that they did not order takeout is exactly
          the interaction the product should not have.
        */}
        {isAvoid ? (
          <AvoidBadge outcome={outcome} />
        ) : (
          <CheckButton checked={completedToday} label={habit.name} onToggle={onToggle} />
        )}

        <MoreButton label={habit.name} onClick={onOpenActions} />
      </div>

      {atRisk && (
        <div className="animate-[at-risk-in_180ms_ease-out] pb-3 pl-11 pr-2">
          <p className="text-[0.8rem] font-medium text-flame">
            <span aria-hidden="true">⚠️</span> You asked for a push
          </p>
          {atRiskNote && (
            <p className="mt-0.5 text-[0.8rem] italic text-ink-faint">&ldquo;{atRiskNote}&rdquo;</p>
          )}
        </div>
      )}
    </li>
  )
}

/** Status pill for an avoidance habit, in place of a check control. */
function AvoidBadge({ outcome }: { outcome: DayOutcome }) {
  const map: Record<string, { text: string; className: string }> = {
    'still-going': { text: 'Going', className: 'bg-accent-soft text-accent-ink' },
    lapsed: { text: 'Slipped', className: 'bg-sunken text-ink-soft' },
    clean: { text: 'Clear', className: 'bg-accent-soft text-accent-ink' },
    excused: { text: 'Excused', className: 'bg-sunken text-ink-soft' },
  }
  const badge = map[outcome] ?? { text: '—', className: 'bg-sunken text-ink-faint' }

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[0.72rem] font-semibold ${badge.className}`}
    >
      {badge.text}
    </span>
  )
}

export function FriendHabitRow({
  status,
  nudgeLabel,
  onNudge,
}: {
  status: HabitStatus
  /** Null hides the affordance entirely — see `describeNudgeBlock`. */
  nudgeLabel: string | null
  onNudge: (() => void) | null
}) {
  const { habit, completedToday, weekly, atRisk, atRiskNote, excused, outcome, avoid } = status
  const done = completedToday || weekly?.met === true || outcome === 'clean'

  return (
    <li className={atRisk ? 'my-1.5 rounded-xl bg-flame/8 px-2 py-1.5' : ''}>
      <div className="flex min-h-11 items-center gap-2.5 py-1.5">
        {excused ? (
          <span
            role="img"
            aria-label="Excused"
            className="flex size-6 shrink-0 items-center justify-center text-[0.85rem]"
          >
            ❄️
          </span>
        ) : (
          <CheckIndicator checked={done} />
        )}

        <span aria-hidden="true" className="text-base leading-none">
          {habit.emoji}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-[0.95rem] ${
            done || excused ? 'text-ink-soft' : 'text-ink'
          }`}
        >
          {habit.name}
        </span>

        {weekly && (
          <span className="shrink-0 text-[0.8rem] tabular-nums text-ink-faint">
            {weekly.completed} / {weekly.target}
          </span>
        )}
        {avoid && avoid.current > 0 && (
          <span className="shrink-0 text-[0.8rem] tabular-nums text-ink-faint">
            🔥 {avoid.current}
          </span>
        )}

        {/* A completed or excused habit never invites a nudge. */}
        {onNudge ? (
          <button
            type="button"
            onClick={onNudge}
            // 44px tall so it is comfortable to hit with a thumb; the pill still
            // reads as small because it stays narrow.
            className={`min-h-11 shrink-0 rounded-full px-3.5 text-[0.78rem] font-semibold transition-colors ${
              atRisk
                ? 'bg-flame text-bg hover:opacity-90'
                : 'border border-line text-ink-soft hover:bg-sunken hover:text-ink'
            }`}
          >
            Nudge
          </button>
        ) : (
          nudgeLabel && (
            <span className="shrink-0 text-[0.72rem] text-ink-faint">{nudgeLabel}</span>
          )
        )}
      </div>

      {atRisk && (
        <div className="pb-1 pl-8">
          <p className="text-[0.78rem] font-semibold text-flame">Needs a push</p>
          {atRiskNote && (
            <p className="mt-0.5 text-[0.78rem] italic text-ink-soft">&ldquo;{atRiskNote}&rdquo;</p>
          )}
        </div>
      )}
    </li>
  )
}
