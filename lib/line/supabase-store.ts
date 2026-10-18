import 'server-only'
import { type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { type FanoutStore } from './notification-fanout'
import { type ClaimedDelivery, type OutboxStore } from './outbox'
import { type LinkResult, type RecordedEvent, type TaskPostbackResult, type TaskStepResult, type WebhookStore } from './webhook'

/**
 * Database side of the webhook and the outbox, through the service_role-only RPCs of
 * migration 20261008160000_line_operations_v1. Errors never carry request data.
 */

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

export function createSupabaseLineStore(db: SupabaseClient = createAdminClient()): WebhookStore & OutboxStore & FanoutStore & {
  credentials(): Promise<{ channelSecret: string | null; accessToken: string | null }>
  shopProfile(): Promise<{ shopName: string; templates: Record<string, unknown> }>
} {
  /** Task title and its appointment's type code (step names), read after the RPC answered. */
  const taskInfo = async (taskId: string): Promise<{ title?: string; appointment_type?: string | null }> => {
    const { data } = await db.from('line_tasks').select('title, appointment_id').eq('id', taskId).maybeSingle()
    if (!data?.appointment_id) return { title: data?.title ?? undefined }
    const { data: apt } = await db.from('appointments').select('appointment_type').eq('id', data.appointment_id).maybeSingle()
    return { title: data.title ?? undefined, appointment_type: (apt?.appointment_type as string | undefined) ?? null }
  }

  return {
    async credentials() {
      const rows = await call<Array<{ channel_secret: string | null; access_token: string | null }>>(db, 'line_channel_credentials', {})
      const row = rows?.[0]
      return { channelSecret: row?.channel_secret ?? null, accessToken: row?.access_token ?? null }
    },

    async shopProfile() {
      const { data, error } = await db.from('store_settings').select('company_name, policies').eq('singleton', true).maybeSingle()
      if (error) throw new LineStoreError('store_settings', error.code)
      const policies = (data?.policies ?? {}) as { line?: { templates?: Record<string, unknown> } }
      return { shopName: (data?.company_name || '').trim() || 'ร้าน', templates: policies.line?.templates ?? {} }
    },

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
