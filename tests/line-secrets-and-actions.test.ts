import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpLineProvider } from '@/lib/line/provider'
import { MockLineProvider } from '@/lib/line/mock-provider'
import { handleLineWebhook } from '@/lib/line/webhook'
import { signLineBody } from '@/lib/line/signature'

const SECRET = '0123456789abcdef0123456789abcdef'
const TOKEN = 'tok_' + 'Z'.repeat(60)

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: { id: 'u1' } as { id: string } | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: db.rpc,
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: '9d0f2a52-7d1c-4d6e-8f0e-111111111111', company_name: 'ร้านเอ', display_name: 'เจ้าของ' } }) }
      return q
    },
  }),
}))

describe('secrets never leak', () => {
  let logs: string[]
  beforeEach(() => {
    logs = []
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      })
    }
  })
  afterEach(() => vi.restoreAllMocks())

  it('the HTTP sender sends the token only in the Authorization header and never returns it', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
      expect(String(init.body)).not.toContain(TOKEN)
      return new Response(JSON.stringify({ message: `bad token ${TOKEN}` }), { status: 401 })
    })
    const p = new HttpLineProvider(TOKEN, fetchImpl)
    const r = await p.push({ to: 'U' + 'a'.repeat(32), messages: [{ type: 'text', text: 'x' }], retryKey: 'rk' })
    expect(r).toEqual({ ok: false, status: 401, requestId: undefined, retryAfterSeconds: undefined })
    expect(JSON.stringify(r)).not.toContain(TOKEN)
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ 'X-Line-Retry-Key': 'rk' })

    const failing = new HttpLineProvider(TOKEN, async () => {
      throw new Error(`connect failed Bearer ${TOKEN}`)
    })
    const r2 = await failing.reply({ replyToken: 'r', messages: [{ type: 'text', text: 'x' }] })
    expect(JSON.stringify(r2)).not.toContain(TOKEN)
    expect(r2).toMatchObject({ ok: false, status: 0, errorCode: 'NETWORK' })
  })

  it('webhook responses and logs never contain the channel secret', async () => {
    const raw = JSON.stringify({ events: [] })
    const store = { recordEvent: vi.fn(), consumeLinkCode: vi.fn(), taskPostback: vi.fn(), taskStep: vi.fn() }
    for (const sig of [await signLineBody(SECRET, raw), 'wrong']) {
      const res = await handleLineWebhook({ rawBody: raw, signature: sig, channelSecret: SECRET, store, provider: new MockLineProvider(), shopName: 'x' })
      expect(JSON.stringify(res)).not.toContain(SECRET)
    }
    expect(logs.join('\n')).not.toContain(SECRET)
  })

  it('saving credentials: a database error is translated, never echoing what was typed', async () => {
    const { saveLineSecrets, getLineSecretStatus } = await import('@/app/actions/system-secrets')
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: `LINE_CHANNEL_SECRET_FORMAT value ${SECRET}` } })
    await expect(saveLineSecrets({ lineSecret: SECRET, lineToken: TOKEN })).rejects.toThrow(/Channel Secret ไม่ถูกต้อง/)
    await saveLineSecrets({ lineSecret: SECRET }).catch((e: Error) => expect(e.message).not.toContain(SECRET))
    db.rpc.mockResolvedValueOnce({ data: { vault: true, secret_configured: true, token_configured: false }, error: null })
    const status = await getLineSecretStatus()
    expect(status).toEqual({ available: true, lineSecretConfigured: true, lineTokenConfigured: false, liveDelivery: false })
    expect(JSON.stringify(status)).not.toContain(SECRET)
    expect(logs.join('\n')).not.toContain(SECRET)
    expect(logs.join('\n')).not.toContain(TOKEN)
  })

  it('save goes to the OWNER-checked RPC with trimmed values; a non-owner is refused by the database', async () => {
    const { saveLineSecrets } = await import('@/app/actions/system-secrets')
    db.rpc.mockResolvedValueOnce({ data: { vault: true, secret_configured: true, token_configured: true }, error: null })
    await saveLineSecrets({ lineSecret: ` ${SECRET} `, lineToken: TOKEN })
    expect(db.rpc).toHaveBeenLastCalledWith('line_channel_set', { p_channel_secret: SECRET, p_access_token: TOKEN })
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'FORBIDDEN: OWNER only' } })
    await expect(saveLineSecrets({ lineSecret: SECRET })).rejects.toThrow('เฉพาะเจ้าของระบบเท่านั้นที่จัดการข้อมูลลับได้')
  })
})

