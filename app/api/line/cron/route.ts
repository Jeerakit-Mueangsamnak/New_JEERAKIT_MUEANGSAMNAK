import { timingSafeEqual } from 'node:crypto'
import { runLineCron } from '@/lib/line/cron'
import { createLineProvider, lineDeliveryMode } from '@/lib/line/provider'
import { createSupabaseLineStore } from '@/lib/line/supabase-store'

/**
 * Scheduler round (call every ~2 minutes, e.g. Supabase pg_cron + pg_net): due-date scan,
 * staff notices to LINE, customer reminders on the Settings schedule, driver accept reminders,
 * then the outbox. Off unless the server has LINE_OUTBOX_CRON_SECRET (Bearer token). In mock
 * mode everything is queued but nothing is pushed.
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
  try {
    const store = createSupabaseLineStore()
    const shop = await store.shopProfile()
    const live = lineDeliveryMode() === 'live'
    const accessToken = live ? (await store.credentials()).accessToken : null
    const result = await runLineCron({ store, shop, provider: live && accessToken ? createLineProvider(accessToken) : null })
    return Response.json({ ok: true, mode: live ? 'live' : 'mock', ...result })
  } catch {
    return Response.json({ ok: false, error: 'LINE_WORKER_FAILED' }, { status: 500 })
  }
}
