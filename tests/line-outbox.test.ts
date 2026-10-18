import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLineProvider } from '@/lib/line/mock-provider'
import { processOutbox, type ClaimedDelivery, type OutboxStore } from '@/lib/line/outbox'
import { fanOutNotification, type FanoutStore } from '@/lib/line/notification-fanout'
import { createLineProvider, HttpLineProvider } from '@/lib/line/provider'

const USER = 'U' + 'a'.repeat(32)

/** In-memory copy of the line_deliveries state machine (enqueue / claim / complete). */
class MemoryOutbox implements OutboxStore {
  now = new Date('2026-10-08T00:00:00Z')
  rows = new Map<string, ClaimedDelivery & { status: string; next: Date; lease: Date | null; dedupe: string; errorCode: string | null }>()
  private seq = 0

  enqueue(dedupe: string, messages: unknown = [{ type: 'text', text: 'สวัสดี' }], max = 5) {
    const existing = [...this.rows.values()].find((r) => r.dedupe === dedupe)
    if (existing) return { id: existing.id, duplicate: true }
    const id = `d${++this.seq}`
    this.rows.set(id, {
      id, line_user_id: USER, messages, retry_key: `rk-${id}`, attempts: 0, max_attempts: max,
      status: 'PENDING', next: this.now, lease: null, dedupe, errorCode: null,
    })
    return { id, duplicate: false }
  }

  async claim(limit: number, leaseSeconds: number) {
    const due = [...this.rows.values()].filter(
      (r) => ((r.status === 'PENDING' || r.status === 'FAILED') && r.next <= this.now) || (r.status === 'SENDING' && r.lease! < this.now),
    )
    return due.slice(0, limit).map((r) => {
      r.status = 'SENDING'
      r.attempts++
      r.lease = new Date(this.now.getTime() + leaseSeconds * 1000)
      return { ...r }
    })
  }

  async complete(id: string, outcome: 'SENT' | 'RETRY' | 'DEAD', info: { retryAt: Date | null; errorCode: string | null }) {
    const r = this.rows.get(id)!
    if (r.status !== 'SENDING') return
    r.lease = null
    r.errorCode = info.errorCode
    if (outcome === 'SENT') r.status = 'SENT'
    else if (outcome === 'RETRY' && r.attempts < r.max_attempts) {
      r.status = 'FAILED'
      r.next = info.retryAt!
    } else r.status = 'DEAD'
  }

  advance(seconds: number) {
    this.now = new Date(this.now.getTime() + seconds * 1000)
  }
}

