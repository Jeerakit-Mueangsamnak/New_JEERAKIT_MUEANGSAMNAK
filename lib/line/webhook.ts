import { verifyLineSignature } from './signature'
import { nextStepMessage, textMessage, type LineTemplateKey, type TemplateOverrides } from './templates'
import { stageLabel } from '../work-order-stages'
import { LINE_USER_ID_PATTERN, type LineMessage, type LineProvider } from './types'

/**
 * Webhook handling (spec F2/F3/F6). Order: signature on the raw body -> parse -> per event
 * record once (webhookEventId) -> act. Nothing is written before the signature passes.
 * Replies use the event's reply token (free, not counted in the push quota).
 */

export type EventKind = 'TEXT' | 'IMAGE' | 'POSTBACK' | 'FOLLOW' | 'UNFOLLOW' | 'OTHER'

export interface RecordedEvent {
  duplicate: boolean
  contactId?: string
  status?: 'UNLINKED' | 'LINKED'
}

export type LinkResult =
  | { result: 'LINKED_STAFF' | 'LINKED_CUSTOMER' | 'LINKED_DRIVER'; name?: string }
  | { result: 'INVALID' | 'EXPIRED' | 'LOCKED' | 'ALREADY_LINKED' | 'TARGET_TAKEN' }

export type TaskPostbackResult = {
  result: 'ACCEPTED' | 'DONE' | 'ALREADY' | 'NOT_ASSIGNEE' | 'INVALID_STATE' | 'NOT_FOUND'
  title?: string
  /** Driver jobs: the step the driver records next (null = all driver steps done) */
  next_stage?: string | null
  /** Driver jobs: appointment type code, for the step names */
  appointment_type?: string | null
}

/** One job step pressed by the driver (line_task_step). */
export type TaskStepResult = {
  result: 'STEP_DONE' | 'ALREADY' | 'OUT_OF_ORDER' | 'NOT_ACCEPTED' | 'NOT_ASSIGNEE' | 'INVALID_STATE' | 'NOT_FOUND'
  stage?: string
  next_stage?: string | null
  title?: string
  appointment_type?: string | null
}

export interface WebhookStore {
  recordEvent(e: { eventId: string; lineUserId: string; kind: EventKind; text: string | null; lineMessageId: string | null; eventAt: Date }): Promise<RecordedEvent>
  consumeLinkCode(lineUserId: string, code: string): Promise<LinkResult>
  taskPostback(lineUserId: string, taskId: string, action: 'ACCEPT' | 'DONE'): Promise<TaskPostbackResult>
  taskStep(lineUserId: string, taskId: string, stage: string): Promise<TaskStepResult>
}

export interface WebhookDeps {
  rawBody: string
  signature: string | null
  channelSecret: string | null
  store: WebhookStore
  provider: LineProvider
  shopName: string
  templates?: TemplateOverrides
}

export interface WebhookResponse {
  status: number
  body: { ok: boolean; processed?: number; skipped?: number; error?: string }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 1_000_000

interface ParsedEvent {
  eventId: string
  lineUserId: string
  kind: EventKind
  text: string | null
  lineMessageId: string | null
  postbackData: string | null
  replyToken: string | null
  eventAt: Date
}

/** Returns null for anything that is not a 1:1 user event we understand (groups, rooms, junk). */
export function parseEvent(raw: unknown): ParsedEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, any>
  const eventId = typeof e.webhookEventId === 'string' ? e.webhookEventId : ''
  const userId = e.source?.type === 'user' ? e.source?.userId : null
  if (!eventId || eventId.length > 100 || typeof userId !== 'string' || !LINE_USER_ID_PATTERN.test(userId)) return null
  if (typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp)) return null

  let kind: EventKind = 'OTHER'
  let text: string | null = null
  let lineMessageId: string | null = null
  let postbackData: string | null = null
  if (e.type === 'message') {
    lineMessageId = typeof e.message?.id === 'string' ? e.message.id : null
    if (e.message?.type === 'text' && typeof e.message.text === 'string') {
      kind = 'TEXT'
      text = e.message.text.slice(0, 5000)
    } else if (e.message?.type === 'image') {
      kind = 'IMAGE'
    }
  } else if (e.type === 'postback' && typeof e.postback?.data === 'string') {
    kind = 'POSTBACK'
    postbackData = e.postback.data.slice(0, 300)
    text = postbackData
  } else if (e.type === 'follow') {
    kind = 'FOLLOW'
  } else if (e.type === 'unfollow') {
    kind = 'UNFOLLOW'
  }
  return {
    eventId,
    lineUserId: userId,
    kind,
    text,
    lineMessageId,
    postbackData,
    replyToken: typeof e.replyToken === 'string' ? e.replyToken : null,
    eventAt: new Date(e.timestamp),
  }
}

