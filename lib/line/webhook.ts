import { verifyLineSignature } from './signature'
import { nextStepMessage, taskMessages, textMessage, type LineTemplateKey, type TemplateOverrides } from './templates'
import { stageLabel } from '../work-order-stages'
import { logger } from '../utils/logger'
import { LINE_USER_ID_PATTERN, type LineMessage, type LineProvider } from './types'
import { parseRegisterText } from './register'
import {
  categoriesMessages,
  contactReply,
  inquiryReply,
  itemsMessages,
  mainMenuMessages,
  parseCatalogPostback,
  registerHowtoReply,
  shopInfoReply,
  type CatalogAction,
  type CatalogCategory,
  type CatalogContext,
  type CatalogPage,
} from './catalog'

/**
 * Webhook handling (spec F2/F3/F6). Order: signature on the raw body -> parse -> per event
 * record once (webhookEventId) -> act. Nothing is written before the signature passes.
 * Replies use the event's reply token (free, not counted in the push quota).
 */

export type EventKind = 'TEXT' | 'IMAGE' | 'POSTBACK' | 'FOLLOW' | 'UNFOLLOW' | 'OTHER'

export type LineInteractionScope = 'GENERAL' | 'REGISTER' | 'CATALOG' | 'INQUIRY' | 'WORK'
export interface InteractionDecision {
  allowed: boolean
  result: 'OK' | 'DUPLICATE' | 'RATE_LIMITED' | 'SUSPENDED' | 'UNKNOWN'
  catalog_revision?: string
}

export interface RecordedEvent {
  replyAllowed?: boolean
  duplicate: boolean
  contactId?: string
  status?: 'UNLINKED' | 'LINKED'
}

export type LinkResult =
  | { result: 'LINKED_STAFF' | 'LINKED_CUSTOMER' | 'LINKED_DRIVER'; name?: string }
  | { result: 'INVALID' | 'EXPIRED' | 'LOCKED' | 'ALREADY_LINKED' | 'TARGET_TAKEN' | 'DUPLICATE' | 'RATE_LIMITED' | 'SUSPENDED' | 'UNKNOWN' }

export type TaskPostbackResult = {
  result: 'ACCEPTED' | 'DONE' | 'ALREADY' | 'NOT_ASSIGNEE' | 'INVALID_STATE' | 'NOT_FOUND' | 'SUSPENDED'
  title?: string
  /** Driver jobs: the step the driver records next (null = all driver steps done) */
  next_stage?: string | null
  /** Driver jobs: appointment type code, for the step names */
  appointment_type?: string | null
}

/** One job step pressed by the driver (line_task_step). */
export type TaskStepResult = {
  result: 'STEP_DONE' | 'ALREADY' | 'OUT_OF_ORDER' | 'NOT_ACCEPTED' | 'NOT_ASSIGNEE' | 'INVALID_STATE' | 'NOT_FOUND' | 'INVALID_INPUT' | 'SUSPENDED'
  stage?: string
  next_stage?: string | null
  title?: string
  appointment_type?: string | null
}

/** Name + phone typed by an unlinked contact (line_self_register). */
export type SelfRegisterResult =
  | { result: 'LINKED_CUSTOMER'; name?: string; created?: boolean }
  | { result: 'PENDING' | 'PHONE_TAKEN' | 'DUPLICATE' | 'INVALID' | 'ALREADY_LINKED' | 'REJECTED' | 'RATE_LIMITED' | 'SUSPENDED'; duplicate?: boolean }

