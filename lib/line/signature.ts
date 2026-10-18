import 'server-only'

/**
 * Webhook signature check: x-line-signature = base64(HMAC-SHA256(channelSecret, raw body)).
 * Web Crypto only (works on Node and edge runtimes). The raw body must be the exact bytes LINE
 * sent — parse JSON only after this returns true.
 */

const encoder = new TextEncoder()

async function hmacBase64(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))
  let binary = ''
  for (const byte of mac) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Length-independent comparison so timing does not reveal how much of a guess matched. */
function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export async function verifyLineSignature(channelSecret: string, rawBody: string, signature: string | null | undefined): Promise<boolean> {
  if (!channelSecret || !signature || signature.length > 200) return false
  return sameText(await hmacBase64(channelSecret, rawBody), signature.trim())
}

/** Same HMAC, for tests and the local mock sender only. */
export async function signLineBody(channelSecret: string, rawBody: string): Promise<string> {
  return hmacBase64(channelSecret, rawBody)
}
