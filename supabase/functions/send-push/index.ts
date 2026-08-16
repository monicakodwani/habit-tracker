/**
 * send-push — delivers a Web Push for a social action that has ALREADY been stored.
 *
 * THREAT MODEL
 * ------------
 * This function holds the service-role key and the VAPID private key, so it must
 * never become a relay that lets anyone push arbitrary text at anyone. Three things
 * prevent that:
 *
 *   1. It takes an *id of an existing row*, never a message. All notification text is
 *      constructed here from the database, so a caller cannot supply the body.
 *   2. It authenticates the caller's JWT and verifies they are genuinely the actor of
 *      that row — the sender of that nudge, the owner of that at-risk habit. A valid
 *      login for an unrelated account gets nothing.
 *   3. Recipients are derived from the row (the nudge's recipient, the actor's group),
 *      never from the request.
 *
 * It is also deliberately best-effort: the social action is already committed before
 * this is called, so a push failure never undoes a nudge.
 *
 * DEPLOY
 *   supabase functions deploy send-push
 *   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
/*
 * Supabase injects the service-role key automatically, but the variable has been
 * named differently across project vintages. Take whichever is present rather than
 * assuming one — a missing key here surfaces as an opaque 500 from deep inside the
 * client constructor, which is a miserable thing to debug.
 */
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? ''

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:habits@example.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Kind = 'nudge' | 'at_risk' | 'reaction'

interface Payload {
  title: string
  body: string
  tag: string
  url: string
}

/** Which preference column gates each kind of notification. */
const PREF_COLUMN: Record<Kind, 'nudges' | 'at_risk' | 'reactions'> = {
  nudge: 'nudges',
  at_risk: 'at_risk',
  reaction: 'reactions',
}