export interface WebhookStore {
  checkInteraction?(lineUserId: string, scope: LineInteractionScope, key: string): Promise<InteractionDecision>
  recordEvent(e: { eventId: string; lineUserId: string; kind: EventKind; text: string | null; lineMessageId: string | null; eventAt: Date }): Promise<RecordedEvent>
  consumeLinkCode(lineUserId: string, code: string): Promise<LinkResult>
  taskPostback(lineUserId: string, taskId: string, action: 'ACCEPT' | 'DONE'): Promise<TaskPostbackResult>
  /** extra = the job form's note and photo paths (the chat buttons send none). */
  taskStep(lineUserId: string, taskId: string, stage: string, extra?: { note: string | null; photos: string[] }): Promise<TaskStepResult>
  /**
   * After a FOLLOW (line_contact_follow): keeps the display name, picture and the time added; an unlinked friend
   * waits for the shop. `send_welcome` is decided in the database (policies.line.friend.welcome, never for a friend
   * already linked or for an unblock).
   */
  followContact?(
    lineUserId: string,
    displayName: string | null,
    pictureUrl: string | null,
    isUnblock: boolean,
  ): Promise<{ status: 'UNLINKED' | 'LINKED'; register_status: string | null; is_new?: boolean; send_welcome: boolean }>
  /** Self-registration in the chat (line_self_register). */
  selfRegister?(lineUserId: string, name: string, phone: string): Promise<SelfRegisterResult>
  /** After a recorded driver step: tell the shop, and the customer when that step is on. */
  jobProgress?(taskId: string, stage: string, stageLabel: string): Promise<void>
  /** The product list anyone may see (only what the owner ticked): categories, one page of a category, one product. */
  catalogCategories?(): Promise<CatalogCategory[]>
  catalogItems?(categoryId: string, page: number): Promise<CatalogPage | null>
  catalogItem?(productId: string): Promise<{ id: string; name: string } | null>
  /** Owner chat commands (owner 2026-11-25): the linked OWNER's LINE only, while policies.line.ownerCommands is on. */
  ownerSummary?(lineUserId: string): Promise<OwnerSummary>
  ownerTaskResolve?(lineUserId: string, text: string): Promise<OwnerTaskResolve>
  ownerTaskCreate?(input: { lineUserId: string; eventId: string; taskId: string; assigneeId: string; title: string; messages: LineMessage[] }): Promise<{ result: string; task_id?: string; duplicate?: boolean }>
}

export interface OwnerSummary {
  result: 'OK' | 'NOT_OWNER'
  date?: string
  by_method?: Array<{ method: string; amount: number }>
  income?: number
  new_bills?: number
  owed?: number
}
export interface OwnerTaskResolve {
  result: 'OK' | 'NOT_OWNER' | 'NO_MEMBER' | 'MANY_MEMBERS' | 'NO_DETAIL' | 'NOT_LINKED'
  assignee_id?: string
  assignee?: string
  owner?: string
  title?: string
}

export interface WebhookDeps {
  rawBody: string
  signature: string | null
  channelSecret: string | null
  store: WebhookStore
  provider: LineProvider
  shopName: string
  /** For the contact / shop-info answers of the chat menu */
  shopPhone?: string | null
  /** The registration form link; without it the "ลงทะเบียน" button explains the typed way */
  registerUrl?: string | null
  /** After a FOLLOW is recorded (live LINE only): the chat menu that person should see */
  afterFollow?: (lineUserId: string) => Promise<void>
  /** After a message was queued for someone else (a task from the owner's chat): push it now (live LINE only) */
  afterQueued?: () => Promise<void>
  templates?: TemplateOverrides
}