export type TaskPostback = { taskId: string; action: 'ACCEPT' | 'DONE' } | { taskId: string; action: 'STEP'; stage: string }

export function parseTaskPostback(data: string | null): TaskPostback | null {
  if (!data) return null
  const p = new URLSearchParams(data)
  const taskId = p.get('task') ?? ''
  const action = p.get('action')
  if (p.get('kind') !== 'task' || !UUID.test(taskId)) return null
  if (action === 'ACCEPT' || action === 'DONE') return { taskId, action }
  const stage = p.get('stage') ?? ''
  if (action === 'STEP' && /^[A-Z_]{2,20}$/.test(stage)) return { taskId, action, stage }
  return null
}

const LINK_REPLY: Record<string, LineTemplateKey> = {
  INVALID: 'LINK_INVALID',
  EXPIRED: 'LINK_EXPIRED',
  LOCKED: 'LINK_LOCKED',
  TARGET_TAKEN: 'LINK_TAKEN',
}

/** Staff codes are 6 digits; customer and driver codes are LINK- + 10 characters, issued for one
 * customer (staff) or one driver (OWNER) and typed in the 1:1 OA chat (group / room events never get here). */
const STAFF_CODE = /^\d{6}$/
const CUSTOMER_CODE = /^LINK-[A-HJ-NP-Z2-9]{10}$/

export function normalizeLinkCode(typed: string): string | null {
  const t = typed.trim().toUpperCase().replace(/\s+/g, '')
  return STAFF_CODE.test(t) || CUSTOMER_CODE.test(t) ? t : null
}

