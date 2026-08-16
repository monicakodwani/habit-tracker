/**
 * Notification preferences and push subscriptions.
 *
 * `push_subscriptions` holds the endpoint and crypto material for a device. Anyone
 * with those values can push to that device, so the table is readable ONLY by its
 * owner — a friend cannot retrieve somebody's endpoint, and it is deliberately not
 * in the realtime publication. The Edge Function reads it server-side with the
 * service-role key, which never leaves Supabase.
 */
import { supabase } from '../lib/supabase'
import type { NotificationPrefs } from '../types/models'

const PREF_COLUMNS = 'user_id, nudges, at_risk, reactions, show_habit_names'

/** Sensible defaults, used until a row exists. Mirrors the column defaults in SQL. */
export const DEFAULT_PREFS: Omit<NotificationPrefs, 'user_id'> = {
  nudges: true,
  at_risk: true,
  // The noisiest and least urgent of the three, so it starts off.
  reactions: false,
  show_habit_names: true,
}

/** The user's preferences, or the defaults if they have never changed them. */
export async function fetchNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from('notification_prefs')
    .select(PREF_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data ?? { user_id: userId, ...DEFAULT_PREFS }
}

/** Creates or updates the row. RLS restricts it to the caller's own preferences. */
export async function saveNotificationPrefs(
  userId: string,
  patch: Partial<Omit<NotificationPrefs, 'user_id'>>,
): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: userId, ...DEFAULT_PREFS, ...patch }, { onConflict: 'user_id' })
    .select(PREF_COLUMNS)
    .single()

  if (error) throw error
  return data
}

export interface PushSubscriptionRecord {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Stores a browser's push subscription.
 *
 * Upserts on `endpoint`: the same browser re-subscribing updates its row rather than
 * accumulating duplicates, which is what stops one device receiving five copies of
 * every nudge.
 */
export async function savePushSubscription(
  userId: string,
  sub: PushSubscriptionRecord,
): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: navigator.userAgent.slice(0, 300),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )

  if (error) throw error
}

/** Forgets a subscription — used when the user turns notifications off. */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)

  if (error) throw error
}

/** Whether this browser already has a subscription stored for this user. */
export async function hasStoredSubscription(
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
    .maybeSingle()

  if (error) throw error
  return data !== null
}

/**
 * Asks the Edge Function to deliver a push for an event that has already been saved.
 *
 * Called after the social action succeeds, never instead of it. The function
 * authenticates the caller's JWT and verifies they are genuinely the actor of that
 * event before sending anything, so it cannot be used as a general-purpose relay to
 * push arbitrary text at people.
 *
 * Push failure is deliberately not surfaced as an error: the nudge is already stored
 * and visible in the app. A silent lock screen is a much smaller problem than a nudge
 * that appears to have failed when it did not.
 */
export async function requestPushDelivery(kind: 'nudge' | 'at_risk' | 'reaction', id: string) {
  try {
    const { error } = await supabase.functions.invoke('send-push', {
      body: { kind, id },
    })
    if (error) {
      console.warn('[push] delivery request failed', error.message)
    }
  } catch (cause) {
    console.warn('[push] delivery request failed', cause)
  }
}

/** What the Edge Function reports back about a delivery attempt. */
export interface PushResult {
  sent: number
  devices: number
  muted?: number
  expired?: number
  failed?: number
  lastError?: string
  skipped?: string
}

/**
 * Sends a notification to the signed-in user's own devices.
 *
 * Exists because "nothing arrived" has several possible causes that look identical
 * from the outside — no subscription stored, a VAPID key mismatch, a preference
 * switched off, an endpoint the browser has since discarded. This exercises the whole
 * chain alone and reports which one it was.
 *
 * Unlike the other kinds, failures here are thrown rather than swallowed: the user
 * explicitly asked, so they should see the answer.
 */
export async function sendTestPush(): Promise<PushResult> {
  const { data, error } = await supabase.functions.invoke('send-push', {
    body: { kind: 'test' },
  })
  if (error) throw error
  return data as PushResult
}

/** Turns a {@link PushResult} into a sentence that names the actual problem. */
export function describePushResult(result: PushResult): string {
  if (result.skipped === 'vapid-not-configured') {
    return 'The server has no VAPID keys set, so it cannot send push. See the README.'
  }
  if (result.devices === 0) {
    return 'No devices are registered for your account. Try turning notifications off and on again on this device.'
  }
  if (result.expired && result.expired > 0 && result.sent === 0) {
    return 'This device’s subscription had expired and has been removed. Turn notifications off and on again.'
  }
  if (result.failed && result.failed > 0 && result.sent === 0) {
    return `The push service rejected it (${result.lastError ?? 'unknown error'}). This usually means the server’s VAPID keys don’t match the one this app was built with.`
  }
  if (result.sent === 0) {
    return 'Nothing was sent. Check the function logs in the Supabase dashboard.'
  }
  return `Sent to ${result.sent} device${result.sent === 1 ? '' : 's'}. It should appear in a moment.`
}
