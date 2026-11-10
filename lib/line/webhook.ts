import { verifyLineSignature } from './signature'
import { nextStepMessage, textMessage, type LineTemplateKey, type TemplateOverrides } from './templates'
import { stageLabel } from '../work-order-stages'
import { logger } from '../utils/logger'
import { LINE_USER_ID_PATTERN, type LineMessage, type LineProvider } from './types'
import { parseRegisterText } from './register'

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

/** Name + phone typed by an unlinked contact (line_self_register). */
export type SelfRegisterResult =
  | { result: 'LINKED_CUSTOMER'; name?: string; created?: boolean }
  | { result: 'PHONE_TAKEN' | 'DUPLICATE' | 'INVALID' | 'ALREADY_LINKED' | 'REJECTED' }

export interface WebhookStore {
  recordEvent(e: { eventId: string; lineUserId: string; kind: EventKind; text: string | null; lineMessageId: string | null; eventAt: Date }): Promise<RecordedEvent>
  consumeLinkCode(lineUserId: string, code: string): Promise<LinkResult>
  taskPostback(lineUserId: string, taskId: string, action: 'ACCEPT' | 'DONE'): Promise<TaskPostbackResult>
  taskStep(lineUserId: string, taskId: string, stage: string): Promise<TaskStepResult>
  /** After a FOLLOW: keep the display name; an unlinked friend waits for the shop (line_contact_follow). */
  followContact?(lineUserId: string, displayName: string | null): Promise<{ status: 'UNLINKED' | 'LINKED'; register_status: string | null }>
  /** Self-registration in the chat (line_self_register). */
  selfRegister?(lineUserId: string, name: string, phone: string): Promise<SelfRegisterResult>
  /** After a recorded driver step: tell the shop, and the customer when that step is on. */
  jobProgress?(taskId: string, stage: string, stageLabel: string): Promise<void>
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
  body: { ok: boolean; processed?: number; skipped?: number; failed?: number; error?: string }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 1_000_000

export interface ParsedEvent {
  eventId: string
  lineUserId: string
  kind: EventKind
  text: string | null
  lineMessageId: string | null
  postbackData: string | null
  replyToken: string | null
  eventAt: Date
}

/** Narrows an unknown value to a plain object without trusting its contents. */
function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Narrows an unknown value to a string. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Returns null for anything that is not a 1:1 user event we understand (groups, rooms, junk). */
export function parseEvent(raw: unknown): ParsedEvent | null {
  const e = asObject(raw)
  if (!e) return null
  const eventId = asString(e.webhookEventId) ?? ''
  const source = asObject(e.source)
  const userId = source?.type === 'user' ? asString(source.userId) : null
  if (!eventId || eventId.length > 100 || !userId || !LINE_USER_ID_PATTERN.test(userId)) return null
  if (typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp)) return null

