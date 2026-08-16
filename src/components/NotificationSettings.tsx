/**
 * The notifications section of the Me screen.
 *
 * Two deliberate rules:
 *
 *   1. The browser permission prompt is NEVER triggered on load. It only ever fires
 *      from a tap on "Enable" here. A prompt someone did not ask for is the fastest
 *      way to get notifications permanently blocked.
 *   2. Controls that cannot work are not shown. On an iPhone in Safari, push requires
 *      the app to be installed to the Home Screen first, so that is what it says
 *      rather than offering a button that would silently fail.
 *
 * The rest of the app works identically without any of this — push is an enhancement.
 */
import { useCallback, useEffect, useState } from 'react'
import type { NotificationPrefs } from '../types/models'
import {
  currentSubscription,
  notificationPermission,
  pushSupport,
  subscribeToPush,
  subscriptionKeys,
  unsubscribeFromPush,
} from '../lib/push'
import {
  DEFAULT_PREFS,
  deletePushSubscription,
  describePushResult,
  fetchNotificationPrefs,
  savePushSubscription,
  saveNotificationPrefs,
  sendTestPush,
} from '../services/notifications'
import { describeError } from '../lib/supabase'
import { useToast } from './Toast'
import { Card } from './Layout'
import { Button } from './ui'

export function NotificationSettings({ userId }: { userId: string }) {
  const { showToast } = useToast()
  const support = pushSupport()

  const [prefs, setPrefs] = useState<NotificationPrefs>({ user_id: userId, ...DEFAULT_PREFS })
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [loadedPrefs, subscription] = await Promise.all([
          fetchNotificationPrefs(userId),
          currentSubscription(),
        ])
        if (!active) return
        setPrefs(loadedPrefs)
        setSubscribed(subscription !== null && notificationPermission() === 'granted')
      } catch {
        // Preferences are not important enough to interrupt the screen for.
      } finally {
        if (active) setLoaded(true)
      }
    })()
    return () => {
      active = false
    }
  }, [userId])

  const update = useCallback(
    async (patch: Partial<Omit<NotificationPrefs, 'user_id'>>) => {
      const previous = prefs
      setPrefs((p) => ({ ...p, ...patch }))
      try {
        const saved = await saveNotificationPrefs(userId, { ...previous, ...patch })
        setPrefs(saved)
      } catch (cause) {
        setPrefs(previous)
        showToast(describeError(cause))
      }
    },
    [prefs, userId, showToast],
  )

  async function enable() {
    setBusy(true)
    try {
      const subscription = await subscribeToPush()
      await savePushSubscription(userId, subscriptionKeys(subscription))
      setSubscribed(true)
      showToast('Notifications are on 🔔', 'info')
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Fires a notification at the user's own devices and reports what happened.
   *
   * Deliberately re-saves the subscription first: the commonest cause of silence is a
   * browser subscription that exists locally but was never stored (or was stored under
   * an endpoint the browser has since rotated), and this repairs that case rather than
   * just reporting it.
   */
  async function test() {
    setBusy(true)
    setTestResult(null)
    try {
      const subscription = await currentSubscription()
      if (subscription) {
        await savePushSubscription(userId, subscriptionKeys(subscription))
      }
      const result = await sendTestPush()
      setTestResult({ ok: result.sent > 0, message: describePushResult(result) })
    } catch (cause) {
      setTestResult({
        ok: false,
        message: cause instanceof Error ? cause.message : describeError(cause),
      })
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      const endpoint = await unsubscribeFromPush()
      if (endpoint) await deletePushSubscription(endpoint)
      setSubscribed(false)
      showToast('Notifications are off', 'info')
    } catch (cause) {
      showToast(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card className="px-4 py-3.5">
        {support === 'ready' ? (
          subscribed ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.95rem] font-medium">Push notifications</p>
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[0.72rem] font-semibold text-accent-ink">
                  On
                </span>
              </div>
              <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-faint">
                You&rsquo;ll get a lock-screen alert on this device when your friends nudge
                you or ask for help.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => void test()}>
                  {busy ? 'Sending…' : 'Send a test'}
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => void disable()}>
                  Turn off on this device
                </Button>
              </div>
              {/*
                The result of a test is shown inline rather than as a toast: it can be
                two sentences long and is worth reading, not glancing at.
              */}
              {testResult && (
                <p
                  role="status"
                  className={`mt-3 text-[0.8rem] leading-relaxed ${
                    testResult.ok ? 'text-accent-ink' : 'text-danger'
                  }`}
                >
                  {testResult.message}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.95rem] font-medium">Push notifications</p>
                <Button disabled={busy} onClick={() => void enable()}>
                  {busy ? 'One moment…' : 'Enable'}
                </Button>
              </div>
              <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-faint">
                Get a lock-screen alert when your friends nudge you or ask for help.
              </p>
              {notificationPermission() === 'denied' && (
                <p className="mt-2 text-[0.8rem] leading-relaxed text-danger">
                  Notifications are currently blocked for this site. You&rsquo;ll need to
                  allow them in your browser settings first.
                </p>
              )}
            </>
          )
        ) : (
          <UnavailableNotice support={support} />
        )}
      </Card>

      {/*
        Preferences are shown even when this device cannot subscribe: they are
        per-account, not per-device, and are honoured by the server for whichever
        other device the person has enabled.
      */}
      {loaded && support !== 'not-configured' && (
        <Card className="mt-2.5 divide-y divide-line/70 px-4">
          <Toggle
            label="Nudges"
            hint="When someone pokes you about a habit."
            checked={prefs.nudges}
            onChange={(v) => void update({ nudges: v })}
          />
          <Toggle
            label="Friends asking for help"
            hint="When someone marks a habit at risk."
            checked={prefs.at_risk}
            onChange={(v) => void update({ at_risk: v })}
          />
          <Toggle
            label="Reactions"
            hint="When someone cheers one of your check-ins."
            checked={prefs.reactions}
            onChange={(v) => void update({ reactions: v })}
          />
          <Toggle
            label="Show habit names"
            hint="Off means notifications say “a habit” instead of naming it on your lock screen."
            checked={prefs.show_habit_names}
            onChange={(v) => void update({ show_habit_names: v })}
          />
        </Card>
      )}
    </>
  )
}

function UnavailableNotice({ support }: { support: ReturnType<typeof pushSupport> }) {
  if (support === 'needs-install') {
    return (
      <>
        <p className="text-[0.95rem] font-medium">Push notifications</p>
        <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-faint">
          Add Habits to your Home Screen first, then come back here and enable them.
          Tap the share button, then <em>Add to Home Screen</em>.
        </p>
      </>
    )
  }

  if (support === 'not-configured') {
    return (
      <>
        <p className="text-[0.95rem] font-medium">Push notifications</p>
        <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-faint">
          This build doesn&rsquo;t have push configured yet.
        </p>
      </>
    )
  }

  return (
    <>
      <p className="text-[0.95rem] font-medium">Push notifications</p>
      <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-faint">
        This browser can&rsquo;t do push notifications. Everything else works normally.
      </p>
    </>
  )
}

/** A labelled switch. A real checkbox underneath, so it is keyboard-operable. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-3 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[0.92rem] font-medium">{label}</span>
        <span className="mt-0.5 block text-[0.75rem] leading-snug text-ink-faint">{hint}</span>
      </span>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`relative flex h-7 w-12 shrink-0 items-center rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
          checked ? 'bg-accent' : 'bg-line'
        }`}
      >
        <span
          className={`absolute size-5 rounded-full bg-surface shadow transition-all ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </span>
    </label>
  )
}