const DEFAULT_PREFS = {
  nudges: true,
  at_risk: true,
  reactions: false,
  show_habit_names: true,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Names the stage that failed, so a 500 says *where* without revealing anything.
  let stage = 'init'

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: 'Server misconfigured', stage: 'env' }, 500)
    }

    stage = 'auth'
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
    const token = authHeader.slice('Bearer '.length)

    /*
     * One client, service-role, used for two distinct jobs:
     *
     *   - `getUser(token)` validates the caller's JWT and tells us who they are.
     *     Passing the token explicitly means this does NOT depend on the anon key
     *     being present in the environment, which is one fewer thing to get wrong.
     *   - reading push_subscriptions, which no user may read for anyone else.
     *
     * Authorisation is never delegated to RLS here — every path below explicitly
     * checks that the caller is the actor of the row they named.
     */
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData } = await admin.auth.getUser(token)
    const caller = userData?.user
    // An anon key is a valid JWT but not a user, so this is also what rejects it.
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    stage = 'parse'
    const { kind, id } = (await req.json()) as { kind?: Kind; id?: string }
    if (!kind || !id || !(kind in PREF_COLUMN)) return json({ error: 'Bad request' }, 400)

    /*
     * VAPID is configured only after the caller is authenticated and their request
     * validated. Doing it first meant a key problem produced a 500 for everyone,
     * masking ordinary 401s and making the whole function look broken.
     */
    stage = 'vapid'
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      // Not an error worth surfacing: the app works fine without push.
      return json({ sent: 0, skipped: 'vapid-not-configured' })
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    stage = 'resolve'

    const resolved = await resolve(admin, kind, id, caller.id)
    if (!resolved) {
      // Either the row does not exist or the caller is not its actor. Same answer
      // either way, so this cannot be used to probe for row ids.
      return json({ error: 'Not allowed' }, 403)
    }

    const { recipients, payload } = resolved
    if (recipients.length === 0) return json({ sent: 0 })

    stage = 'deliver'
    const sent = await deliver(admin, kind, recipients, payload)
    return json({ sent })
  } catch (cause) {
    // Never log subscription keys or tokens — only the message and the stage.
    console.error('[send-push]', stage, cause instanceof Error ? cause.message : 'unknown error')
    return json({ error: 'Internal error', stage }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// deno-lint-ignore no-explicit-any
type Admin = any

/**
 * Turns (kind, id, caller) into a verified recipient list and a payload.
 *
 * Returns null whenever the caller is not the actor, which is the authorisation gate.
 */
async function resolve(
  admin: Admin,
  kind: Kind,
  id: string,
  callerId: string,
): Promise<{ recipients: string[]; payload: Omit<Payload, 'body'> & { habit: string; body: string } } | null> {
  if (kind === 'nudge') {
    const { data: nudge } = await admin
      .from('nudges')
      .select('id, sender_id, recipient_id, habit_id, message, habits(name, visibility)')
      .eq('id', id)
      .maybeSingle()

    // Only the sender of this exact nudge may trigger its push.
    if (!nudge || nudge.sender_id !== callerId) return null
    // Belt and braces: send_nudge already refuses private habits.
    if (nudge.habits?.visibility !== 'shared') return null

    const { data: sender } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', callerId)
      .maybeSingle()

    return {
      recipients: [nudge.recipient_id],
      payload: {
        title: `👀 ${sender?.display_name ?? 'Someone'} nudged you`,
        habit: nudge.habits?.name ?? 'a habit',
        body: nudge.message,
        tag: `nudge:${nudge.habit_id}`,
        url: '#/',
      },
    }
  }

  if (kind === 'at_risk') {
    // Here `id` is the habit id: the marker is per habit per day.
    const { data: habit } = await admin
      .from('habits')
      .select('id, owner_id, group_id, name, visibility, active')
      .eq('id', id)
      .maybeSingle()

    if (!habit || habit.owner_id !== callerId) return null
    if (habit.visibility !== 'shared' || !habit.active) return null

    const { data: owner } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', callerId)
      .maybeSingle()

    // Everyone else in the habit's group.
    const { data: members } = await admin
      .from('group_members')
      .select('user_id')
      .eq('group_id', habit.group_id)

    return {
      recipients: (members ?? [])
        .map((m: { user_id: string }) => m.user_id)
        .filter((uid: string) => uid !== callerId),
      payload: {
        title: `⚠️ ${owner?.display_name ?? 'Someone'} needs a push`,
        habit: habit.name,
        body: 'is at risk today.',
        tag: `at-risk:${habit.id}`,
        url: '#/',
      },
    }
  }

  // kind === 'reaction' — `id` is the reaction id.
  const { data: reaction } = await admin
    .from('event_reactions')
    .select('id, user_id, emoji, activity_events(actor_id, metadata)')
    .eq('id', id)
    .maybeSingle()

  if (!reaction || reaction.user_id !== callerId) return null

  const targetUser = reaction.activity_events?.actor_id
  // Reacting to your own event should not notify you.
  if (!targetUser || targetUser === callerId) return null

  const { data: reactor } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', callerId)
    .maybeSingle()

  return {
    recipients: [targetUser],
    payload: {
      title: `${reaction.emoji} ${reactor?.display_name ?? 'Someone'} reacted`,
      habit: reaction.activity_events?.metadata?.habit_name ?? 'a habit',
      body: 'to your check-in',
      tag: `reaction:${reaction.id}`,
      url: '#/activity',
    },
  }
}

/**
 * Sends to every eligible recipient's devices.
 *
 * Honours each recipient's preferences server-side — including `show_habit_names`,
 * because these land on lock screens. Hiding the name in the UI after sending it
 * would be pointless.
 *
 * Subscriptions rejected with 404 or 410 are gone for good, so they are deleted
 * rather than retried forever.
 */
async function deliver(
  admin: Admin,
  kind: Kind,
  recipients: string[],
  payload: Omit<Payload, 'body'> & { habit: string; body: string },
): Promise<number> {
  let sent = 0

  for (const userId of recipients) {
    const { data: prefsRow } = await admin
      .from('notification_prefs')
      .select('nudges, at_risk, reactions, show_habit_names')
      .eq('user_id', userId)
      .maybeSingle()

    const prefs = prefsRow ?? DEFAULT_PREFS
    if (!prefs[PREF_COLUMN[kind]]) continue

    const subject = prefs.show_habit_names ? payload.habit : 'a habit'
    const body =
      kind === 'nudge'
        ? `${subject} — “${payload.body}”`
        : kind === 'at_risk'
          ? `${subject} ${payload.body}`
          : `${payload.body}: ${subject}`

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId)

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: payload.title, body, tag: payload.tag, url: payload.url }),
          { TTL: 60 * 60 * 12 },
        )
        sent += 1
      } catch (cause) {
        const status = (cause as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // The browser threw this subscription away; stop trying forever.
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          console.error('[send-push] delivery failed', status ?? 'unknown')
        }
      }
    }
  }

  return sent
}
