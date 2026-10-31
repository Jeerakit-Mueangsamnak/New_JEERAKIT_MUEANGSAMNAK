import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyLiffIdToken } from '@/lib/line/liff'
import { assertValidMessages } from '@/lib/line/messages'
import { driverTaskMessages } from '@/lib/line/templates'
import { reminderMessages, runLineCron, type CronStore, type ReminderRow } from '@/lib/line/cron'
import { validateLinePolicy } from '@/lib/line/policy'
import { LINE_REMINDER_RULES } from '@/lib/line/config'
import { handleLineWebhook, type WebhookStore } from '@/lib/line/webhook'
import { signLineBody } from '@/lib/line/signature'
import { MockLineProvider } from '@/lib/line/mock-provider'
import { type FanoutStore } from '@/lib/line/notification-fanout'
import { type OutboxStore } from '@/lib/line/outbox'

const USER = 'U' + 'a'.repeat(32)
const TASK = '11111111-2222-3333-4444-555555555555'
const SHOP = { shopName: 'ร้านทดสอบ', templates: {}, lineId: '@shop', phone: '02-123-4567' }

const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('LIFF ID token check', () => {
  it('trusts only what LINE answers for the right channel', async () => {
    expect(await verifyLiffIdToken('tok', 'not-a-channel')).toEqual({ ok: false, error: 'TOKEN_INVALID' })
    expect(await verifyLiffIdToken('tok', '1234567890', async () => jsonRes(400, { error: 'invalid_request' }))).toEqual({ ok: false, error: 'TOKEN_INVALID' })
    expect(await verifyLiffIdToken('tok', '1234567890', async () => jsonRes(200, { sub: USER, aud: '999' }))).toEqual({ ok: false, error: 'TOKEN_INVALID' })
    expect(await verifyLiffIdToken('tok', '1234567890', async () => jsonRes(200, { sub: 'bad' }))).toEqual({ ok: false, error: 'TOKEN_INVALID' })
    expect(await verifyLiffIdToken('tok', '1234567890', async () => jsonRes(200, { sub: USER, aud: '1234567890', name: 'Ann' }))).toEqual({
      ok: true,
      lineUserId: USER,
      name: 'Ann',
    })
    expect(
      await verifyLiffIdToken('tok', '1234567890', async () => {
        throw new Error('down')
      }),
    ).toEqual({ ok: false, error: 'NETWORK' })
  })
})

describe('flex messages', () => {
  it('driver job card: รับงาน first, map and call buttons from the appointment', () => {
    const [m] = driverTaskMessages(TASK, { ผู้สั่ง: 'เจ้าของ', เรื่อง: 'ส่งเต็นท์' }, undefined, {
      when: '1 พ.ย. 2569 09:00',
      customer: 'มานี',
      phone: '081-234-5678',
      place: 'ตลาดเก่า',
    })
    expect(() => assertValidMessages([m])).not.toThrow()
    const json = JSON.stringify(m)
    expect(m.type).toBe('flex')
    expect(json).toContain(`kind=task&task=${TASK}&action=ACCEPT`)
    expect(json).toContain('https://www.google.com/maps/search/')
    expect(json).toContain('tel:081-234-5678'.replace(/-/g, ''))
  })

  it('refuses a flex with a non-https link', () => {
    const bad = { type: 'flex', altText: 'x', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: 'x', uri: 'http://x' } }] } } }
    expect(() => assertValidMessages([bad])).toThrow('LINE_ACTION_INVALID')
  })
})

