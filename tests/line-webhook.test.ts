import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signLineBody } from '@/lib/line/signature'
import { MockLineProvider } from '@/lib/line/mock-provider'
import { handleLineWebhook, parseTaskPostback, type WebhookStore } from '@/lib/line/webhook'

const SECRET = '0123456789abcdef0123456789abcdef'
const STAFF = 'U' + '1'.repeat(32)
const CUST = 'U' + '2'.repeat(32)
const TASK = '11111111-2222-3333-4444-555555555555'
const DRIVER = 'U' + '3'.repeat(32)
const CUST_CODE = 'LINK-ABCDEFGHJK'
const OLD_CODE = 'LINK-ZZZZZZZZZZ'

function textEvent(id: string, user: string, text: string) {
  return { type: 'message', webhookEventId: id, timestamp: 1791475200000, replyToken: `rt-${id}`, source: { type: 'user', userId: user }, message: { type: 'text', id: `m-${id}`, text } }
}

/** In-memory store with the same results the RPCs return. */
function memoryStore() {
  const seen = new Set<string>()
  const usedCodes = new Set<string>()
  const status = new Map<string, 'UNLINKED' | 'LINKED'>()
  const driverDone: string[] = []
  const store: WebhookStore & { calls: string[] } = {
    calls: [],
    recordEvent: vi.fn(async (e) => {
      if (seen.has(e.eventId)) return { duplicate: true }
      seen.add(e.eventId)
      store.calls.push(`${e.kind}:${e.text ?? ''}`)
      return { duplicate: false, contactId: 'c', status: status.get(e.lineUserId) ?? 'UNLINKED' }
    }),
    consumeLinkCode: vi.fn(async (user, code) => {
      if (code === '123456') {
        status.set(user, 'LINKED')
        return { result: 'LINKED_STAFF' as const, name: 'สมศรี' }
      }
      if (code === CUST_CODE) {
        if (usedCodes.has(code)) return { result: 'INVALID' as const }
        usedCodes.add(code)
        status.set(user, 'LINKED')
        return { result: 'LINKED_CUSTOMER' as const, name: 'คุณลูกค้า' }
      }
      if (code === OLD_CODE) return { result: 'EXPIRED' as const }
      return { result: 'INVALID' as const }
    }),
    taskPostback: vi.fn(async (user, _task, action) => {
      if (user === DRIVER) return { result: 'ACCEPTED' as const, title: 'ส่งเต็นท์', next_stage: 'PREPARE', appointment_type: 'DELIVERY' }
      return user === STAFF ? { result: action === 'ACCEPT' ? ('ACCEPTED' as const) : ('DONE' as const), title: 'ส่งของ' } : { result: 'NOT_ASSIGNEE' as const }
    }),
    // driver steps in order, like line_task_step: PREPARE -> PREPARED -> ... (only the next one is taken)
    taskStep: vi.fn(async (user, _task, stage) => {
      if (user !== DRIVER) return { result: 'NOT_ASSIGNEE' as const }
      const order = ['PREPARE', 'PREPARED', 'TRANSIT', 'ARRIVED', 'INSPECT', 'COMPLETED']
      const at = order.indexOf(stage)
      const next = order[driverDone.length] ?? null
      if (driverDone.includes(stage)) return { result: 'ALREADY' as const, stage, next_stage: next, title: 'ส่งเต็นท์', appointment_type: 'DELIVERY' }
      if (at !== driverDone.length) return { result: 'OUT_OF_ORDER' as const, stage, next_stage: next, title: 'ส่งเต็นท์', appointment_type: 'DELIVERY' }
      driverDone.push(stage)
      return { result: 'STEP_DONE' as const, stage, next_stage: order[driverDone.length] ?? null, title: 'ส่งเต็นท์', appointment_type: 'DELIVERY' }
    }),
  }
  return store
}

async function call(events: unknown[], opts: { secret?: string | null; signWith?: string; store?: ReturnType<typeof memoryStore>; provider?: MockLineProvider } = {}) {
  const rawBody = JSON.stringify({ destination: 'Uxxx', events })
  const store = opts.store ?? memoryStore()
  const provider = opts.provider ?? new MockLineProvider()
  const res = await handleLineWebhook({
    rawBody,
    signature: await signLineBody(opts.signWith ?? SECRET, rawBody),
    channelSecret: opts.secret === undefined ? SECRET : opts.secret,
    store,
    provider,
    shopName: 'ร้านเอ',
  })
  return { res, store, provider }
}