  let kind: EventKind = 'OTHER'
  let text: string | null = null
  let lineMessageId: string | null = null
  let postbackData: string | null = null
  if (e.type === 'message') {
    const message = asObject(e.message)
    lineMessageId = asString(message?.id)
    if (message?.type === 'text' && typeof message.text === 'string') {
      kind = 'TEXT'
      text = message.text.slice(0, 5000)
    } else if (message?.type === 'image') {
      kind = 'IMAGE'
    }
  } else if (e.type === 'postback') {
    const data = asString(asObject(e.postback)?.data)
    if (data !== null) {
      kind = 'POSTBACK'
      postbackData = data.slice(0, 300)
      text = postbackData
    }
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
    replyToken: asString(e.replyToken),
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

/**
 * Self-registration in the 1:1 chat (owner rule 2026-10-31): FOLLOW -> welcome asking for name
 * and phone; a text from an unlinked friend that is not a link code -> the database applies the
 * rule (new phone = new customer, a known phone without LINE = that customer, a phone that
 * already has a LINE or several customers = stays pending for the shop). Replies only.
 */
export async function handleFollowEvent(ev: ParsedEvent, deps: Pick<WebhookDeps, 'store' | 'provider' | 'shopName'>, repliers: Pick<WebhookRepliers, 'reply'>): Promise<void> {
  if (!deps.store.followContact) return
  let name: string | null = null
  try {
    name = (await deps.provider.profile?.(ev.lineUserId))?.displayName ?? null
  } catch {
    // the name is a nicety for the shop's list; the welcome still goes out
  }
  const r = await deps.store.followContact(ev.lineUserId, name)
  if (r.status !== 'LINKED') await repliers.reply(ev.replyToken, 'REGISTER_WELCOME', { ชื่อร้าน: deps.shopName })
}

export async function handleRegisterText(ev: ParsedEvent, text: string, deps: Pick<WebhookDeps, 'store' | 'shopName'>, repliers: Pick<WebhookRepliers, 'reply'>): Promise<void> {
  if (!deps.store.selfRegister) return
  const { name, phone } = parseRegisterText(text)
  if (!name || !phone) {
    await repliers.reply(ev.replyToken, 'REGISTER_RETRY')
    return
  }
  const r = await deps.store.selfRegister(ev.lineUserId, name, phone)
  if (r.result === 'LINKED_CUSTOMER') await repliers.reply(ev.replyToken, 'LINK_SUCCESS', { ชื่อ: ('name' in r && r.name) || name, ชื่อร้าน: deps.shopName })
  else if (r.result === 'PHONE_TAKEN') await repliers.reply(ev.replyToken, 'REGISTER_PHONE_TAKEN')
  else if (r.result === 'DUPLICATE') await repliers.reply(ev.replyToken, 'REGISTER_PENDING')
  else if (r.result === 'INVALID') await repliers.reply(ev.replyToken, 'REGISTER_RETRY')
  // ALREADY_LINKED / REJECTED: ordinary chat, no reply
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

/** Reply helpers shared by the webhook branches (bound to one request's deps). */
export interface WebhookRepliers {
  reply: (token: string | null, key: LineTemplateKey, vars?: Record<string, string>) => Promise<void>
  replyStep: (token: string | null, taskId: string, text: string, next: string | null | undefined, type?: string | null) => Promise<void>
  render: (key: LineTemplateKey, vars?: Record<string, string>) => string
  progress: (taskId: string, stage: string, type?: string | null) => Promise<void>
}

/** Handles a task postback (accept / done / driver step) and replies with the next step. */
export async function handleTaskPostbackEvent(
  ev: ParsedEvent,
  task: TaskPostback,
  store: WebhookStore,
  repliers: WebhookRepliers
): Promise<void> {
  const { reply, replyStep, render, progress } = repliers
  if (task.action === 'STEP') {
    // Driver job step: recorded in order by the database; the reply names the next step
    const r = await store.taskStep(ev.lineUserId, task.taskId, task.stage)
    const title = r.title || '-'
    if (r.result === 'STEP_DONE') await progress(task.taskId, r.stage || task.stage, r.appointment_type)
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
    return
  }

  const r = await store.taskPostback(ev.lineUserId, task.taskId, task.action)
  if (r.next_stage !== undefined && r.result === 'ACCEPTED') await progress(task.taskId, 'ACCEPT', r.appointment_type)
  if (r.next_stage !== undefined && (r.result === 'ACCEPTED' || r.result === 'ALREADY')) {
    // driver job: รับงาน (or pressed again) -> the button of the next step
    await replyStep(ev.replyToken, task.taskId, render('TASK_ACCEPTED', { เรื่อง: r.title || '-' }), r.next_stage, r.appointment_type)
  } else if ((r.result === 'ACCEPTED' || r.result === 'DONE') && r.title) {
    await reply(ev.replyToken, r.result === 'ACCEPTED' ? 'TASK_ACCEPTED' : 'TASK_DONE', { เรื่อง: r.title })
  } else if (r.result === 'NOT_ASSIGNEE' || r.result === 'INVALID_STATE' || r.result === 'NOT_FOUND') {
    await reply(ev.replyToken, 'TASK_NOT_ALLOWED')
  }
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

  /** Never lets a notice failure change the driver's reply (the step is already recorded). */
  const progress = async (taskId: string, stage: string, type?: string | null) => {
    try {
      await deps.store.jobProgress?.(taskId, stage, stageLabel(stage, type))
    } catch {
      // the next cron round does not retry this; the step itself is safe in the database
    }
  }

  let processed = 0
  let skipped = 0
  let failed = 0
  for (const raw of events.slice(0, 100)) {
    try {
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
        } else if (!code && rec.status !== 'LINKED') {
          await handleRegisterText(ev, ev.text, deps, { reply })
        }
        // any other text stays in line_messages for the inbox / staff reports
      } else if (ev.kind === 'FOLLOW') {
        await handleFollowEvent(ev, deps, { reply })
      } else if (ev.kind === 'POSTBACK') {
        const task = parseTaskPostback(ev.postbackData)
        if (task) await handleTaskPostbackEvent(ev, task, deps.store, { reply, replyStep, render, progress })
      }
    } catch (error) {
      failed++
      logger.error('line webhook: event failed', { error, raw })
    }
  }
  // still 200: LINE must not resend the batch; failed events are logged above
  return { status: 200, body: { ok: true, processed, skipped, failed } }
}