describe('customer reminders', () => {
  const row: Omit<ReminderRow, 'contact_id' | 'dedupe_key'> = {
    rule: 'RENTAL_DUE_SOON',
    source_type: 'BILL',
    source_id: TASK,
    customer_name: 'มานี',
    ref_no: '22102569-0001',
    due_at: '2026-10-23T03:00:00Z',
    amount: 1500,
    days_left: 1,
  }

  it('every rule has a text with the placeholders the worker fills', () => {
    for (const r of LINE_REMINDER_RULES) {
      const sample = { ...row, rule: r.key, source_type: r.key === 'APPOINTMENT_DUE' ? ('APPOINTMENT' as const) : ('BILL' as const) }
      const built = reminderMessages(sample, SHOP)
      expect(built.templateKey).toBe(r.template)
      expect(() => assertValidMessages(built.messages)).not.toThrow()
    }
  })

  it('renders the bill, amount and shop buttons', () => {
    const { messages } = reminderMessages(row, SHOP)
    const json = JSON.stringify(messages)
    expect(json).toContain('22102569-0001')
    expect(json).toContain('1,500.00')
    expect(json).toContain('https://line.me/R/oaMessage/')
    expect(json).toContain('tel:021234567')
    expect(() => reminderMessages({ ...row, rule: 'NOPE' }, SHOP)).toThrow()
  })

  it('schedule options are validated like the database', () => {
    expect(validateLinePolicy({ reminders: { PAYMENT_DUE: { enabled: true, daysBefore: 3, repeatDays: 2 } }, reminderHour: 9 })).toEqual({ ok: true })
    expect(validateLinePolicy({ reminders: { PAYMENT_DUE: { daysBefore: 99 } } })).toEqual({ ok: false, path: 'line.reminders.PAYMENT_DUE.daysBefore' })
    expect(validateLinePolicy({ reminders: { NOPE: {} } })).toEqual({ ok: false, path: 'line.reminders.NOPE' })
    expect(validateLinePolicy({ customerStages: { ACCEPT: 'yes' } })).toEqual({ ok: false, path: 'line.customerStages.ACCEPT' })
    expect(validateLinePolicy({ acceptTimeoutMinutes: 2000 })).toEqual({ ok: false, path: 'line.acceptTimeoutMinutes' })
  })
})

describe('scheduler round', () => {
  function fakeStore(over: Partial<CronStore & FanoutStore & OutboxStore> = {}) {
    const queued: string[] = []
    const store: CronStore & FanoutStore & OutboxStore = {
      scanDue: vi.fn(async () => 3),
      claimNotifications: vi.fn(async () => ['n1']),
      notification: vi.fn(async () => ({ id: 'n1', event_type: 'APPOINTMENT_DUE', entity_id: TASK, title: 'นัด', body: 'พรุ่งนี้' })),
      recipients: vi.fn(async () => [{ contact_id: 'c1' }, { contact_id: 'c2' }]),
      enqueueSystem: vi.fn(async () => ({ duplicate: false })),
      remindersDue: vi.fn(async () => [{ rule: 'RENTAL_OVERDUE', source_type: 'BILL', source_id: TASK, contact_id: 'cc', customer_name: 'มานี', ref_no: 'B1', due_at: '2026-10-20T03:00:00Z', amount: 0, days_left: -1, dedupe_key: 'R:OVERDUE:x' }] as ReminderRow[]),
      acceptOverdue: vi.fn(async () => [{ task_id: TASK, contact_id: 'cd', title: 'ส่งเต็นท์', dedupe_key: `ACCEPT_LATE:${TASK}` }]),
      enqueueServer: vi.fn(async (i) => {
        const dup = queued.includes(i.dedupeKey)
        queued.push(i.dedupeKey)
        return { duplicate: dup }
      }),
      jobProgress: vi.fn(async () => undefined),
      claim: vi.fn(async () => []),
      complete: vi.fn(async () => undefined),
      ...over,
    }
    return store
  }

  it('scan → staff notices → customer reminders → driver reminders, queue only in mock mode', async () => {
    const store = fakeStore()
    const r = await runLineCron({ store, shop: SHOP, provider: null })
    expect(r).toMatchObject({ scanned: 3, notices: 2, reminders: 1, acceptReminders: 1, errors: 0, outbox: null })
    expect(store.claim).not.toHaveBeenCalled()
    const driverMsg = JSON.stringify((store.enqueueServer as ReturnType<typeof vi.fn>).mock.calls[1][0].messages)
    expect(driverMsg).toContain(`action=ACCEPT`)
  })

  it('a second round queues nothing new, and one failing step does not stop the others', async () => {
    const store = fakeStore()
    await runLineCron({ store, shop: SHOP, provider: null })
    const again = await runLineCron({ store, shop: SHOP, provider: null })
    expect(again.reminders).toBe(0)
    expect(again.acceptReminders).toBe(0)
    const broken = fakeStore({ scanDue: vi.fn(async () => Promise.reject(new Error('db'))) })
    const r = await runLineCron({ store: broken, shop: SHOP, provider: new MockLineProvider() })
    expect(r.errors).toBe(1)
    expect(r.reminders).toBe(1)
    expect(broken.claim).toHaveBeenCalled()
  })
})

