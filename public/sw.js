/* eslint-env serviceworker */
/**
 * Service worker.
 *
 * Two jobs, kept deliberately separate:
 *
 *   1. Receive Web Push and show a notification.
 *   2. Cache the static app shell so an installed PWA opens instantly and survives a
 *      flaky connection.
 *
 * WHAT IS NEVER CACHED
 * --------------------
 * Anything that is not a same-origin static asset. Supabase responses in particular
 * are always network-only: they are per-user and authenticated, and caching them
 * could serve one account's habits to another after a sign-out. The fetch handler
 * bails out early on anything cross-origin.
 *
 * SCOPE
 * -----
 * This file is served from the app's base path (`/habit-tracker/` in production, `/`
 * locally), and registered with a matching scope, so `self.registration.scope` is the
 * right base for every URL built below. Nothing here assumes the root.
 */

const CACHE_VERSION = 'habits-v2'
const APP_SHELL = 'index.html'

/** Absolute URL for a path relative to this worker's scope. */
function scoped(path) {
  return new URL(path, self.registration.scope).toString()
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([scoped(APP_SHELL), scoped('manifest.webmanifest')]))
      // A failed precache must not block activation — the app still works online.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Cross-origin means Supabase (or anything else). Never touched.
  if (url.origin !== self.location.origin) return
  // Only cache within this app's scope, so a root-hosted sibling app is unaffected.
  if (!request.url.startsWith(self.registration.scope)) return

  // Navigations: network first, falling back to the cached shell when offline. The
  // app is a hash-router SPA, so the shell answers every route.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(CACHE_VERSION).then((cache) => cache.put(scoped(APP_SHELL), copy))
          return response
        })
        .catch(() =>
          caches.match(scoped(APP_SHELL)).then((cached) => cached ?? Response.error()),
        ),
    )
    return
  }

  // Static assets: cache first. Vite fingerprints filenames, so a cached hit is
  // always the exact build that asked for it and can never go stale.
  const isAsset = /\.(?:js|css|woff2?|png|svg|webmanifest|ico)$/.test(url.pathname)
  if (!isAsset) return

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})

/**
 * A push arrived.
 *
 * The payload is built by the Edge Function and already respects the recipient's
 * preferences, including whether habit names may appear on a lock screen.
 */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload.title || 'Habits'
  const options = {
    body: payload.body || '',
    icon: scoped('icons/icon-192.png'),
    badge: scoped('icons/icon-192.png'),
    // Collapses repeats: a second nudge about the same habit replaces the first
    // rather than stacking up on the lock screen.
    tag: payload.tag || 'habits',
    renotify: true,
    data: { url: payload.url || '#/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

/**
 * Tapping a notification.
 *
 * Focuses an already-open tab where possible rather than opening a second copy, and
 * navigates it to the hash route the payload asked for. Hash routes are what the app
 * uses on GitHub Pages, so these links work in production and locally alike.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const hash = (event.notification.data && event.notification.data.url) || '#/'
  const target = scoped(hash.startsWith('#') ? hash : `#${hash}`)

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          // Same document, different hash: navigate then focus.
          if ('navigate' in client) {
            return client.navigate(target).then((c) => (c ? c.focus() : undefined))
          }
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
