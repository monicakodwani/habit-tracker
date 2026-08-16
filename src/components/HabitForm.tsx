/**
 * The New Habit / Edit Habit form.
 *
 * Five things only: name, emoji, frequency, visibility, and (when editing) archive.
 * No category, difficulty, colour, tags, description or reminders — the spec is
 * explicit that this form stays short, and a short form is what makes adding a habit
 * a ten-second decision rather than a small project.
 */
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import type { HabitDraft, HabitVisibility, Weekday } from '../types/models'
import { WEEKDAY_INITIALS, WEEKDAY_NAMES, WEEKDAYS } from '../types/models'
import { Button, ErrorText, Field, INPUT_CLASS } from './ui'

/** The three choices the user actually sees, mapped to two database recurrence types. */
type Frequency = 'daily' | 'days' | 'weekly'

const EVERY_DAY: Weekday[] = [1, 2, 3, 4, 5, 6, 7]

const EMOJI_SUGGESTIONS = ['📖', '💊', '🚶', '🏋️', '🧘', '💻', '📓', '✏️', '🎹', '🥗', '💧', '🌙']

function frequencyOf(draft: HabitDraft): Frequency {
  if (draft.recurrence_type === 'weekly_target') return 'weekly'
  const days = draft.scheduled_days ?? []
  return days.length === 7 ? 'daily' : 'days'
}

export const BLANK_HABIT: HabitDraft = {
  name: '',
  emoji: '✅',
  recurrence_type: 'scheduled_days',
  scheduled_days: EVERY_DAY,
  weekly_target: null,
  visibility: 'shared',
}

interface HabitFormProps {
  initial: HabitDraft
  submitLabel: string
  onSubmit: (draft: HabitDraft) => Promise<void>
}

export function HabitForm({ initial, submitLabel, onSubmit }: HabitFormProps) {
  const [name, setName] = useState(initial.name)
  const [emoji, setEmoji] = useState(initial.emoji)
  const [frequency, setFrequency] = useState<Frequency>(() => frequencyOf(initial))
  const [days, setDays] = useState<Weekday[]>(
    () => initial.scheduled_days ?? [1, 2, 3, 4, 5],
  )
  const [weeklyTarget, setWeeklyTarget] = useState(initial.weekly_target ?? 3)
  const [visibility, setVisibility] = useState<HabitVisibility>(initial.visibility)

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const daysLabelId = useId()

  function toggleDay(day: Weekday) {
    setDays((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b),
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    // Guards against a double-tap submitting twice.
    if (submitting) return
    setError(null)

    if (!name.trim()) {
      setError('Give it a name.')
      return
    }
    if (frequency === 'days' && days.length === 0) {
      setError('Pick at least one day.')
      return
    }

    const isWeekly = frequency === 'weekly'
    const draft: HabitDraft = {
      name: name.trim(),
      emoji: emoji.trim() || '✅',
      recurrence_type: isWeekly ? 'weekly_target' : 'scheduled_days',
      scheduled_days: isWeekly ? null : frequency === 'daily' ? EVERY_DAY : days,
      weekly_target: isWeekly ? weeklyTarget : null,
      visibility,
    }

    setSubmitting(true)
    try {
      await onSubmit(draft)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save. Try again.')
      setSubmitting(false)
    }
    // On success the caller navigates away, so `submitting` is deliberately left on
    // to keep the button disabled through the transition.
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-7">
      <Field label="Name">
        <input
          className={INPUT_CLASS}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Read"
          maxLength={60}
          enterKeyHint="done"
          autoCapitalize="sentences"
          required
        />
      </Field>

      <div>
        <span className="mb-2 block text-sm font-semibold text-ink">Emoji</span>
        <div className="flex items-start gap-3">
          {/* Sized by the wrapper, not the input — see INPUT_CLASS. */}
          <div className="w-[4.5rem] shrink-0">
            <input
              className={`${INPUT_CLASS} px-2 text-center text-2xl`}
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              aria-label="Habit emoji"
              maxLength={8}
            />
          </div>
          <ul className="flex min-w-0 flex-1 flex-wrap gap-1">
            {EMOJI_SUGGESTIONS.map((choice) => (
              <li key={choice}>
                <button
                  type="button"
                  onClick={() => setEmoji(choice)}
                  aria-label={`Use ${choice}`}
                  aria-pressed={emoji === choice}
                  className={`flex size-11 items-center justify-center rounded-xl text-xl transition-colors ${
                    emoji === choice ? 'bg-accent-soft' : 'hover:bg-sunken'
                  }`}
                >
                  <span aria-hidden="true">{choice}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Frequency</legend>
        <Segmented
          value={frequency}
          onChange={setFrequency}
          options={[
            { value: 'daily', label: 'Every day' },
            { value: 'days', label: 'Certain days' },
            { value: 'weekly', label: 'X per week' },
          ]}
        />

        {frequency === 'days' && (
          <div className="mt-4">
            <p id={daysLabelId} className="mb-2 text-[0.82rem] text-ink-soft">
              Which days?
            </p>
            <ul className="flex justify-between gap-1.5" aria-labelledby={daysLabelId}>
              {WEEKDAYS.map((day) => {
                const selected = days.includes(day)
                return (
                  <li key={day} className="flex-1">
                    <button
                      type="button"
                      onClick={() => toggleDay(day)}
                      aria-pressed={selected}
                      // The visible letter is ambiguous (two Ts, two Ss), so the
                      // accessible name spells the day out.
                      aria-label={WEEKDAY_NAMES[day]}
                      className={`flex h-12 w-full items-center justify-center rounded-xl border text-[0.9rem] font-semibold transition-colors ${
                        selected
                          ? 'border-accent bg-accent text-bg'
                          : 'border-line bg-surface text-ink-soft hover:bg-sunken'
                      }`}
                    >
                      <span aria-hidden="true">{WEEKDAY_INITIALS[day]}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {frequency === 'weekly' && (
          <div className="mt-4">
            <p className="mb-2 text-[0.82rem] text-ink-soft">How many times each week?</p>
            <ul className="flex justify-between gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <li key={n} className="flex-1">
                  <button
                    type="button"
                    onClick={() => setWeeklyTarget(n)}
                    aria-pressed={weeklyTarget === n}
                    aria-label={`${n} times per week`}
                    className={`flex h-12 w-full items-center justify-center rounded-xl border text-[0.95rem] font-semibold tabular-nums transition-colors ${
                      weeklyTarget === n
                        ? 'border-accent bg-accent text-bg'
                        : 'border-line bg-surface text-ink-soft hover:bg-sunken'
                    }`}
                  >
                    <span aria-hidden="true">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Visibility</legend>
        <Segmented
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: 'shared', label: 'Shared' },
            { value: 'private', label: 'Private' },
          ]}
        />
        <p className="mt-2 text-[0.78rem] leading-relaxed text-ink-faint">
          {visibility === 'shared'
            ? 'Your group can see this habit and whether you’ve done it.'
            : 'Only you can see this — not even its name leaves your account.'}
        </p>
      </fieldset>

      {error && <ErrorText>{error}</ErrorText>}

      <Button type="submit" full disabled={submitting}>
        {submitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}

/** A row of mutually exclusive choices, styled as a segmented control. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="flex gap-1.5 rounded-2xl bg-sunken p-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`min-h-11 flex-1 rounded-xl px-2 text-[0.85rem] font-semibold transition-colors ${
            value === option.value
              ? 'bg-surface text-ink shadow-sm'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