export async function handleLineWebhook(deps: WebhookDeps): Promise<WebhookResponse> {
  if (!deps.channelSecret) return { status: 503, body: { ok: false, error: 'LINE_NOT_CONFIGURED' } }
  if (new TextEncoder().encode(deps.rawBody).length > MAX_BODY_BYTES) {
    return { status: 413, body: { ok: false, error: 'BODY_TOO_LARGE' } }
  }
  if (!(await verifyLineSignature(deps.channelSecret, deps.rawBody, deps.signature))) {
    return { status: 401, body: { ok: false, error: 'BAD_SIGNATURE' } }
  }

  let payload: unknown
  try {
    payload = JSON.parse(deps.rawBody)
  } catch {
    return { status: 400, body: { ok: false, error: 'BAD_JSON' } }
  }
  const events = (payload as { events?: unknown })?.events
  if (!Array.isArray(events)) return { status: 400, body: { ok: false, error: 'NO_EVENTS' } }

  const send = async (token: string | null, messages: () => LineMessage[]) => {
    if (!token) return
    try {
      await deps.provider.reply({ replyToken: token, messages: messages() })
    } catch {
      // a lost reply is not retried: reply tokens are single-use and short-lived
    }
  }
  const reply = (token: string | null, key: LineTemplateKey, vars?: Record<string, string>) =>
    send(token, () => [textMessage(key, vars, deps.templates)])
  /** Driver job reply: the text, plus the button of the next step while one is left. */
  const replyStep = (token: string | null, taskId: string, text: string, next: string | null | undefined, type?: string | null) =>
    send(token, () => [next ? nextStepMessage(taskId, text, { key: next, label: stageLabel(next, type) }) : { type: 'text', text }])
  const render = (key: LineTemplateKey, vars?: Record<string, string>) => {
    const m = textMessage(key, vars, deps.templates)
    return m.type === 'text' ? m.text : ''
  }

  let processed = 0
  let skipped = 0
  for (const raw of events.slice(0, 100)) {
    const ev = parseEvent(raw)
    if (!ev) {
      skipped++
      continue
    }
    const rec = await deps.store.recordEvent(ev)
    if (rec.duplicate) {
      skipped++
      continue
    }
    processed++

    if (ev.kind === 'TEXT' && ev.text) {
      const code = normalizeLinkCode(ev.text)
      if (code && rec.status !== 'LINKED') {
        const r = await deps.store.consumeLinkCode(ev.lineUserId, code)
        if (r.result === 'LINKED_STAFF' || r.result === 'LINKED_CUSTOMER' || r.result === 'LINKED_DRIVER') {
          await reply(ev.replyToken, 'LINK_SUCCESS', { ชื่อ: ('name' in r && r.name) || '-', ชื่อร้าน: deps.shopName })
        } else if (LINK_REPLY[r.result]) await reply(ev.replyToken, LINK_REPLY[r.result], { ชื่อร้าน: deps.shopName })
      }
      // any other text stays in line_messages for the inbox / staff reports
    } else if (ev.kind === 'POSTBACK') {
      const task = parseTaskPostback(ev.postbackData)
      if (task?.action === 'STEP') {
        // Driver job step: recorded in order by the database; the reply names the next step
        const r = await deps.store.taskStep(ev.lineUserId, task.taskId, task.stage)
        const title = r.title || '-'
        if (r.result === 'STEP_DONE' || r.result === 'ALREADY') {
          const text =
            r.result === 'STEP_DONE' && !r.next_stage
              ? render('TASK_DONE', { เรื่อง: title })
              : render('TASK_STEP_DONE', { ขั้นตอน: stageLabel(r.stage || task.stage, r.appointment_type), เรื่อง: title })
          await replyStep(ev.replyToken, task.taskId, text, r.next_stage, r.appointment_type)
        } else if (r.result === 'OUT_OF_ORDER') {
          await replyStep(ev.replyToken, task.taskId, title, r.next_stage, r.appointment_type)
        } else if (r.result === 'NOT_ACCEPTED') {
          await reply(ev.replyToken, 'TASK_ACCEPT_FIRST')
        } else {
          await reply(ev.replyToken, 'TASK_NOT_ALLOWED')
        }
      } else if (task) {
        const r = await deps.store.taskPostback(ev.lineUserId, task.taskId, task.action)
        if (r.next_stage !== undefined && (r.result === 'ACCEPTED' || r.result === 'ALREADY')) {
          // driver job: รับงาน (or pressed again) -> the button of the next step
          await replyStep(ev.replyToken, task.taskId, render('TASK_ACCEPTED', { เรื่อง: r.title || '-' }), r.next_stage, r.appointment_type)
        } else if ((r.result === 'ACCEPTED' || r.result === 'DONE') && r.title) {
          await reply(ev.replyToken, r.result === 'ACCEPTED' ? 'TASK_ACCEPTED' : 'TASK_DONE', { เรื่อง: r.title })
        } else if (r.result === 'NOT_ASSIGNEE' || r.result === 'INVALID_STATE' || r.result === 'NOT_FOUND') {
          await reply(ev.replyToken, 'TASK_NOT_ALLOWED')
        }
      }
    }
  }
  return { status: 200, body: { ok: true, processed, skipped } }
}
