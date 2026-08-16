/**
 * Web Push plumbing: capability detection, service-worker registration and
 * subscription.
 *
 * The VAPID **public** key is the only key that appears here, and it is meant to be
 * public — it is what the browser encrypts to. The private key lives exclusively in
 * a Supabase Edge Function secret and never touches this bundle.
 *
 * iOS is the environment that matters most for this app and it has a specific rule:
 * Safari only allows push for a web app that has been added to the Home Screen. This
 * module reports that as its own state so the UI can say something useful instead of
 * showing a button that silently fails.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

/** Whether the app was built with a VAPID public key at all. */
export const isPushConfigured = VAPID_PUBLIC_KEY.length > 0

export type PushSupport =
  | 'ready' // everything present; the user can enable notifications
  | 'needs-install' // iOS Safari in a browser tab — must be added to the Home Screen first
  | 'unsupported' // this browser cannot do Web Push at all
  | 'not-configured' // the deployment has no VAPID public key

/** True when running as an installed PWA rather than in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own non-standard flag, which is what iOS actually sets.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function pushSupport(): PushSupport {
  if (!isPushConfigured) return 'not-configured'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // On iOS the APIs are simply absent until the app is installed, so this is the
    // branch an iPhone user in Safari actually hits.
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (isIOS() && !isStandalone()) return 'needs-install'
  return 'ready'
}

export function notificationPermission(): NotificationPermission | 'unavailable' {
  return 'Notification' in window ? Notification.permission : 'unavailable'
}

/**
 * Registers the service worker.
 *
 * Both the script URL and the scope come from `import.meta.env.BASE_URL`, which Vite
 * sets to `/habit-tracker/` in the deployed build and `/` locally. Hard-coding `/sw.js`
 * would register at the wrong scope on GitHub Pages and silently never receive a push.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const base = import.meta.env.BASE_URL || '/'

  try {
    return await navigator.serviceWorker.register(`${base}sw.js`, { scope: base })
  } catch (cause) {
    console.warn('[push] service worker registration failed', cause)
    return null
  }
}

/** The browser's existing subscription for this app, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.getRegistration(
    import.meta.env.BASE_URL || '/',
  )
  return (await registration?.pushManager.getSubscription()) ?? null
}

/**
 * Asks for permission and subscribes.
 *
 * MUST be called from a real user gesture — browsers reject a permission prompt that
 * was not triggered by a click, and iOS is strict about it. Nothing in the app calls
 * this on load.
 */
export async function subscribeToPush(): Promise<PushSubscription> {
  if (!isPushConfigured) {
    throw new Error('This build has no VAPID public key, so push cannot be enabled.')
  }

  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready)

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked. Turn them back on in your browser settings for this site.'
        : 'Notifications were not enabled.',
    )
  }

  const existing = await registration.pushManager.getSubscription()
  if (existing) return existing

  return registration.pushManager.subscribe({
    // Required by every browser: only pushes the user can see, no silent pushes.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
}

/** Unsubscribes this browser. Returns the endpoint that was removed, if any. */
export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await currentSubscription()
  if (!subscription) return null
  const { endpoint } = subscription
  await subscription.unsubscribe()
  return endpoint
}

/** The base64url-encoded keys a `PushSubscription` carries, for storage. */
export function subscriptionKeys(subscription: PushSubscription) {
  const raw = subscription.toJSON()
  const keys = raw.keys ?? {}
  return {
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh ?? '',
    auth: keys.auth ?? '',
  }
}

/**
 * VAPID keys travel as base64url text but `applicationServerKey` wants raw bytes.
 * Standard conversion — base64url to base64, pad, decode.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  // Backed by an explicit ArrayBuffer: `applicationServerKey` will not accept a view
  // that might sit on a SharedArrayBuffer.
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}
