/**
 * Profile — display name, avatar emoji, timezone.
 *
 * The timezone matters more than it looks: it decides when your day starts and ends,
 * and therefore what counts as "today" for every one of your habits.
 */
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import { useToast } from '../components/Toast'
import { guessTimezone, isValidTimezone } from '../domain/dates'
import { describeError } from '../lib/supabase'
import { PageHeader, Screen } from '../components/Layout'
import { Button, ErrorText, Field, INPUT_CLASS } from '../components/ui'

const AVATAR_CHOICES = ['🌻', '🦆', '🪿', '🐿️', '🍄', '🌙', '🪴', '🐌', '☕️', '🧊', '🦔', '🫐']

export function ProfileScreen() {
  const navigate = useNavigate()
  const { me, updateProfile } = useAppData()
  const { showToast } = useToast()

  const [displayName, setDisplayName] = useState(me?.display_name ?? '')
  const [avatar, setAvatar] = useState(me?.avatar_emoji ?? '🌱')
  const [timezone, setTimezone] = useState(me?.timezone ?? guessTimezone())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const zones = useMemo(buildZoneList, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setError(null)

    if (!displayName.trim()) {
      setError('Your friends need something to call you.')
      return
    }
    if (!isValidTimezone(timezone)) {
      setError('That timezone is not one this browser recognises.')
      return
    }

    setSaving(true)
    try {
      await updateProfile({
        display_name: displayName.trim(),
        avatar_emoji: avatar.trim() || '🌱',
        timezone,
      })
      navigate('/me', { replace: true })
    } catch (cause) {
      showToast(describeError(cause))
      setSaving(false)
    }
  }

  return (
    <Screen>
      <PageHeader title="Your profile" backTo="/me" backLabel="Me" />

      <form onSubmit={handleSubmit} noValidate className="space-y-7">
        <div>
          <span className="mb-2 block text-sm font-semibold text-ink">Avatar</span>
          <div className="flex items-start gap-3">
            {/* Sized by the wrapper, not the input — see INPUT_CLASS. */}
            <div className="w-[4.5rem] shrink-0">
              <input
                className={`${INPUT_CLASS} px-2 text-center text-2xl`}
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                aria-label="Avatar emoji"
                maxLength={8}
              />
            </div>
            <ul className="flex min-w-0 flex-1 flex-wrap gap-1">
              {AVATAR_CHOICES.map((choice) => (
                <li key={choice}>
                  <button
                    type="button"
                    onClick={() => setAvatar(choice)}
                    aria-label={`Use ${choice}`}
                    aria-pressed={avatar === choice}
                    className={`flex size-11 items-center justify-center rounded-xl text-xl transition-colors ${
                      avatar === choice ? 'bg-accent-soft' : 'hover:bg-sunken'
                    }`}
                  >
                    <span aria-hidden="true">{choice}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Field label="Name">
          <input
            className={INPUT_CLASS}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="nickname"
            maxLength={40}
            enterKeyHint="done"
            required
          />
        </Field>

        <Field
          label="Timezone"
          hint="Decides when your day starts and ends, and what counts as today."
        >
          <select
            className={INPUT_CLASS}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {/* A stored zone missing from the list must still be selectable. */}
            {!zones.includes(timezone) && <option value={timezone}>{timezone}</option>}
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>

        {error && <ErrorText>{error}</ErrorText>}

        <Button type="submit" full disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Screen>
  )
}

/**
 * The list of selectable timezones.
 *
 * Modern browsers can enumerate every IANA zone; where they cannot, a short list of
 * common ones plus the browser's own guess keeps the field usable rather than empty.
 */
function buildZoneList(): string[] {
  const supported = (
    Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf

  if (typeof supported === 'function') {
    try {
      return supported('timeZone')
    } catch {
      // Fall through to the short list below.
    }
  }

  return [
    ...new Set([
      guessTimezone(),
      'America/Los_Angeles',
      'America/Denver',
      'America/Chicago',
      'America/New_York',
      'America/Toronto',
      'Europe/London',
      'Europe/Dublin',
      'Europe/Paris',
      'Europe/Berlin',
      'Asia/Kolkata',
      'Asia/Singapore',
      'Asia/Tokyo',
      'Australia/Sydney',
      'UTC',
    ]),
  ].sort()
}
