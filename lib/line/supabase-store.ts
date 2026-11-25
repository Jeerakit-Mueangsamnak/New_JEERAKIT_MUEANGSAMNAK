import 'server-only'
import { type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { type FanoutStore } from './notification-fanout'
import { type ClaimedDelivery, type OutboxStore } from './outbox'
import { type LinkResult, type RecordedEvent, type SelfRegisterResult, type TaskPostbackResult, type TaskStepResult, type WebhookStore } from './webhook'
import { type CronStore, type ReminderRow } from './cron'
import { customerNoticeMessages } from './templates'
import { CATALOG_PAGE_SIZE, type CatalogCategory, type CatalogPage } from './catalog'
import { type RichMenuKind } from './rich-menu'
import { cachedPublicCatalog } from './catalog-cache'
import type { InteractionDecision } from './webhook'
import { type RichMenuPerson, type RichMenuSyncStore } from './rich-menu-sync'
import { lineOaMessageUrl } from './oa-link'
import { SHOP_LINE_ID_COLUMN, SHOP_LINE_TEMPLATES_COLUMN } from './policy'

/**
 * Database side of the webhook and the outbox, through the service_role-only RPCs of
 * migration 20261008160000_line_operations_v1. Errors never carry request data.
 */

export interface LiffBindInput {
  lineUserId: string
  displayName: string | null
  code: string
  typedName: string
  typedPhone: string | null
  lineHandle: string | null
  isFriend: boolean | null
}

export interface LiffBindResult {
  result: string
  name?: string
  kind?: 'STAFF' | 'DRIVER' | 'CUSTOMER'
  needs_review?: boolean
}

class LineStoreError extends Error {
  constructor(fn: string, code?: string) {
    super(`LINE_STORE_${fn}${code ? `:${code}` : ''}`)
    this.name = 'LineStoreError'
  }
}

async function call<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new LineStoreError(fn, error.code)
  return data as T
}

/** Driver job form (line_driver_job): the job as the driver's LINE may see it. */
export interface LiffDriverJob {
  result: 'OK' | 'NOT_ASSIGNEE' | 'NOT_FOUND' | 'SUSPENDED'
  task?: { id: string; title: string; detail: string | null; status: 'SENT' | 'ACCEPTED' | 'DONE' | 'CANCELLED' }
  holds?: boolean
  appointment?: { type: string | null; start: string | null; place: string | null; contact: string | null; phone: string | null; description: string | null }
  items?: Array<{ name: string; qty: number; unit: string | null }>
  events?: Array<{ stage: string; status: string; timestamp?: string; note?: string; photos?: string[]; by?: string }>
  next_stage?: string | null
}

export interface LiffFinanceEntry {
  kind: 'INCOME' | 'EXPENSE'
  category: string
  amount: number
  channel: string
  note: string | null
}

/** Private bucket of the driver's job photos (<task id>/<uuid>.<ext>). */
export const JOB_PHOTO_BUCKET = 'job-photos'
/** Private bucket of the customers' slips (<bill id>/<uuid>.<ext>, owner 2026-11-25). */
export const SLIP_BUCKET = 'payment-slips'

/** Pay form (line_pay_form): the bill as its own customer's LINE may see it. */
export interface LiffPayForm {
  result: 'OK' | 'NOT_FOUND' | 'SUSPENDED'
  bill?: { id: string; bill_no: string | null; status: string; grand_total: number; balance_due: number; payable: boolean }
  customer?: string | null
  shop?: { name: string | null; promptpay: string | null; promptpay_type: string | null; bank: string | null; account_name: string | null; account_no: string | null }
  slips?: Array<{ amount: number; status: 'PENDING' | 'APPROVED' | 'REJECTED'; created_at: string; approved_amount: number | null; reject_reason: string | null }>
}

export interface ShopProfile {
  shopName: string
  templates: Record<string, unknown>
  /** Settings › กิจการ LINE ID / phone, for the "chat / call the shop" buttons. */
  lineId: string | null
  phone: string | null
}