describe('LINE actions: permission and invalid input', () => {
  beforeEach(() => db.rpc.mockReset())

  it('invalid input is refused before the database is called', async () => {
    const { queueLineMessage, createLineTask, createCustomerLineLinkCode, cancelLineTask } = await import('@/app/actions/line')
    const ok = { contactId: '9d0f2a52-7d1c-4d6e-8f0e-111111111111', sourceType: 'BILL' as const, sourceId: '9d0f2a52-7d1c-4d6e-8f0e-222222222222', templateKey: 'CUSTOMER_RETURN_REMINDER', text: 'สวัสดี', idempotencyKey: 'click-00000001' }
    expect((await queueLineMessage({ ...ok, contactId: 'x' })).success).toBe(false)
    expect((await queueLineMessage({ ...ok, sourceType: 'NOTIFICATION' as never })).error).toBe('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้')
    expect((await queueLineMessage({ ...ok, text: '   ' })).success).toBe(false)
    expect((await queueLineMessage({ ...ok, text: 'ก'.repeat(5001) })).success).toBe(false)
    expect((await queueLineMessage({ ...ok, idempotencyKey: 'short' })).success).toBe(false)
    expect((await createLineTask({ assigneeId: ok.contactId, title: ' ', idempotencyKey: 'click-00000002' })).success).toBe(false)
    expect((await createCustomerLineLinkCode('not-uuid')).success).toBe(false)
    expect((await cancelLineTask(ok.contactId, '')).error).toBe('กรุณาระบุเหตุผล')
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('database refusals come back as Thai messages (menu, recipient mismatch, owner only)', async () => {
    const { queueLineMessage, createLineTask } = await import('@/app/actions/line')
    const input = { contactId: '9d0f2a52-7d1c-4d6e-8f0e-111111111111', sourceType: 'BILL' as const, sourceId: '9d0f2a52-7d1c-4d6e-8f0e-222222222222', templateKey: 'CUSTOMER_RETURN_REMINDER', text: 'สวัสดี', idempotencyKey: 'click-00000003' }
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'FORBIDDEN: menu bills or line required' } })
    expect((await queueLineMessage(input)).error).toBe('บัญชีนี้ไม่มีสิทธิ์ใช้เมนูนี้')
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'LINE_RECIPIENT_MISMATCH' } })
    expect((await queueLineMessage(input)).error).toBe('ผู้รับไม่ตรงกับลูกค้าหรือผู้รับผิดชอบของรายการนี้')
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'FORBIDDEN: OWNER only' } })
    expect((await createLineTask({ assigneeId: input.contactId, title: 'ส่งของ', idempotencyKey: 'click-00000004' })).error).toBe('เฉพาะเจ้าของร้านเท่านั้น')
  })

  it('a repeated press passes the same key so the database returns the first delivery', async () => {
    const { queueLineMessage } = await import('@/app/actions/line')
    const input = { contactId: '9d0f2a52-7d1c-4d6e-8f0e-111111111111', sourceType: 'BILL' as const, sourceId: '9d0f2a52-7d1c-4d6e-8f0e-222222222222', templateKey: 'CUSTOMER_RETURN_REMINDER', text: 'สวัสดี', idempotencyKey: 'click-00000005' }
    db.rpc.mockResolvedValueOnce({ data: { delivery_id: 'd1', status: 'PENDING', duplicate: false }, error: null })
    db.rpc.mockResolvedValueOnce({ data: { delivery_id: 'd1', status: 'PENDING', duplicate: true }, error: null })
    await queueLineMessage(input)
    const second = await queueLineMessage(input)
    expect(second.data).toMatchObject({ delivery_id: 'd1', duplicate: true })
    expect(db.rpc.mock.calls[0][1]).toEqual(db.rpc.mock.calls[1][1])
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_idempotency_key: 'click-00000005', p_messages: [{ type: 'text', text: 'สวัสดี' }] })
  })

  it('task creation sends a pre-made task id that the LINE buttons carry', async () => {
    const { createLineTask } = await import('@/app/actions/line')
    db.rpc.mockResolvedValueOnce({ data: { task_id: 't', duplicate: false }, error: null })
    await createLineTask({ assigneeId: '9d0f2a52-7d1c-4d6e-8f0e-111111111111', title: 'ส่งของ', idempotencyKey: 'click-00000006' })
    const [fn, args] = db.rpc.mock.calls[0]
    expect(fn).toBe('line_task_create')
    expect(JSON.stringify(args.p_messages)).toContain(`task=${args.p_task_id}&action=ACCEPT`)
  })
})
