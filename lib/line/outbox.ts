import { assertValidMessages } from './messages'
import { decideAttempt } from './retry'
import { redactSecrets } from './redact'
import { type LineMessage, type LineProvider } from './types'

/**
 * Outbox worker. The database row (line_deliveries) is the source of truth: enqueue is
 * idempotent there (dedupe_key), claim leases rows with SKIP LOCKED, and complete records
 * SENT / RETRY / DEAD. This loop only moves rows through those states.
 */

export interface ClaimedDelivery {
  id: string
  line_user_id: string
  messages: unknown
  retry_key: string
  attempts: number
  max_attempts: number
}

export interface OutboxStore {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedDelivery[]>
  complete(
    id: string,
    outcome: 'SENT' | 'RETRY' | 'DEAD',
    info: { httpStatus: number | null; errorCode: string | null; requestId: string | null; retryAt: Date | null },
  ): Promise<void>
}

export interface OutboxRunResult {
  claimed: number
  sent: number
  retried: number
  dead: number
}

export async function processOutbox(opts: {
  store: OutboxStore
  provider: LineProvider
  now?: () => Date
  limit?: number
  leaseSeconds?: number
}): Promise<OutboxRunResult> {
  const now = opts.now ?? (() => new Date())
  const rows = await opts.store.claim(opts.limit ?? 20, opts.leaseSeconds ?? 60)
  const result: OutboxRunResult = { claimed: rows.length, sent: 0, retried: 0, dead: 0 }

  for (const row of rows) {
    let messages: LineMessage[]
    try {
      assertValidMessages(row.messages)
      messages = row.messages
    } catch (error) {
      await opts.store.complete(row.id, 'DEAD', {
        httpStatus: null,
        errorCode: error instanceof Error ? error.message : 'LINE_MESSAGE_INVALID',
        requestId: null,
        retryAt: null,
      })
      result.dead++
      continue
    }

    let sendResult
    try {
      sendResult = await opts.provider.push({ to: row.line_user_id, messages, retryKey: row.retry_key })
    } catch (error) {
      sendResult = { ok: false, status: 0, errorCode: redactSecrets(error instanceof Error ? error.name : 'NETWORK') }
    }

    const decision = decideAttempt(sendResult, row.attempts, row.max_attempts, now())
    await opts.store.complete(row.id, decision.outcome, {
      httpStatus: sendResult.status || null,
      errorCode: decision.outcome === 'SENT' ? null : decision.errorCode,
      requestId: sendResult.requestId ?? null,
      retryAt: decision.outcome === 'RETRY' ? decision.retryAt : null,
    })
    if (decision.outcome === 'SENT') result.sent++
    else if (decision.outcome === 'RETRY') result.retried++
    else result.dead++
  }
  return result
}
