/**
 * Generates a VAPID key pair for Web Push.
 *
 *   npm run vapid
 *
 * Uses Node's built-in WebCrypto — no dependency, nothing installed, nothing sent
 * anywhere. Run it once; the keys are permanent for this app.
 *
 * The PUBLIC key goes in the frontend (VITE_VAPID_PUBLIC_KEY). It is compiled into
 * the bundle and is meant to be visible — it is what browsers encrypt to.
 *
 * The PRIVATE key goes ONLY into a Supabase Edge Function secret. It must never be
 * committed, never appear in a VITE_ variable, and never reach a browser: anyone
 * holding it can push notifications to your users.
 */
import { webcrypto as crypto } from 'node:crypto'

const base64url = (buffer) =>
  Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])

// The public key is the raw uncompressed EC point; the private key is the `d` value
// from the JWK. That is exactly the form web-push and the Push API expect.
const publicKey = base64url(await crypto.subtle.exportKey('raw', pair.publicKey))
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const privateKey = jwk.d

console.log(`
VAPID keys generated. Run this once and keep the private key safe.

──────────────────────────────────────────────────────────────
PUBLIC  (safe in the browser — goes in .env and GitHub secrets)

  VITE_VAPID_PUBLIC_KEY=${publicKey}

──────────────────────────────────────────────────────────────
PRIVATE (NEVER commit, NEVER put in a VITE_ variable)

  ${privateKey}

Set it as a Supabase Edge Function secret:

  supabase secrets set \\
    VAPID_PUBLIC_KEY=${publicKey} \\
    VAPID_PRIVATE_KEY=${privateKey} \\
    VAPID_SUBJECT=mailto:you@example.com

──────────────────────────────────────────────────────────────
`)