describe('webhook → job progress', () => {
  const SECRET = '0123456789abcdef0123456789abcdef'
  async function call(events: unknown[], store: WebhookStore) {
    const rawBody = JSON.stringify({ events })
    return handleLineWebhook({ rawBody, signature: await signLineBody(SECRET, rawBody), channelSecret: SECRET, store, provider: new MockLineProvider(), shopName: 'ร้าน' })
  }
  const ev = (id: string, data: string) => ({ type: 'postback', webhookEventId: id, timestamp: 1, replyToken: `rt-${id}`, source: { type: 'user', userId: USER }, postback: { data } })

  it('tells the shop / customer after รับงาน and a recorded step, not after a repeat', async () => {
    const jobProgress = vi.fn(async () => undefined)
    const store: WebhookStore = {
      recordEvent: vi.fn(async () => ({ duplicate: false, status: 'LINKED' as const })),
      consumeLinkCode: vi.fn(),
      taskPostback: vi.fn(async () => ({ result: 'ACCEPTED' as const, title: 'ส่งเต็นท์', next_stage: 'PREPARE', appointment_type: 'DELIVERY' })),
      taskStep: vi
        .fn()
        .mockResolvedValueOnce({ result: 'STEP_DONE', stage: 'PREPARE', next_stage: 'PREPARED', title: 'ส่งเต็นท์', appointment_type: 'DELIVERY' })
        .mockResolvedValueOnce({ result: 'ALREADY', stage: 'PREPARE', next_stage: 'PREPARED', title: 'ส่งเต็นท์', appointment_type: 'DELIVERY' }),
      jobProgress,
    }
    const step = `kind=task&task=${TASK}&action=STEP&stage=PREPARE`
    await call([ev('a', `kind=task&task=${TASK}&action=ACCEPT`), ev('b', step), ev('c', step)], store)
    expect(jobProgress.mock.calls).toEqual([
      [TASK, 'ACCEPT', 'รับงาน'],
      [TASK, 'PREPARE', 'เตรียม'],
    ])
  })

  it('a failing notice never breaks the driver reply', async () => {
    const provider = new MockLineProvider()
    const store: WebhookStore = {
      recordEvent: vi.fn(async () => ({ duplicate: false, status: 'LINKED' as const })),
      consumeLinkCode: vi.fn(),
      taskPostback: vi.fn(async () => ({ result: 'ACCEPTED' as const, title: 'ส่งเต็นท์', next_stage: 'PREPARE', appointment_type: 'DELIVERY' })),
      taskStep: vi.fn(),
      jobProgress: vi.fn(async () => Promise.reject(new Error('db'))),
    }
    const rawBody = JSON.stringify({ events: [ev('x', `kind=task&task=${TASK}&action=ACCEPT`)] })
    const res = await handleLineWebhook({ rawBody, signature: await signLineBody(SECRET, rawBody), channelSecret: SECRET, store, provider, shopName: 'ร้าน' })
    expect(res.status).toBe(200)
    expect(provider.replied).toHaveLength(1)
  })
})

describe('/api/line/cron', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is off without the secret and refuses a wrong one', async () => {
    vi.resetModules()
    vi.doMock('@/lib/line/supabase-store', () => ({ createSupabaseLineStore: () => ({ shopProfile: vi.fn() }) }))
    const { POST } = await import('@/app/api/line/cron/route')
    const req = (auth?: string) => new Request('http://x/api/line/cron', { method: 'POST', headers: auth ? { authorization: auth } : {} })
    vi.stubEnv('LINE_OUTBOX_CRON_SECRET', '')
    expect((await POST(req('Bearer x'))).status).toBe(503)
    vi.stubEnv('LINE_OUTBOX_CRON_SECRET', 's'.repeat(40))
    expect((await POST(req('Bearer wrong'))).status).toBe(401)
  })
})
