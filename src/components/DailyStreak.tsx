/**
 * The daily combined streak indicator.
 *
 * Deliberately a single quiet line rather than a hero card: it is secondary
 * motivation, and the habit list is what people actually came to use. On a phone it
 * must not push the first habit row below the fold.
 *
 * The emoji is decorative — every piece of information here is also in the text, and
 * the whole thing is announced as one sentence to a screen reader rather than as
 * disconnected fragments.
 */
import type { CombinedDay } from '../domain/dailyStreak'
import { describeToday } from '../domain/dailyStreak'

interface DailyStreakProps {
  /** Consecutive successful days ending yesterday. */
  current: number
  today: CombinedDay
}

export function DailyStreakLine({ current, today }: DailyStreakProps) {
  const status = describeToday(today)

  const streakLabel =
    current > 0
      ? `${current}-day daily streak`
      : today.status === 'failed'
        ? 'Daily streak reset'
        : 'No daily streak yet'

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[0.9rem] lg:mb-7">
      {/*
        One sentence for assistive tech; the visual version is split so the streak can
        be emphasised without the status line reading as a separate announcement.
      */}
      <span className="sr-only">{`${streakLabel}. ${status}.`}</span>

      <span aria-hidden="true" className="font-semibold text-ink">
        {current > 0 && <span className="mr-1">🔥</span>}
        {streakLabel}
      </span>
      <span aria-hidden="true" className="text-ink-faint">
        ·
      </span>
      <span
        aria-hidden="true"
        className={today.allHandled ? 'text-accent-ink' : 'text-ink-soft'}
      >
        {status}
      </span>
    </div>
  )
}

/**
 * Current and longest, for the Me screen.
 *
 * Two numbers, no chart. The label says "Daily streak" throughout so it can never be
 * confused with the per-habit streaks shown on habit rows and detail pages.
 */
export function DailyStreakStats({ current, longest }: { current: number; longest: number }) {
  return (
    <dl className="grid grid-cols-2 gap-2.5">
      <Stat label="Current" value={current} emoji="🔥" accent={current > 0} />
      <Stat label="Longest" value={longest} emoji="🏆" />
    </dl>
  )
}

function Stat({
  label,
  value,
  emoji,
  accent = false,
}: {
  label: string
  value: number
  emoji: string
  accent?: boolean
}) {
  const days = `${value} ${value === 1 ? 'day' : 'days'}`

  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <dt className="text-[0.75rem] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? 'text-flame' : 'text-ink'}`}>
        <span aria-hidden="true" className="mr-1 text-xl">
          {emoji}
        </span>
        {/* The unit is part of the accessible value, not implied by layout. */}
        <span aria-hidden="true">{value}</span>
        <span className="sr-only">{days}</span>
      </dd>
    </div>
  )
}