describe('LINE webhook', () => {
  let provider: MockLineProvider
  beforeEach(() => {
    provider = new MockLineProvider()
  })

  it('a wrong signature gets 401 and writes nothing', async () => {
    const { res, store } = await call([textEvent('e1', STAFF, '123456')], { signWith: 'ffffffffffffffffffffffffffffffff' })
    expect(res.status).toBe(401)
    expect(store.recordEvent).not.toHaveBeenCalled()
  })

  it('no channel secret configured = 503, nothing written', async () => {
    const { res, store } = await call([textEvent('e1', STAFF, 'hi')], { secret: null })
    expect(res.status).toBe(503)
    expect(store.recordEvent).not.toHaveBeenCalled()
  })

  it('malformed JSON with a valid signature = 400; LINE verify call (no events) = 200', async () => {
    const raw = '{not json'
    const store = memoryStore()
    const bad = await handleLineWebhook({ rawBody: raw, signature: await signLineBody(SECRET, raw), channelSecret: SECRET, store, provider, shopName: 'x' })
    expect(bad.status).toBe(400)
    expect((await call([])).res).toMatchObject({ status: 200, body: { processed: 0 } })
  })

  it('a redelivered event (same webhookEventId) is processed once', async () => {
    const store = memoryStore()
    await call([textEvent('e1', STAFF, '123456')], { store, provider })
    const again = await call([textEvent('e1', STAFF, '123456')], { store, provider })
    expect(again.res.body).toMatchObject({ processed: 0, skipped: 1 })
    expect(store.consumeLinkCode).toHaveBeenCalledTimes(1)
    expect(provider.replied).toHaveLength(1)
  })

  it('staff: 6-digit code links and replies with the spec text', async () => {
    const { res } = await call([textEvent('e1', STAFF, ' 123456 ')], { provider })
    expect(res.status).toBe(200)
    expect(provider.replied[0].messages[0]).toEqual({
      type: 'text',
      text: 'ผูก LINE กับบัญชี สมศรี ที่ ร้านเอ เรียบร้อยแล้ว คุณจะได้รับแจ้งเตือนทาง LINE นี้',
    })
  })

  it('customer: the LINK- code from staff, sent in the 1:1 OA chat, links that LINE (case and spaces ignored)', async () => {
    const store = memoryStore()
    await call([textEvent('e1', CUST, '  link-abcdefghjk ')], { store, provider })
    expect(store.consumeLinkCode).toHaveBeenCalledWith(CUST, CUST_CODE)
    expect(provider.replied.at(-1)!.messages[0]).toMatchObject({ text: expect.stringContaining('คุณลูกค้า') })
  })

  it('driver: the LINK- code the OWNER made for a driver code links that LINE and replies', async () => {
    const store = memoryStore()
    const DRIVER = 'U' + '3'.repeat(32)
    store.consumeLinkCode = vi.fn(async () => ({ result: 'LINKED_DRIVER' as const, name: 'สมชาย' }))
    await call([textEvent('e1', DRIVER, 'LINK-DRVDRVDRV2')], { store, provider })
    expect(store.consumeLinkCode).toHaveBeenCalledWith(DRIVER, 'LINK-DRVDRVDRV2')
    expect(provider.replied.at(-1)!.messages[0]).toMatchObject({ text: expect.stringContaining('สมชาย') })
  })

  it('customer: a used code cannot link a second LINE, an expired code gets the expired reply', async () => {
    const store = memoryStore()
    await call([textEvent('e1', CUST, CUST_CODE)], { store, provider })
    const other = 'U' + '4'.repeat(32)
    await call([textEvent('e2', other, CUST_CODE)], { store, provider })
    expect(provider.replied.at(-1)!.messages[0]).toMatchObject({ text: expect.stringContaining('รหัสไม่ถูกต้อง') })
    await call([textEvent('e3', other, OLD_CODE)], { store, provider })
    expect(provider.replied.at(-1)!.messages[0]).toMatchObject({ text: expect.stringContaining('หมดอายุ') })
  })

  it('phone digits are never a proof; codes from an already linked LINE are just chat', async () => {
    const store = memoryStore()
    await call([textEvent('e1', CUST, '5678')], { store, provider })
    await call([textEvent('e2', CUST, '0812345678')], { store, provider })
    await call([textEvent('e3', STAFF, 'LINK-ABC')], { store, provider })
    expect(store.consumeLinkCode).not.toHaveBeenCalled()
    await call([textEvent('e4', STAFF, '123456')], { store, provider })
    await call([textEvent('e5', STAFF, '999999')], { store, provider })
    await call([textEvent('e6', STAFF, CUST_CODE)], { store, provider })
    expect(store.consumeLinkCode).toHaveBeenCalledTimes(1)
  })

  it('a customer code sent in a group or room links nothing', async () => {
    const { res, store } = await call([
      { ...textEvent('g1', CUST, CUST_CODE), source: { type: 'group', groupId: 'C1', userId: CUST } },
      { ...textEvent('r1', CUST, CUST_CODE), source: { type: 'room', roomId: 'R1', userId: CUST } },
    ])
    expect(res.body).toMatchObject({ processed: 0, skipped: 2 })
    expect(store.recordEvent).not.toHaveBeenCalled()
    expect(store.consumeLinkCode).not.toHaveBeenCalled()
  })

  it('ignores invalid data: group sources, bad userId, missing ids, unknown shapes', async () => {
    const { res, store } = await call([
      { ...textEvent('g1', STAFF, '123456'), source: { type: 'group', groupId: 'C1', userId: STAFF } },
      textEvent('b1', 'U123', '123456'),
      { type: 'message', timestamp: 1, source: { type: 'user', userId: STAFF } },
      null,
      'junk',
    ])
    expect(res.body).toMatchObject({ processed: 0, skipped: 5 })
    expect(store.recordEvent).not.toHaveBeenCalled()
  })

  it('task postback: assignee moves the task, someone else is refused', async () => {
    const data = `kind=task&task=${TASK}&action=ACCEPT`
    const ev = (id: string, user: string) => ({ type: 'postback', webhookEventId: id, timestamp: 1, replyToken: `rt-${id}`, source: { type: 'user', userId: user }, postback: { data } })
    const store = memoryStore()
    await call([ev('p1', STAFF), ev('p2', CUST)], { store, provider })
    expect(store.taskPostback).toHaveBeenCalledWith(STAFF, TASK, 'ACCEPT')
    expect(provider.replied.map((r) => (r.messages[0] as { text: string }).text)).toEqual([
      'รับงานแล้ว: ส่งของ',
      'งานนี้ไม่ได้มอบหมายให้บัญชีของคุณ หรือปิดไปแล้ว',
    ])
  })

  it('driver job: รับงาน and each step answer with the button of the next step; out of order is not recorded', async () => {
    const ev = (id: string, data: string) => ({ type: 'postback', webhookEventId: id, timestamp: 1, replyToken: `rt-${id}`, source: { type: 'user', userId: DRIVER }, postback: { data } })
    const step = (stage: string) => `kind=task&task=${TASK}&action=STEP&stage=${stage}`
    const store = memoryStore()
    await call([ev('d1', `kind=task&task=${TASK}&action=ACCEPT`), ev('d2', step('TRANSIT')), ev('d3', step('PREPARE')), ev('d4', step('PREPARE'))], { store, provider })
    const buttons = provider.replied.map((r) => r.messages[0] as { type: string; template: { text: string; actions: Array<{ label: string; data: string }> } })
    expect(buttons.map((b) => b.template.actions[0].label)).toEqual(['เตรียม', 'เตรียม', 'เตรียมเสร็จ', 'เตรียมเสร็จ'])
    expect(buttons[0].template.text).toBe('รับงานแล้ว: ส่งเต็นท์\nขั้นถัดไป: เตรียม')
    expect(buttons[2].template.text).toBe('บันทึกขั้น เตรียม แล้ว: ส่งเต็นท์\nขั้นถัดไป: เตรียมเสร็จ')
    expect(buttons[2].template.actions[0].data).toBe(step('PREPARED'))
    expect(store.taskStep).toHaveBeenCalledWith(DRIVER, TASK, 'TRANSIT') // refused by the store (out of order)

    for (const [i, s] of ['PREPARED', 'TRANSIT', 'ARRIVED', 'INSPECT', 'COMPLETED'].entries()) await call([ev(`e${i}`, step(s))], { store, provider })
    const last = provider.replied[provider.replied.length - 1].messages[0] as { type: string; text: string }
    expect(last).toEqual({ type: 'text', text: 'บันทึกว่าเสร็จแล้ว: ส่งเต็นท์' }) // all driver steps done: no more buttons
  })

  it('postback data that is not a valid task action is ignored', () => {
    expect(parseTaskPostback('kind=task&task=not-a-uuid&action=ACCEPT')).toBeNull()
    expect(parseTaskPostback(`kind=task&task=${TASK}&action=DELETE`)).toBeNull()
    expect(parseTaskPostback(`task=${TASK}&action=DONE`)).toBeNull()
    expect(parseTaskPostback(`kind=task&task=${TASK}&action=DONE`)).toEqual({ taskId: TASK, action: 'DONE' })
    expect(parseTaskPostback(`kind=task&task=${TASK}&action=STEP`)).toBeNull()
    expect(parseTaskPostback(`kind=task&task=${TASK}&action=STEP&stage=drop table`)).toBeNull()
    expect(parseTaskPostback(`kind=task&task=${TASK}&action=STEP&stage=ARRIVED`)).toEqual({ taskId: TASK, action: 'STEP', stage: 'ARRIVED' })
  })
})
