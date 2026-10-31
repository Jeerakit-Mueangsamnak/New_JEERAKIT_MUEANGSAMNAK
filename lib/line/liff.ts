import { LINE_USER_ID_PATTERN } from './types'

/**
 * LIFF ID token check (LINE Login). The LIFF page sends liff.getIDToken(); LINE itself tells
 * us whose token it is (sub = LINE userId), so a page can never claim someone else's userId.
 * The LINE Login channel must sit under the same provider as the Messaging API channel, or
 * the userId would not match the one the OA sees.
 */
const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify'
const TIMEOUT_MS = 10_000

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type LiffVerifyResult = { ok: true; lineUserId: string; name: string | null } | { ok: false; error: 'TOKEN_INVALID' | 'NETWORK' }

export async function verifyLiffIdToken(idToken: string, channelId: string, fetchImpl: FetchLike = fetch): Promise<LiffVerifyResult> {
  if (!idToken || idToken.length > 4096 || !/^\d{6,20}$/.test(channelId)) return { ok: false, error: 'TOKEN_INVALID' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, error: 'TOKEN_INVALID' }
    const body = (await res.json()) as { sub?: unknown; name?: unknown; aud?: unknown; exp?: unknown }
    if (typeof body.sub !== 'string' || !LINE_USER_ID_PATTERN.test(body.sub)) return { ok: false, error: 'TOKEN_INVALID' }
    if (body.aud !== undefined && String(body.aud) !== channelId) return { ok: false, error: 'TOKEN_INVALID' }
    if (typeof body.exp === 'number' && body.exp * 1000 < Date.now()) return { ok: false, error: 'TOKEN_INVALID' }
    return { ok: true, lineUserId: body.sub, name: typeof body.name === 'string' ? body.name.slice(0, 200) : null }
  } catch {
    return { ok: false, error: 'NETWORK' }
  } finally {
    clearTimeout(timer)
  }
}
