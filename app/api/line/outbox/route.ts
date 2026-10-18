import { timingSafeEqual } from 'node:crypto'
import { processOutbox } from '@/lib/line/outbox'
import { createLineProvider, lineDeliveryMode } from '@/lib/line/provider'
import { createSupabaseLineStore } from '@/lib/line/supabase-store'

/**
 * Outbox worker for a scheduler (cron): sends queued LINE messages and retries failed ones
 * (backoff in lib/line/retry, same X-Line-Retry-Key, so LINE delivers each message once).
 * Off unless the server has LINE_OUTBOX_CRON_SECRET; the caller sends it as a Bearer token.
 * In mock mode nothing is pushed, so a queued message is never recorded as sent.
 */
export const dynamic = 'force-dynamic'

function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '')
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.LINE_OUTBOX_CRON_SECRET
  if (!secret || secret.length < 32) return Response.json({ ok: false, error: 'LINE_WORKER_DISABLED' }, { status: 503 })
  if (!authorized(request.headers.get('authorization'), secret)) return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  if (lineDeliveryMode() !== 'live') return Response.json({ ok: true, mode: 'mock', claimed: 0, sent: 0, retried: 0, dead: 0 })
  try {
    const store = createSupabaseLineStore()
    const { accessToken } = await store.credentials()
    if (!accessToken) return Response.json({ ok: false, error: 'LINE_NOT_CONFIGURED' }, { status: 503 })
    const result = await processOutbox({ store, provider: createLineProvider(accessToken), limit: 50 })
    return Response.json({ ok: true, mode: 'live', ...result })
  } catch {
    return Response.json({ ok: false, error: 'LINE_WORKER_FAILED' }, { status: 500 })
  }
}