export interface WebhookResponse {
  status: number
  body: { ok: boolean; processed?: number; skipped?: number; failed?: number; error?: string }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_BODY_BYTES = 1_000_000

export interface ParsedEvent {
  eventId: string
  lineUserId: string
  kind: EventKind
  text: string | null
  lineMessageId: string | null
  postbackData: string | null
  replyToken: string | null
  eventAt: Date
  /** follow.isUnblocked: the friend unblocked the OA (true) instead of adding it (false) */
  isUnblocked: boolean
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
    isUnblocked: e.type === 'follow' && asObject(e.follow)?.isUnblocked === true,
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
 * FOLLOW (owner 2026-11-21): the friend is kept as a person nobody has confirmed yet (name, picture, time added);
 * the database says whether to send the welcome text. A text from an unlinked friend that is not a link code
 * only files a request (PENDING) for the shop to check: no customer is created, no LINE is linked and the
 * answer never tells whether that phone is known. Replies only.
 */
export async function handleFollowEvent(ev: ParsedEvent, deps: Pick<WebhookDeps, 'store' | 'provider' | 'shopName'>, repliers: Pick<WebhookRepliers, 'reply'>): Promise<void> {
  if (!deps.store.followContact) return
  let name: string | null = null
  let pictureUrl: string | null = null
  try {
    const profile = await deps.provider.profile?.(ev.lineUserId)
    name = profile?.displayName ?? null
    pictureUrl = profile?.pictureUrl ?? null
  } catch {
    // name and picture are a nicety for the shop's list; the welcome still goes out
  }
  const r = await deps.store.followContact(ev.lineUserId, name, pictureUrl, ev.isUnblocked)
  if (r.send_welcome) await repliers.reply(ev.replyToken, 'REGISTER_WELCOME', { ชื่อร้าน: deps.shopName })
}

export async function handleRegisterText(ev: ParsedEvent, text: string, deps: Pick<WebhookDeps, 'store' | 'shopName'>, repliers: Pick<WebhookRepliers, 'reply'>): Promise<void> {
  if (!deps.store.selfRegister) return
  const { name, phone } = parseRegisterText(text)
  if (!name || !phone) {
    if (deps.store.checkInteraction && !(await deps.store.checkInteraction(ev.lineUserId, 'REGISTER', 'invalid-registration')).allowed) return
    await repliers.reply(ev.replyToken, 'REGISTER_RETRY')
    return
  }
  const r = await deps.store.selfRegister(ev.lineUserId, name, phone)
  if (r.result === 'PENDING' && !r.duplicate) await repliers.reply(ev.replyToken, 'REGISTER_PENDING')
  else if (r.result === 'INVALID') await repliers.reply(ev.replyToken, 'REGISTER_RETRY')
  // ALREADY_LINKED / REJECTED: ordinary chat, no reply. A stranger's text never links or creates anyone.
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
  /** Any messages (the product list is built of cards, not of one template text) */
  replyMessages: (token: string | null, messages: () => LineMessage[]) => Promise<void>
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

/** Reply helpers shared by one webhook request, bound to its deps. */
function createWebhookRepliers(deps: WebhookDeps): WebhookRepliers {
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
  const replyMessages = (token: string | null, messages: () => LineMessage[]) => send(token, messages)
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
  return { reply, replyStep, replyMessages, render, progress }
}

/** Acts on one parsed event (already recorded once); the kinds we do not act on stay in the inbox. */
async function dispatchEvent(ev: ParsedEvent, rec: RecordedEvent, deps: WebhookDeps, repliers: WebhookRepliers): Promise<void> {
  if (ev.kind === 'TEXT' && ev.text) {
    const code = normalizeLinkCode(ev.text)
    if (code && rec.status !== 'LINKED') {
      const r = await deps.store.consumeLinkCode(ev.lineUserId, code)
      if (r.result === 'LINKED_STAFF' || r.result === 'LINKED_CUSTOMER' || r.result === 'LINKED_DRIVER') {
        await repliers.reply(ev.replyToken, 'LINK_SUCCESS', { ชื่อ: ('name' in r && r.name) || '-', ชื่อร้าน: deps.shopName })
      } else if (LINK_REPLY[r.result]) await repliers.reply(ev.replyToken, LINK_REPLY[r.result], { ชื่อร้าน: deps.shopName })
    } else if (!code && rec.status !== 'LINKED') {
      await handleRegisterText(ev, ev.text, deps, { reply: repliers.reply })
    } else if (rec.status === 'LINKED' && ev.text.trim().startsWith('#')) {
      await handleOwnerCommand(ev, ev.text.trim(), deps, { reply: repliers.reply })
    }
    // any other text stays in line_messages for the inbox / staff reports
  } else if (ev.kind === 'FOLLOW') {
    if (deps.store.checkInteraction && !(await deps.store.checkInteraction(ev.lineUserId, 'GENERAL', 'follow')).allowed) return
    await handleFollowEvent(ev, deps, { reply: repliers.reply })
    try {
      await deps.afterFollow?.(ev.lineUserId)
    } catch {
      // the next cron round puts the menu right; the friend is already recorded and welcomed
    }
  } else if (ev.kind === 'POSTBACK') {
    const catalog = parseCatalogPostback(ev.postbackData)
    if (catalog) return handleCatalogPostback(ev, catalog, deps, repliers)
    const task = parseTaskPostback(ev.postbackData)
    if (task && (!deps.store.checkInteraction || (await deps.store.checkInteraction(ev.lineUserId, 'WORK', ev.postbackData ?? 'task')).allowed)) await handleTaskPostbackEvent(ev, task, deps.store, repliers)
  }
}

const METHOD_LABEL: Record<string, string> = { CASH: 'เงินสด', TRANSFER: 'โอน', QR: 'QR พร้อมเพย์', CARD: 'บัตร', OTHER: 'อื่น ๆ' }
const TASK_FAIL: Record<string, string> = {
  NO_MEMBER: 'ไม่พบชื่อพนักงานนี้ (พิมพ์ #สั่งงาน ชื่อพนักงาน รายละเอียดงาน)',
  MANY_MEMBERS: 'มีพนักงานชื่อนี้มากกว่า 1 คน ให้พิมพ์ชื่อผู้ใช้แทน',
  NO_DETAIL: 'ยังไม่ได้พิมพ์รายละเอียดงาน',
  NOT_LINKED: 'พนักงานคนนี้ยังไม่ได้ผูก LINE',
  INVALID_INPUT: 'รายละเอียดงานยาวเกินกำหนด',
}
const money = (n: number | undefined) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Owner chat commands (owner 2026-11-25). Only the linked OWNER's LINE, and only while the switch is on: for anyone
 * else a "#" line is an ordinary chat line and gets no answer (the database says who the owner is).
 *   #สรุปยอดวันนี้                      money in today (as การเงิน counts it) by way of paying, new bills, what is owed
 *   #สั่งงาน <ชื่อพนักงาน> <รายละเอียด>   a task to that staff member's LINE (once per LINE message)
 */
export async function handleOwnerCommand(ev: ParsedEvent, text: string, deps: Pick<WebhookDeps, 'store' | 'templates' | 'afterQueued'>, repliers: Pick<WebhookRepliers, 'reply'>): Promise<void> {
  const { store } = deps
  if (!store.ownerSummary || !store.ownerTaskResolve || !store.ownerTaskCreate) return
  if (store.checkInteraction && !(await store.checkInteraction(ev.lineUserId, 'WORK', `owner:${text.slice(0, 80)}`)).allowed) return
  const body = text.replace(/^#\s*/, '').trim()

  if (/^สรุปยอด(วันนี้)?$/.test(body.replace(/\s+/g, ''))) {
    const r = await store.ownerSummary(ev.lineUserId)
    if (r.result !== 'OK') return
    const byMethod = (r.by_method ?? []).map((m) => `${METHOD_LABEL[m.method] ?? m.method} ${money(m.amount)}`).join(' · ')
    const date = r.date ? new Date(`${r.date}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-'
    await repliers.reply(ev.replyToken, 'OWNER_SUMMARY', {
      วันที่: date,
      รายรับรวม: money(r.income),
      รายรับแยกช่องทาง: byMethod || 'ยังไม่มีรายรับ',
      บิลใหม่: String(r.new_bills ?? 0),
      ยอดค้างรวม: money(r.owed),
    })
    return
  }

  const task = /^สั่งงาน\s+([\s\S]+)$/.exec(body)
  if (!task) {
    // anything else after "#": the list of commands, to the owner only (an empty name tells who is asking)
    const who = await store.ownerTaskResolve(ev.lineUserId, '')
    if (who.result !== 'NOT_OWNER') await repliers.reply(ev.replyToken, 'OWNER_COMMAND_HELP')
    return
  }
  const r = await store.ownerTaskResolve(ev.lineUserId, task[1])
  if (r.result === 'NOT_OWNER') return
  if (r.result !== 'OK' || !r.assignee_id || !r.title) {
    await repliers.reply(ev.replyToken, 'OWNER_COMMAND_FAILED', { เหตุผล: TASK_FAIL[r.result] ?? 'กรุณาลองใหม่' })
    return
  }
  const taskId = crypto.randomUUID()
  let messages: LineMessage[]
  try {
    messages = taskMessages(taskId, { ผู้สั่ง: r.owner || 'เจ้าของร้าน', เรื่อง: r.title }, deps.templates)
  } catch {
    await repliers.reply(ev.replyToken, 'OWNER_COMMAND_FAILED', { เหตุผล: TASK_FAIL.INVALID_INPUT })
    return
  }
  const created = await store.ownerTaskCreate({ lineUserId: ev.lineUserId, eventId: ev.eventId, taskId, assigneeId: r.assignee_id, title: r.title, messages })
  if (created.result !== 'OK') {
    if (created.result !== 'NOT_OWNER') await repliers.reply(ev.replyToken, 'OWNER_COMMAND_FAILED', { เหตุผล: TASK_FAIL[created.result] ?? 'กรุณาลองใหม่' })
    return
  }
  await repliers.reply(ev.replyToken, 'OWNER_TASK_SENT', { ชื่อพนักงาน: r.assignee || '-', เรื่อง: r.title })
  try {
    await deps.afterQueued?.()
  } catch {
    // the task is saved and queued; the next outbox round sends it
  }
}

/**
 * A press in the product list / chat menu (owner 2026-11-21). Open to anyone who added the OA: it shows only what the
 * owner ticked, and answers a question about a product in the chat; it never orders, reserves or touches stock.
 */
export async function handleCatalogPostback(ev: ParsedEvent, action: CatalogAction, deps: WebhookDeps, repliers: Pick<WebhookRepliers, 'replyMessages'>): Promise<void> {
  if (!ev.replyToken) return
  const scope: LineInteractionScope = action.a === 'price' || action.a === 'preorder' ? 'INQUIRY' : action.a === 'home' || action.a === 'cat' ? 'CATALOG' : 'GENERAL'
  if (deps.store.checkInteraction && !(await deps.store.checkInteraction(ev.lineUserId, scope, ev.postbackData ?? action.a)).allowed) return
  const ctx: CatalogContext = { shopName: deps.shopName, phone: deps.shopPhone ?? null, templates: deps.templates, registerUrl: deps.registerUrl ?? null }
  const send = (messages: () => LineMessage[]) => repliers.replyMessages(ev.replyToken, messages)
  const home = async () => {
    const categories = (await deps.store.catalogCategories?.()) ?? []
    return send(() => categoriesMessages(categories, ctx))
  }
  switch (action.a) {
    case 'main':
      return send(() => mainMenuMessages(ctx))
    case 'contact':
      return send(() => [contactReply(ctx)])
    case 'info':
      return send(() => [shopInfoReply(ctx)])
    case 'register':
      return send(() => [registerHowtoReply(ctx)])
    case 'home':
      return home()
    case 'cat': {
      const page = await deps.store.catalogItems?.(action.c, action.pg)
      return page ? send(() => itemsMessages(page, action.pg, ctx)) : home()
    }
    case 'price':
    case 'preorder': {
      const item = await deps.store.catalogItem?.(action.p)
      return item ? send(() => [inquiryReply(action.a as 'price' | 'preorder', item.name, ctx)]) : home()
    }
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

  const repliers = createWebhookRepliers(deps)

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
      if (rec.replyAllowed === false) ev.replyToken = null
      processed++
      await dispatchEvent(ev, rec, deps, repliers)
    } catch (error) {
      failed++
      logger.error('line webhook: event failed', { error, raw })
    }
  }
  // still 200: LINE must not resend the batch; failed events are logged above
  return { status: 200, body: { ok: true, processed, skipped, failed } }
}