describe('outbox: idempotency, retry, mock provider', () => {
  let store: MemoryOutbox
  let provider: MockLineProvider
  const run = () => processOutbox({ store, provider, now: () => store.now })

  beforeEach(() => {
    store = new MemoryOutbox()
    provider = new MockLineProvider()
  })

  it('a double click (same idempotency key) is queued once and sent once', async () => {
    expect(store.enqueue('U:user1:click-0001').duplicate).toBe(false)
    expect(store.enqueue('U:user1:click-0001').duplicate).toBe(true)
    expect(await run()).toMatchObject({ claimed: 1, sent: 1 })
    expect(await run()).toMatchObject({ claimed: 0 })
    expect(provider.pushed).toHaveLength(1)
    expect(provider.pushed[0]).toMatchObject({ to: USER, retryKey: 'rk-d1' })
  })

  it('retries a 500 / network error later with the SAME retry key, then sends', async () => {
    store.enqueue('U:user1:click-0002')
    provider.queue({ ok: false, status: 500 }, 'throw')
    expect(await run()).toMatchObject({ retried: 1 })
    expect(await run()).toMatchObject({ claimed: 0 }) // not due yet
    store.advance(60)
    expect(await run()).toMatchObject({ retried: 1 }) // mock network failure
    store.advance(300)
    expect(await run()).toMatchObject({ sent: 1 })
    expect(provider.pushed).toHaveLength(1)
    expect(provider.pushed[0].retryKey).toBe('rk-d1')
    expect(store.rows.get('d1')!.attempts).toBe(3)
  })

  it('a worker that died after LINE accepted the push does not cause a second delivery', async () => {
    store.enqueue('U:user1:click-0003')
    const [row] = await store.claim(10, 60)
    await provider.push({ to: row.line_user_id, messages: row.messages as never, retryKey: row.retry_key }) // accepted, then crash
    store.advance(61) // lease expired, row is due again
    expect(await run()).toMatchObject({ sent: 1 })
    expect(provider.pushed).toHaveLength(1) // LINE (mock) answered 409 for the repeated retry key
  })

  it('stops at once on 400/401 and after max attempts on repeated 5xx', async () => {
    store.enqueue('U:user1:bad-request1')
    provider.queue({ ok: false, status: 401 })
    expect(await run()).toMatchObject({ dead: 1 })
    expect(store.rows.get('d1')).toMatchObject({ status: 'DEAD', errorCode: 'TOKEN_INVALID' })

    store.enqueue('U:user1:flaky-00001', undefined, 2)
    provider.queue({ ok: false, status: 503 }, { ok: false, status: 503 })
    await run()
    store.advance(60)
    expect(await run()).toMatchObject({ dead: 1 })
    expect(store.rows.get('d2')!.status).toBe('DEAD')
    expect(provider.pushed).toHaveLength(0)
  })

  it('a row whose messages are invalid is closed, never sent', async () => {
    store.enqueue('U:user1:invalid-001', [{ type: 'text', text: '' }])
    expect(await run()).toMatchObject({ dead: 1 })
    expect(store.rows.get('d1')!.errorCode).toBe('LINE_TEXT_INVALID')
    expect(provider.pushed).toHaveLength(0)
  })
})

describe('notification fan-out', () => {
  it('queues one row per eligible contact with a per-(notice, contact) key, from the notice text', async () => {
    const enqueued: string[] = []
    const store: FanoutStore = {
      notification: async () => ({ id: 'n1', event_type: 'RENTAL_DUE_SOON', entity_id: 'b1', title: 'ใกล้ถึงวันคืน: BL-1', body: 'คืนพรุ่งนี้' }),
      recipients: async () => [{ contact_id: 'c1' }, { contact_id: 'c2' }],
      enqueueSystem: async (input) => {
        const dup = enqueued.includes(input.dedupeKey)
        enqueued.push(input.dedupeKey)
        expect(input.messages).toEqual([{ type: 'text', text: '[ใกล้ถึงวันคืน: BL-1] คืนพรุ่งนี้' }])
        return { duplicate: dup }
      },
    }
    expect(await fanOutNotification(store, 'n1')).toEqual({ queued: 2, duplicates: 0 })
    expect(await fanOutNotification(store, 'n1')).toEqual({ queued: 0, duplicates: 2 })
    expect(enqueued.slice(0, 2)).toEqual(['N:n1:c1', 'N:n1:c2'])
  })

  it('switched-off types (no recipients) queue nothing', async () => {
    const enqueueSystem = vi.fn()
    await fanOutNotification({ notification: async () => ({ id: 'n', event_type: 'X', entity_id: 'e', title: 't', body: 'b' }), recipients: async () => [], enqueueSystem }, 'n')
    expect(enqueueSystem).not.toHaveBeenCalled()
  })
})

describe('provider selection never sends for real by default', () => {
  it('uses the mock even when a token exists, unless LINE_DELIVERY_MODE=live', () => {
    expect(createLineProvider('token-' + 'x'.repeat(40), {}).kind).toBe('mock')
    expect(createLineProvider('token-' + 'x'.repeat(40), { LINE_DELIVERY_MODE: 'mock' }).kind).toBe('mock')
    expect(createLineProvider(null, { LINE_DELIVERY_MODE: 'live' }).kind).toBe('mock')
    expect(createLineProvider('token-' + 'x'.repeat(40), { LINE_DELIVERY_MODE: 'live' })).toBeInstanceOf(HttpLineProvider)
  })
})
