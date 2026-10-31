import 'server-only'
import { type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { type FanoutStore } from './notification-fanout'
import { type ClaimedDelivery, type OutboxStore } from './outbox'
import { type LinkResult, type RecordedEvent, type SelfRegisterResult, type TaskPostbackResult, type TaskStepResult, type WebhookStore } from './webhook'
import { type CronStore, type ReminderRow } from './cron'
import { customerNoticeMessages } from './templates'
import { lineOaMessageUrl } from './oa-link'

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

export interface ShopProfile {
  shopName: string
  templates: Record<string, unknown>
  /** Settings › กิจการ LINE ID / phone, for the "chat / call the shop" buttons. */
  lineId: string | null
  phone: string | null
}

export function createSupabaseLineStore(db: SupabaseClient = createAdminClient()): WebhookStore & OutboxStore & FanoutStore & CronStore & {
  credentials(): Promise<{ channelSecret: string | null; accessToken: string | null }>
  shopProfile(): Promise<ShopProfile>
  liffBind(input: LiffBindInput): Promise<LiffBindResult>
} {
  /** Task title and its appointment's type code (step names), read after the RPC answered. */
  const taskInfo = async (taskId: string): Promise<{ title?: string; appointment_type?: string | null }> => {
    const { data } = await db.from('line_tasks').select('title, appointment_id').eq('id', taskId).maybeSingle()
    if (!data?.appointment_id) return { title: data?.title ?? undefined }
    const { data: apt } = await db.from('appointments').select('appointment_type').eq('id', data.appointment_id).maybeSingle()
    return { title: data.title ?? undefined, appointment_type: (apt?.appointment_type as string | undefined) ?? null }
  }

  let profileCache: Promise<ShopProfile> | null = null
  async function shopProfile(): Promise<ShopProfile> {
    profileCache ??= (async () => {
      const { data, error } = await db.from('store_settings').select('company_name, phone, policies').eq('singleton', true).maybeSingle()
      if (error) throw new LineStoreError('store_settings', error.code)
      const policies = (data?.policies ?? {}) as {
        line?: { templates?: Record<string, unknown> }
        business_profile?: { lineId?: string }
      }
      return {
        shopName: (data?.company_name || '').trim() || 'ร้าน',
        templates: policies.line?.templates ?? {},
        lineId: policies.business_profile?.lineId?.trim() || null,
        phone: (data?.phone as string | null | undefined)?.trim() || null,
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

    async credentials() {
      const rows = await call<Array<{ channel_secret: string | null; access_token: string | null }>>(db, 'line_channel_credentials', {})
      const row = rows?.[0]
      return { channelSecret: row?.channel_secret ?? null, accessToken: row?.access_token ?? null }
    },

    shopProfile,

    async recordEvent(e): Promise<RecordedEvent> {
      const r = await call<{ duplicate: boolean; contact_id?: string; status?: RecordedEvent['status'] }>(db, 'line_webhook_event', {
        p_event_id: e.eventId,
        p_line_user_id: e.lineUserId,
        p_kind: e.kind,
        p_text: e.text,
        p_line_message_id: e.lineMessageId,
        p_event_at: e.eventAt.toISOString(),
      })
      return { duplicate: Boolean(r?.duplicate), contactId: r?.contact_id, status: r?.status }
    },

    consumeLinkCode: (lineUserId, code) => call<LinkResult>(db, 'line_link_code_consume', { p_line_user_id: lineUserId, p_code: code }),

    followContact: (lineUserId, displayName) =>
      call<{ status: 'UNLINKED' | 'LINKED'; register_status: string | null }>(db, 'line_contact_follow', {
        p_line_user_id: lineUserId,
        p_display_name: displayName,
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

    async taskStep(lineUserId, taskId, stage): Promise<TaskStepResult> {
      const r = await call<TaskStepResult>(db, 'line_task_step', { p_line_user_id: lineUserId, p_task_id: taskId, p_stage: stage })
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
