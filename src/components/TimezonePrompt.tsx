/**
 * Offers to correct a stored timezone that disagrees with the device.
 *
 * This matters more than it looks. The profile timezone decides what "today" is, which
 * decides when habits are due, when a day is finalised, when an at-risk marker expires
 * and where a streak breaks. Somebody in Delhi whose profile says New York sees the
 * wrong day for several hours of every day.
 *
 * DELIBERATELY A PROMPT, NOT AUTOMATIC. Silently following the device would rewrite day
 * boundaries the moment someone travels, which could move a completion into a different
 * day and break a streak that was genuinely earned. Changing where your days start is a
 * decision, so it stays one tap away rather than happening behind your back.
 *
 * It also disappears for good once dismissed, so a frequent traveller is not nagged.
 */
import { useState } from 'react'
import { guessTimezone, isValidTimezone } from '../domain/dates'
import { describeError } from '../lib/supabase'
import { useToast } from './Toast'
import { Card } from './Layout'
import { Button } from './ui'

/** Remembered per stored/device pair, so a genuine later change still prompts. */
const DISMISS_KEY = 'habits.tzPrompt.dismissed'

function readable(zone: string): string {
  return zone.replace(/_/g, ' ')
}

export function TimezonePrompt({
  current,
  onAccept,
}: {
  current: string
  onAccept: (zone: string) => Promise<void>
}) {
  const device = guessTimezone()
  const pairKey = `${current}->${device}`
  const { showToast } = useToast()

  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === pairKey,
  )
  const [busy, setBusy] = useState(false)

  // Nothing to say when they already agree, or when the browser cannot tell us.
  if (dismissed || !isValidTimezone(device) || device === current) return null

  async function accept() {
    setBusy(true)
    try {
      await onAccept(device)
      showToast(`Your days now start in ${readable(device)}`, 'info')
    } catch (cause) {
      showToast(describeError(cause))
      setBusy(false)
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, pairKey)
    setDismissed(true)
  }

  return (
    <Card className="mt-2.5 px-4 py-3.5">
      <p className="text-[0.9rem] font-medium">
        <span aria-hidden="true" className="mr-1">
          🌍
        </span>
        This device is in {readable(device)}
      </p>
      <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-faint">
        Your profile says {readable(current)}, so your days start and end at the wrong
        time — which affects what shows up as due today and how streaks are counted.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void accept()}>
          {busy ? 'Updating…' : `Use ${readable(device)}`}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={dismiss}>
          Keep {readable(current)}
        </Button>
      </div>
    </Card>
  )
}
