import { afterEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ claim: vi.fn(async () => []), complete: vi.fn(), credentials: vi.fn(async () => ({ accessToken: 't' })) }))
vi.mock('@/lib/line/supabase-store', () => ({ createSupabaseLineStore: () => store }))

import { POST } from '@/app/api/line/outbox/route'

const SECRET = 's'.repeat(40)
const req = (auth?: string) => new Request('http://x/api/line/outbox', { method: 'POST', headers: auth ? { authorization: auth } : {} })

describe('LINE outbox worker route', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('is off without LINE_OUTBOX_CRON_SECRET and refuses a wrong secret', async () => {
    vi.stubEnv('LINE_OUTBOX_CRON_SECRET', '')
    expect((await POST(req(`Bearer ${SECRET}`))).status).toBe(503)
    vi.stubEnv('LINE_OUTBOX_CRON_SECRET', SECRET)
    expect((await POST(req('Bearer wrong'))).status).toBe(401)
    expect(store.claim).not.toHaveBeenCalled()
  })

  it('in mock mode nothing is claimed, so no queued message is recorded as sent', async () => {
    vi.stubEnv('LINE_OUTBOX_CRON_SECRET', SECRET)
    vi.stubEnv('LINE_DELIVERY_MODE', 'mock')
    const res = await POST(req(`Bearer ${SECRET}`))
    expect(await res.json()).toMatchObject({ ok: true, mode: 'mock', sent: 0 })
    expect(store.claim).not.toHaveBeenCalled()
  })

  it('in live mode it runs the outbox (claim -> send -> complete)', async () => {
    vi.stubEnv('LINE_OUTBOX_CRON_SECRET', SECRET)
    vi.stubEnv('LINE_DELIVERY_MODE', 'live')
    const res = await POST(req(`Bearer ${SECRET}`))
    expect(await res.json()).toMatchObject({ ok: true, mode: 'live', claimed: 0 })
    expect(store.claim).toHaveBeenCalledWith(50, 60)
  })
})