export function createSupabaseLineStore(db: SupabaseClient = createAdminClient()): WebhookStore & OutboxStore & FanoutStore & CronStore & RichMenuSyncStore & {
  credentials(): Promise<{ channelSecret: string | null; accessToken: string | null }>
  shopProfile(): Promise<ShopProfile>
  liffBind(input: LiffBindInput): Promise<LiffBindResult>
  driverJob(lineUserId: string, taskId: string): Promise<LiffDriverJob>
  uploadJobPhoto(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  removeJobPhotos(paths: string[]): Promise<void>
  payForm(lineUserId: string, billId: string): Promise<LiffPayForm>
  uploadSlip(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  removeSlip(path: string): Promise<void>
  /** First scan of a staff QR: the QR dies, the chat code comes back once. */
  staffQrScan(token: string): Promise<{ result: 'OK' | 'DEAD'; code?: string }>
  slipSubmit(input: { lineUserId: string; billId: string; amount: number; path: string; ownerMessages: unknown[] | null }): Promise<{ result: 'OK' | 'NOT_FOUND' | 'SUSPENDED' | 'NOT_PAYABLE' | 'INVALID_INPUT' | 'TOO_MANY'; slip_id?: string }>
  /** The menu ids the owner published (kept after LINE accepted the menu); the old id comes back so it can be deleted at LINE. */
  richMenuSave(kind: RichMenuKind, richMenuId: string, actorId: string | null): Promise<string | null>
  richMenuClear(kind: RichMenuKind, actorId: string | null): Promise<string | null>
  /** The shop's answer to a request goes to that friend's chat, even before they are linked (never to a friend who blocked the OA). */
  enqueueRegister(input: { contactId: string; templateKey: string; messages: unknown[]; dedupeKey: string }): Promise<{ duplicate: boolean }>
  /** The registration form (LIFF): the same request as the chat, plus the address and the consent. */
  registerSubmit(input: {
    lineUserId: string
    name: string
    phone: string
    address: Record<string, string>
    consent: boolean
    displayName: string | null
    isFriend: boolean | null
  }): Promise<{ result: 'PENDING' | 'INVALID' | 'MISSING' | 'CONSENT_REQUIRED' | 'ALREADY_LINKED' | 'REJECTED' | 'RATE_LIMITED' | 'DUPLICATE' | 'SUSPENDED'; fields?: string[] }>
  /** What the registration form needs to know before it is sent: the must-fill fields and the privacy text (public, not secret). */
  registerConfig(): Promise<{ required: Record<string, boolean>; privacy: string | null; shopName: string }>
  ownerFinanceForm(lineUserId: string): Promise<{ result: 'OK' | 'SUSPENDED' | 'NOT_OWNER'; name?: string; income_items?: string[] }>
  financeEntry(lineUserId: string, entry: LiffFinanceEntry): Promise<{ result: 'OK' | 'SUSPENDED' | 'NOT_OWNER' | 'INVALID_INPUT'; doc_no?: string; amount?: number }>
} {
  /** Task title and its appointment's type code (step names), read after the RPC answered. */
  const taskInfo = async (taskId: string): Promise<{ title?: string; appointment_type?: string | null }> => {
    const { data } = await db.from('line_tasks').select('title, appointment_id').eq('id', taskId).maybeSingle()
    if (!data?.appointment_id) return { title: data?.title ?? undefined }
    const { data: apt } = await db.from('appointments').select('appointment_type').eq('id', data.appointment_id).maybeSingle()
    return { title: data.title ?? undefined, appointment_type: (apt?.appointment_type as string | undefined) ?? null }
  }

  let catalogRevision: string | undefined
  const recordedDecisions = new Map<string, InteractionDecision>()
  const catalogRead = async <T extends CatalogCategory[] | CatalogPage | { id: string; name: string } | null>(key: string, load: () => Promise<T>) => {
    const revision = catalogRevision ?? await call<string | null>(db, 'line_catalog_revision', {})
    return revision ? cachedPublicCatalog(revision, key, load) : load()
  }
  let profileCache: Promise<ShopProfile> | null = null
  async function shopProfile(): Promise<ShopProfile> {
    profileCache ??= (async () => {
      // Only the LINE parts of policies: the whole column also carries the shop's images (~600 KB).
      const { data: row, error } = await db
        .from('store_settings')
        .select(`company_name, phone, ${SHOP_LINE_ID_COLUMN}, ${SHOP_LINE_TEMPLATES_COLUMN}`)
        .eq('singleton', true)
        .maybeSingle()
      if (error) throw new LineStoreError('store_settings', error.code)
      const data = row as {
        company_name?: string | null
        phone?: string | null
        line_id?: string | null
        templates?: Record<string, unknown> | null
      } | null
      return {
        shopName: (data?.company_name || '').trim() || 'ร้าน',
        templates: data?.templates ?? {},
        lineId: data?.line_id?.trim() || null,
        phone: data?.phone?.trim() || null,
      }
    })()
    return profileCache
  }

  async function enqueueServer(input: Parameters<CronStore['enqueueServer']>[0]) {
    const r = await call<{ duplicate?: boolean; skipped?: string }>(db, 'line_outbox_enqueue_server', {
      p_contact_id: input.contactId,
      p_source_type: input.sourceType,
      p_source_id: input.sourceId,
      p_task_id: input.taskId ?? null,
      p_template_key: input.templateKey,
      p_messages: input.messages,
      p_dedupe_key: input.dedupeKey,
    })
    return { duplicate: Boolean(r?.duplicate || r?.skipped) }
  }

  return {
    enqueueServer,

    scanDue: () => call<number>(db, 'rental_overdue_scan', {}).then((n) => n ?? 0),

    claimNotifications: (limit) =>
      call<Array<{ notification_id: string }>>(db, 'line_notifications_claim', { p_limit: limit }).then((rows) => (rows ?? []).map((r) => r.notification_id)),

    remindersDue: () => call<ReminderRow[]>(db, 'line_customer_reminders_due', {}).then((rows) => rows ?? []),

    acceptOverdue: () =>
      call<Array<{ task_id: string; contact_id: string; title: string; dedupe_key: string }>>(db, 'line_driver_accept_overdue', {}).then((rows) => rows ?? []),

    async jobProgress(taskId, stage, stageLabel) {
      const r = await call<{
        customer: { contact_id: string; name: string } | null
        appointment_id?: string
        title?: string
        driver_name?: string
        dedupe_key?: string
      }>(db, 'line_task_progress', { p_task_id: taskId, p_stage: stage, p_stage_label: stageLabel })
      if (!r?.customer || !r.appointment_id || !r.dedupe_key) return
      const shop = await shopProfile()
      const messages = customerNoticeMessages(
        'CUSTOMER_JOB_STEP',
        stageLabel,
        { ชื่อลูกค้า: r.customer.name || '-', เรื่อง: r.title || '-', ขั้นตอน: stageLabel, คนขับ: r.driver_name || '-', ชื่อร้าน: shop.shopName },
        shop.templates,
        { chatUrl: lineOaMessageUrl(shop.lineId, ''), phone: shop.phone },
      )
      await enqueueServer({ contactId: r.customer.contact_id, sourceType: 'APPOINTMENT', sourceId: r.appointment_id, templateKey: 'CUSTOMER_JOB_STEP', messages, dedupeKey: r.dedupe_key })
    },

    liffBind: (input) =>
      call<LiffBindResult>(db, 'line_liff_bind', {
        p_line_user_id: input.lineUserId,
        p_display_name: input.displayName,
        p_code: input.code,
        p_typed_name: input.typedName,
        p_typed_phone: input.typedPhone,
        p_line_handle: input.lineHandle,
        p_is_friend: input.isFriend,
      }),

    driverJob: (lineUserId, taskId) => call<LiffDriverJob>(db, 'line_driver_job', { p_line_user_id: lineUserId, p_task_id: taskId }),

    async uploadJobPhoto(path, bytes, contentType) {
      const { error } = await db.storage.from(JOB_PHOTO_BUCKET).upload(path, bytes, { contentType, upsert: false })
      if (error) throw new LineStoreError('job_photo_upload')
    },

    async removeJobPhotos(paths) {
      if (paths.length) await db.storage.from(JOB_PHOTO_BUCKET).remove(paths)
    },

    staffQrScan: (token) => call(db, 'line_staff_qr_scan', { p_token: token }),

    payForm: (lineUserId, billId) => call<LiffPayForm>(db, 'line_pay_form', { p_line_user_id: lineUserId, p_bill_id: billId }),

    async uploadSlip(path, bytes, contentType) {
      const { error } = await db.storage.from(SLIP_BUCKET).upload(path, bytes, { contentType, upsert: false })
      if (error) throw new LineStoreError('slip_upload')
    },

    async removeSlip(path) {
      await db.storage.from(SLIP_BUCKET).remove([path])
    },

    slipSubmit: (input) =>
      call(db, 'line_slip_submit', {
        p_line_user_id: input.lineUserId,
        p_bill_id: input.billId,
        p_amount: input.amount,
        p_path: input.path,
        p_owner_messages: input.ownerMessages,
      }),

    ownerSummary: (lineUserId) => call(db, 'line_owner_summary', { p_line_user_id: lineUserId }),

    ownerTaskResolve: (lineUserId, text) => call(db, 'line_owner_task_resolve', { p_line_user_id: lineUserId, p_text: text }),

    ownerTaskCreate: (input) =>
      call(db, 'line_owner_task_create', {
        p_line_user_id: input.lineUserId,
        p_event_id: input.eventId,
        p_task_id: input.taskId,
        p_assignee_id: input.assigneeId,
        p_title: input.title,
        p_messages: input.messages,
      }),

    enqueueRegister: async (input) => {
      const r = await call<{ duplicate?: boolean; skipped?: string }>(db, 'line_outbox_enqueue_register', {
        p_contact_id: input.contactId,
        p_template_key: input.templateKey,
        p_messages: input.messages,
        p_dedupe_key: input.dedupeKey,
      })
      return { duplicate: Boolean(r?.duplicate || r?.skipped) }
    },

    richMenuPending: (limit) => call<RichMenuPerson[]>(db, 'line_rich_menu_pending', { p_limit: limit }).then((rows) => rows ?? []),
    richMenuPublished: () => call<Partial<Record<RichMenuKind, string>>>(db, 'line_rich_menu_published', {}).then((m) => m ?? {}),
    richMenuMark: async (contactId, kind, ok) => {
      await call(db, 'line_rich_menu_mark', { p_contact_id: contactId, p_kind: kind, p_ok: ok })
    },
    richMenuForUser: (lineUserId) => call<RichMenuPerson | null>(db, 'line_rich_menu_for_user', { p_line_user_id: lineUserId }),
    richMenuSave: (kind, richMenuId, actorId) => call<string | null>(db, 'line_rich_menu_save', { p_kind: kind, p_rich_menu_id: richMenuId, p_actor: actorId }),
    richMenuClear: (kind, actorId) => call<string | null>(db, 'line_rich_menu_clear', { p_kind: kind, p_actor: actorId }),

    catalogCategories: () => catalogRead('categories', () => call<CatalogCategory[]>(db, 'line_catalog_categories', {}).then((rows) => rows ?? [])),

    catalogItems: (categoryId, page) =>
      catalogRead(`items:${categoryId}:${page}`, () => call<CatalogPage | null>(db, 'line_catalog_items', { p_category: categoryId, p_offset: Math.max(0, page) * CATALOG_PAGE_SIZE })),

    catalogItem: (productId) => catalogRead(`item:${productId}`, () => call<{ id: string; name: string } | null>(db, 'line_catalog_item', { p_product: productId })),

    registerSubmit: (input) =>
      call(db, 'line_register_submit', {
        p_line_user_id: input.lineUserId,
        p_name: input.name,
        p_phone: input.phone,
        p_address: input.address,
        p_consent: input.consent,
        p_display_name: input.displayName,
        p_is_friend: input.isFriend,
      }),

    registerConfig: async () => {
      const { data, error } = await db
        .from('store_settings')
        .select('company_name, required:policies->line->register->required, privacy:policies->line->register->>privacy')
        .eq('singleton', true)
        .maybeSingle()
      if (error) throw new LineStoreError('store_settings', error.code)
      const row = data as { company_name?: string | null; required?: Record<string, unknown> | null; privacy?: string | null } | null
      const required = Object.fromEntries(Object.entries(row?.required ?? {}).filter(([, on]) => on === true)) as Record<string, boolean>
      return { required, privacy: row?.privacy?.trim() || null, shopName: (row?.company_name || '').trim() || 'ร้าน' }
    },

    ownerFinanceForm: (lineUserId) => call(db, 'line_owner_finance_form', { p_line_user_id: lineUserId }),

    financeEntry: (lineUserId, e) =>
      call(db, 'line_finance_entry', {
        p_line_user_id: lineUserId,
        p_kind: e.kind,
        p_category: e.category,
        p_amount: e.amount,
        p_channel: e.channel,
        p_note: e.note,
      }),

    async credentials() {
      const rows = await call<Array<{ channel_secret: string | null; access_token: string | null }>>(db, 'line_channel_credentials', {})
      const row = rows?.[0]
      return { channelSecret: row?.channel_secret ?? null, accessToken: row?.access_token ?? null }
    },

    shopProfile,

    async recordEvent(e): Promise<RecordedEvent> {
      const r = await call<{ duplicate: boolean; contact_id?: string; status?: RecordedEvent['status']; reply_allowed?: boolean; interaction?: InteractionDecision }>(db, 'line_webhook_event', {
        p_event_id: e.eventId,
        p_line_user_id: e.lineUserId,
        p_kind: e.kind,
        p_text: e.text,
        p_line_message_id: e.lineMessageId,
        p_event_at: e.eventAt.toISOString(),
      })
      if (r?.interaction && e.text) recordedDecisions.set(`${e.lineUserId}:${e.text}`, r.interaction)
      return { duplicate: Boolean(r?.duplicate), contactId: r?.contact_id, status: r?.status, replyAllowed: r?.reply_allowed }
    },

    async checkInteraction(lineUserId, scope, key) {
      const recordedKey = `${lineUserId}:${key}`
      const recorded = recordedDecisions.get(recordedKey)
      recordedDecisions.delete(recordedKey)
      const result = recorded ?? await call<InteractionDecision>(db, 'line_interaction_check', { p_line_user_id: lineUserId, p_scope: scope, p_key: key.slice(0, 128) })
      if (result.allowed) catalogRevision = result.catalog_revision
      return result
    },
    consumeLinkCode: (lineUserId, code) => call<LinkResult>(db, 'line_link_code_consume', { p_line_user_id: lineUserId, p_code: code }),

    followContact: (lineUserId, displayName, pictureUrl, isUnblock) =>
      call<{ status: 'UNLINKED' | 'LINKED'; register_status: string | null; is_new?: boolean; send_welcome: boolean }>(db, 'line_contact_follow', {
        p_line_user_id: lineUserId,
        p_display_name: displayName,
        p_picture_url: pictureUrl,
        p_is_unblock: isUnblock,
      }),

    selfRegister: (lineUserId, name, phone) =>
      call<SelfRegisterResult>(db, 'line_self_register', { p_line_user_id: lineUserId, p_name: name, p_phone: phone }),

    async taskPostback(lineUserId, taskId, action): Promise<TaskPostbackResult> {
      const r = await call<TaskPostbackResult>(db, 'line_task_postback', { p_line_user_id: lineUserId, p_task_id: taskId, p_action: action })
      if (r.result === 'ACCEPTED' || r.result === 'DONE' || (r.result === 'ALREADY' && r.next_stage !== undefined)) {
        return { ...r, ...(await taskInfo(taskId)) }
      }
      return r
    },

    async taskStep(lineUserId, taskId, stage, extra): Promise<TaskStepResult> {
      const r = await call<TaskStepResult>(db, 'line_task_step', {
        p_line_user_id: lineUserId,
        p_task_id: taskId,
        p_stage: stage,
        ...(extra ? { p_note: extra.note, p_photos: extra.photos } : {}),
      })
      if (r.result === 'STEP_DONE' || r.result === 'ALREADY' || r.result === 'OUT_OF_ORDER') return { ...r, ...(await taskInfo(taskId)) }
      return r
    },

    recipients: (notificationId) =>
      call<Array<{ contact_id: string }>>(db, 'line_notification_recipients', { p_notification_id: notificationId }).then((rows) => rows ?? []),

    async notification(notificationId) {
      const { data, error } = await db
        .from('notifications')
        .select('id, event_type, entity_id, title, body')
        .eq('id', notificationId)
        .maybeSingle()
      if (error) throw new LineStoreError('notifications', error.code)
      return data
    },

    async enqueueSystem(input) {
      const r = await call<{ duplicate?: boolean; skipped?: string }>(db, 'line_outbox_enqueue_system', {
        p_contact_id: input.contactId,
        p_source_type: 'NOTIFICATION',
        p_source_id: input.sourceId,
        p_notification_id: input.notificationId,
        p_template_key: input.templateKey,
        p_messages: input.messages,
        p_dedupe_key: input.dedupeKey,
      })
      return { duplicate: Boolean(r?.duplicate || r?.skipped) }
    },

    canSend: (deliveryId) => call<boolean>(db, 'line_delivery_ready', { p_delivery_id: deliveryId }),
    claim: (limit, leaseSeconds) =>
      call<ClaimedDelivery[]>(db, 'line_outbox_claim', { p_limit: limit, p_lease_seconds: leaseSeconds }).then((rows) => rows ?? []),

    async complete(id, outcome, info) {
      await call<void>(db, 'line_outbox_complete', {
        p_id: id,
        p_outcome: outcome,
        p_http_status: info.httpStatus,
        p_error_code: info.errorCode,
        p_request_id: info.requestId,
        p_retry_at: info.retryAt ? info.retryAt.toISOString() : null,
      })
    },
  }
}
