/**
 * "Nudge Ura about Reading."
 *
 * Five presets and a short custom message. Not a chat: one message goes one way, and
 * there is no reply. The presets live in `src/domain/nudges.ts` so they can be
 * rewritten in a single commit.
 *
 * Every rule about whether this nudge is allowed is enforced by `send_nudge()` in the
 * database. This sheet only opens when the client-side mirror says it should, but if
 * the two disagree the server wins and the error surfaces as a toast.
 */
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Habit, Profile } from '../types/models'
import { NUDGE_MAX_LENGTH, NUDGE_PRESETS } from '../domain/nudges'
import { describeError } from '../lib/supabase'
import { Sheet } from './Sheet'
import { Button, ErrorText, INPUT_CLASS } from './ui'

interface NudgeSheetProps {
  open: boolean
  onClose: () => void
  habit: Habit
  recipient: Profile
  onSend: (message: string, preset: string | null) => Promise<void>
}

export function NudgeSheet({ open, onClose, habit, recipient, onSend }: NudgeSheetProps) {
  const [selected, setSelected] = useState<string | null>(NUDGE_PRESETS[0]?.key ?? null)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const usingCustom = custom.trim().length > 0
  const preset = NUDGE_PRESETS.find((p) => p.key === selected)
  const message = usingCustom ? custom.trim() : (preset?.label ?? '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (sending) return
    setError(null)

    if (!message) {
      setError('Pick one, or write something.')
      return
    }

    setSending(true)
    try {
      // A typed message wins over a highlighted preset — if someone bothered to
      // write, that is clearly what they meant to send.
      await onSend(message, usingCustom ? null : (preset?.key ?? null))
      setCustom('')
      onClose()
    } catch (cause) {
      setError(describeError(cause))
      setSending(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Nudge ${recipient.display_name}`}
      subtitle={
        <>
          about <span aria-hidden="true">{habit.emoji}</span> {habit.name}
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <ul className="space-y-1.5">
          {NUDGE_PRESETS.map((item) => {
            const active = !usingCustom && selected === item.key
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(item.key)
                    setCustom('')
                  }}
                  aria-pressed={active}
                  className={`flex min-h-12 w-full items-center rounded-xl border px-4 text-left text-[0.95rem] transition-colors ${
                    active
                      ? 'border-accent bg-accent-soft font-semibold text-ink'
                      : 'border-line bg-surface text-ink-soft hover:bg-sunken'
                  }`}
                >
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink">
            Or say something
          </span>
          <input
            className={INPUT_CLASS}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Custom message…"
            maxLength={NUDGE_MAX_LENGTH}
            enterKeyHint="send"
            autoCapitalize="sentences"
          />
          {custom.length > NUDGE_MAX_LENGTH - 40 && (
            <span className="mt-1 block text-right text-[0.72rem] tabular-nums text-ink-faint">
              {NUDGE_MAX_LENGTH - custom.length} left
            </span>
          )}
        </label>

        {error && <ErrorText>{error}</ErrorText>}

        <div className="mt-4">
          <Button type="submit" full disabled={sending}>
            {sending ? 'Sending…' : 'Send nudge'}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
