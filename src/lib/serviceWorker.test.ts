/**
 * Tests for `public/sw.js`.
 *
 * A service worker cannot be registered in a plain test runner (or, as it happens, in
 * some embedded browser panes), so the file is evaluated in a `vm` sandbox with the
 * handful of globals it touches stubbed out. The event handlers it registers are then
 * called directly.
 *
 * This is the substitute for a browser: it verifies the two things most likely to be
 * wrong and most expensive to discover in production —
 *
 *   1. every URL it builds is relative to its own scope, so it works under the
 *      GitHub Pages subpath `/habit-tracker/` and not just at the root;
 *   2. it never caches a Supabase response, which would leak one account's data to
 *      the next person to sign in on that device.
 */
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const SCOPE = 'https://monicakodwani.github.io/habit-tracker/'

interface Harness {
  handlers: Record<string, (event: Record<string, unknown>) => void>
  shown: { title: string; options: Record<string, unknown> }[]
  opened: string[]
  cachePuts: string[]
}

/** Loads sw.js into a sandbox and returns everything it did. */
function loadWorker(): Harness {
  const source = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8')

  const handlers: Harness['handlers'] = {}
  const shown: Harness['shown'] = []
  const opened: Harness['opened'] = []
  const cachePuts: Harness['cachePuts'] = []

  const cacheStub = {
    addAll: async () => undefined,
    put: async (request: { url?: string } | string) => {
      cachePuts.push(typeof request === 'string' ? request : (request.url ?? ''))
    },
    match: async () => undefined,
  }

  const self = {
    location: { origin: 'https://monicakodwani.github.io' },
    registration: {
      scope: SCOPE,
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options })
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened.push(url)
      },
    },
    skipWaiting: async () => undefined,
    addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
      handlers[type] = handler
    },
  }

  const context = createContext({
    self,
    caches: {
      open: async () => cacheStub,
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
    fetch: async () => ({ ok: true, type: 'basic', clone: () => ({}) }),
    Response: { error: () => ({ error: true }) },
    URL,
    console,
  })

  runInContext(source, context)
  return { handlers, shown, opened, cachePuts }
}

let sw: Harness

beforeEach(() => {
  sw = loadWorker()
})

describe('registration', () => {
  it('registers the handlers the app depends on', () => {
    expect(Object.keys(sw.handlers).sort()).toEqual(
      ['activate', 'fetch', 'install', 'notificationclick', 'push'].sort(),
    )
  })
})

describe('push', () => {
  const push = (payload: unknown) => {
    const waits: Promise<unknown>[] = []
    sw.handlers.push?.({
      data: { json: () => payload },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    })
    return waits
  }

  it('shows the notification the server sent', () => {
    push({ title: '👀 Monica nudged you', body: 'Reading — “woman please.”', tag: 'nudge:1', url: '#/' })

    expect(sw.shown).toHaveLength(1)
    expect(sw.shown[0]?.title).toBe('👀 Monica nudged you')
    expect(sw.shown[0]?.options.body).toBe('Reading — “woman please.”')
  })

  it('builds icon URLs under its own scope, not the root', () => {
    // The bug this catches: an icon at "/icons/icon-192.png" 404s on GitHub Pages,
    // where everything lives under /habit-tracker/.
    push({ title: 'x' })
    expect(sw.shown[0]?.options.icon).toBe(`${SCOPE}icons/icon-192.png`)
    expect(sw.shown[0]?.options.badge).toBe(`${SCOPE}icons/icon-192.png`)
  })

  it('collapses repeats about the same thing via the tag', () => {
    push({ title: 'x', tag: 'nudge:abc' })
    expect(sw.shown[0]?.options.tag).toBe('nudge:abc')
  })

  it('survives a malformed or empty payload', () => {
    const waits: Promise<unknown>[] = []
    sw.handlers.push?.({
      data: {
        json: () => {
          throw new Error('not json')
        },
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    })
    expect(sw.shown[0]?.title).toBe('Habits')
  })
})

describe('notificationclick', () => {
  const click = (data: unknown) => {
    const waits: Promise<unknown>[] = []
    sw.handlers.notificationclick?.({
      notification: { close: () => undefined, data },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    })
    return Promise.all(waits)
  }

  it('opens the hash route under the app’s scope', async () => {
    await click({ url: '#/activity' })
    expect(sw.opened).toEqual([`${SCOPE}#/activity`])
  })

  it('defaults to Today', async () => {
    await click(undefined)
    expect(sw.opened).toEqual([`${SCOPE}#/`])
  })

  it('tolerates a route given without its hash', async () => {
    await click({ url: '/week' })
    expect(sw.opened).toEqual([`${SCOPE}#/week`])
  })
})

describe('fetch caching', () => {
  /** Returns the response the handler chose to serve, or null if it declined. */
  function handleFetch(url: string, mode = 'no-cors') {
    let responded: unknown = null
    sw.handlers.fetch?.({
      request: { url, method: 'GET', mode },
      respondWith: (r: unknown) => {
        responded = r
      },
    })
    return responded
  }

  it('NEVER touches Supabase requests', () => {
    // The important one. Caching an authenticated API response could serve one
    // account's habits to the next person who signs in on the same device.
    expect(handleFetch('https://abc.supabase.co/rest/v1/habits?select=*')).toBeNull()
    expect(handleFetch('https://abc.supabase.co/auth/v1/token')).toBeNull()
    expect(sw.cachePuts).toEqual([])
  })

  it('ignores anything outside its own scope', () => {
    // A sibling app at the domain root must be unaffected.
    expect(handleFetch('https://monicakodwani.github.io/other-app/index.js')).toBeNull()
  })

  it('handles navigations within its scope', () => {
    expect(handleFetch(`${SCOPE}#/week`, 'navigate')).not.toBeNull()
  })

  it('caches fingerprinted static assets', () => {
    expect(handleFetch(`${SCOPE}assets/index-abc123.js`)).not.toBeNull()
    expect(handleFetch(`${SCOPE}assets/index-abc123.css`)).not.toBeNull()
    expect(handleFetch(`${SCOPE}icons/icon-192.png`)).not.toBeNull()
  })

  it('declines non-GET requests', () => {
    let responded: unknown = null
    sw.handlers.fetch?.({
      request: { url: `${SCOPE}assets/x.js`, method: 'POST', mode: 'cors' },
      respondWith: (r: unknown) => {
        responded = r
      },
    })
    expect(responded).toBeNull()
  })
})
