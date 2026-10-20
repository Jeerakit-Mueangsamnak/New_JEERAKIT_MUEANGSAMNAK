'use server'

import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { assertValidMessages, LineMessageError } from '@/lib/line/messages'
import { driverTaskMessages, taskMessages, textMessage } from '@/lib/line/templates'
import { type LineMessage } from '@/lib/line/types'
import { processOutbox } from '@/lib/line/outbox'
import { lineOaMessageUrl } from '@/lib/line/oa-link'
import { createLineProvider, lineDeliveryMode } from '@/lib/line/provider'

/**
 * LINE actions for screens. Every call runs with the signed-in user's own session, so the
 * database decides (menu, OWNER, recipient matches the bill/appointment, idempotency) and
 * writes the audit. These functions only shape input and translate refusals to Thai.
 * Rows go to the outbox (line_deliveries); sendBillViaLine also runs the outbox once. Real LINE
 * is used only when LINE_DELIVERY_MODE=live on the server; otherwise the mock provider answers.
 */

export interface LineActionResult<T = unknown> {
  success: boolean
  error?: string
  data?: T
}

const ERRORS: Array<[RegExp, string]> = [
  [/^FORBIDDEN: active member/, 'บัญชียังไม่ได้รับอนุมัติหรือถูกระงับ'],
  [/^FORBIDDEN: OWNER only/, 'เฉพาะเจ้าของร้านเท่านั้น'],
  [/^FORBIDDEN: menu/, 'บัญชีนี้ไม่มีสิทธิ์ใช้เมนูนี้'],
  [/^FORBIDDEN/, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้'],
  [/^REASON_REQUIRED/, 'กรุณาระบุเหตุผล'],
  [/^CUSTOMER_INACTIVE/, 'ลูกค้ารายนี้ถูกปิดใช้งาน'],
  [/^LINE_CUSTOMER_ALREADY_LINKED/, 'ลูกค้ารายนี้ผูก LINE แล้ว'],
  [/^BILL_NOT_FOUND/, 'ไม่พบบิลนี้'],
  [/^LINE_CONTACT_NOT_LINKED/, 'ผู้รับยังไม่ได้ผูก LINE'],
  [/^LINE_CONTACT_UNREACHABLE/, 'ส่งไม่ถึงผู้รับ อาจบล็อกหรือลบ LINE ร้านแล้ว'],
  [/^LINE_RECIPIENT_MISMATCH/, 'ผู้รับไม่ตรงกับลูกค้าหรือผู้รับผิดชอบของรายการนี้'],
  [/^LINE_MESSAGE_INVALID|^LINE_TEXT_INVALID|^LINE_MESSAGE/, 'ข้อความไม่ถูกต้องหรือยาวเกินกำหนด'],
  [/^LINE_TASK_CLOSED/, 'งานนี้ปิดไปแล้ว'],
  [/^LINE_TASK_NOT_FOUND/, 'ไม่พบงานนี้'],
  [/^MEMBER_NOT_ACTIVE/, 'พนักงานคนนี้ยังไม่ได้รับอนุมัติหรือถูกระงับ'],
  [/^DRIVER_NOT_ACTIVE/, 'คนขับคนนี้ถูกปิดหรือไม่มีในรายชื่อคนขับ'],
  [/^DRIVER_NOT_DISPATCHED/, 'นัดหมายนี้สั่งงานให้คนขับคนอื่นแล้ว กรุณารีเฟรช'],
  [/^LINE_DRIVER_ALREADY_LINKED/, 'คนขับคนนี้ผูก LINE แล้ว'],
  [/^APPOINTMENT_NOT_EDITABLE/, 'นัดหมายนี้ปิดไปแล้วหรือไม่พบในระบบ'],
  [/^APPOINTMENT_NOT_FOUND/, 'ไม่พบงานนี้ในระบบ อาจถูกลบไปแล้ว กรุณารีเฟรช'],
  [/^APPOINTMENT_NOT_DISPATCHED/, 'งานนี้ยังไม่ได้สั่งงานให้พนักงาน'],
  [/^APPOINTMENT_HAS_DELIVERY/, 'งานนี้มีใบส่งของของบิลผูกอยู่ จึงลบไม่ได้ (เก็บเป็นหลักฐานบิลและสต็อก)'],
  [/^IDEMPOTENCY_KEY_REQUIRED/, 'คำขอไม่สมบูรณ์ กรุณาลองใหม่'],
  [/^LINE_CODE_BUSY/, 'ระบบกำลังสร้างรหัส กรุณาลองใหม่'],
  [/PGRST202|Could not find the function/, 'ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้'],
]

function thaiError(raw: string | undefined): string {
  for (const [re, text] of ERRORS) if (re.test(raw || '')) return text
  return 'ทำรายการ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<LineActionResult<T>> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { success: false, error: thaiError(error.message) }
  return { success: true, data: data as T }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY = /^[A-Za-z0-9_-]{8,120}$/
const bad = (error: string): LineActionResult<never> => ({ success: false, error })

/** STAFF link (own account only). The code is shown once; the database keeps only its hash. */
export async function createMyLineLinkCode() {
  return callRpc<{ code: string; expires_at: string }>('line_link_code_create_staff', {})
}

/**
 * CUSTOMER link through the shop's official account (1:1 chat only). Staff create a single-use
 * code for ONE customer; the customer adds the OA and sends the code from their own LINE; the
 * webhook binds that LINE to that customer. The code lives 10 minutes, only its hash is kept,
 * and the staff member gets an in-app notice when it is used (so a wrong link is seen at once).
 */
export async function createCustomerLineLinkCode(customerId: string) {
  if (!UUID.test(customerId || '')) return bad('ไม่พบลูกค้า')
  const r = await callRpc<{ code: string; expires_at: string }>('line_link_code_create_customer', { p_customer_id: customerId })
  if (!r.success || !r.data) return r as LineActionResult<never>
  const supabase = await createServerSupabase()
  const { data: shop } = await supabase.from('store_settings').select('policies').eq('singleton', true).maybeSingle()
  const lineId = (shop?.policies as { business_profile?: { lineId?: string } } | null)?.business_profile?.lineId
  return {
    success: true,
    data: { code: r.data.code, expires_at: r.data.expires_at, oaUrl: lineOaMessageUrl(lineId, r.data.code) },
  } as LineActionResult<{ code: string; expires_at: string; oaUrl: string | null }>
}

export async function unlinkLineContact(contactId: string, reason?: string) {
  if (!UUID.test(contactId || '')) return bad('ไม่พบรายการ LINE นี้')
  return callRpc('line_contact_unlink', { p_contact_id: contactId, p_reason: reason?.trim() || null })
}

/**
 * Queue a message the user wrote or picked on a bill / appointment (LineSendModal), or a test
 * to the user's own LINE. idempotencyKey = one per button press, so a double click sends once.
 */
export async function queueLineMessage(input: {
  contactId: string
  sourceType: 'BILL' | 'APPOINTMENT' | 'TEST'
  sourceId: string | null
  templateKey: string
  text: string
  idempotencyKey: string
}) {
  if (!input || !UUID.test(input.contactId || '')) return bad('ไม่พบผู้รับ')
  if (!['BILL', 'APPOINTMENT', 'TEST'].includes(input.sourceType)) return bad('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้')
  if (input.sourceType !== 'TEST' && !UUID.test(input.sourceId || '')) return bad('ไม่พบรายการอ้างอิง')
  if (!KEY.test(input.idempotencyKey || '')) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  if (!/^[A-Z_]{2,40}$/.test(input.templateKey || '')) return bad('ข้อความไม่ถูกต้องหรือยาวเกินกำหนด')
  const messages: LineMessage[] = [{ type: 'text', text: (input.text ?? '').trim() }]
  try {
    assertValidMessages(messages)
  } catch {
    return bad('ข้อความไม่ถูกต้องหรือยาวเกินกำหนด')
  }
  return callRpc<{ delivery_id: string; status: string; duplicate: boolean }>('line_delivery_enqueue', {
    p_contact_id: input.contactId,
    p_source_type: input.sourceType,
    p_source_id: input.sourceType === 'TEST' ? null : input.sourceId,
    p_template_key: input.templateKey,
    p_messages: messages,
    p_idempotency_key: input.idempotencyKey,
  })
}

/** "ส่งข้อความทดสอบถึงฉัน": goes only to the caller's own linked LINE. */
export async function sendLineTestToMe(idempotencyKey: string) {
  if (!KEY.test(idempotencyKey || '')) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  const supabase = await createServerSupabase()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return bad('กรุณาเข้าสู่ระบบ')
  const [{ data: contact }, { data: shop }] = await Promise.all([
    supabase.from('line_contacts').select('id').eq('profile_id', auth.user.id).eq('status', 'LINKED').maybeSingle(),
    supabase.from('store_settings').select('company_name').eq('singleton', true).maybeSingle(),
  ])
  if (!contact?.id) return bad('ยังไม่ได้ผูก LINE ของคุณ')
  const text = textMessage('TEST', { ชื่อร้าน: (shop?.company_name || '').trim() || 'ร้าน' })
  return queueLineMessage({
    contactId: contact.id,
    sourceType: 'TEST',
    sourceId: null,
    templateKey: 'TEST',
    text: text.type === 'text' ? text.text : '',
    idempotencyKey,
  })
}

export type BillLineRecipient = {
  state: 'LINKED' | 'NOT_LINKED' | 'UNREACHABLE' | 'NO_CUSTOMER'
  customer_id?: string
  display_name?: string | null
}

/** Whether this bill's customer can get LINE messages (no LINE user id leaves the database). */
export async function getBillLineRecipient(billId: string) {
  if (!UUID.test(billId || '')) return bad('ไม่พบบิลนี้')
  return callRpc<BillLineRecipient>('line_bill_recipient', { p_bill_id: billId })
}

/**
 * "ส่งทาง LINE" on the bill screen. The text is the bill message the screen already built from
 * the stored bill (no amounts are computed here); the database sends it to that bill's own
 * customer only. After queueing, the outbox is run once so the message goes out now; if that
 * run fails the row stays queued and is retried by the next run.
 */
export async function sendBillViaLine(input: {
  billId: string
  text: string
  idempotencyKey: string
}): Promise<LineActionResult<{ delivery_id: string; status: string; duplicate: boolean; mode: 'mock' | 'live' }>> {
  if (!input || !UUID.test(input.billId || '')) return bad('ไม่พบบิลนี้')
  if (!KEY.test(input.idempotencyKey || '')) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  const text = (input.text ?? '').trim()
  try {
    assertValidMessages([{ type: 'text', text }])
  } catch {
    return bad('ข้อความไม่ถูกต้องหรือยาวเกินกำหนด')
  }
  const queued = await callRpc<{ delivery_id: string; status: string; duplicate: boolean }>('line_bill_send', {
    p_bill_id: input.billId,
    p_text: text,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!queued.success || !queued.data) return { success: false, error: queued.error }
  const status = await runOutboxOnce({ id: queued.data.delivery_id })
  return { success: true, data: { ...queued.data, status: status ?? queued.data.status, mode: lineDeliveryMode() } }
}

/**
 * Runs the outbox once and returns the stored status of one row (SENT only after LINE answered
 * OK). In mock mode nothing is pushed: the row stays PENDING, so no screen shows a mock as sent.
 */
async function runOutboxOnce(row: { id: string } | { task_id: string } | null): Promise<string | null> {
  try {
    const { createSupabaseLineStore } = await import('@/lib/line/supabase-store')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const store = createSupabaseLineStore()
    if (lineDeliveryMode() === 'live') {
      const { accessToken } = await store.credentials()
      await processOutbox({ store, provider: createLineProvider(accessToken), limit: 5 })
    }
    if (!row) return null
    const [column, value] = 'id' in row ? ['id', row.id] : ['task_id', row.task_id]
    const { data } = await createAdminClient().from('line_deliveries').select('status').eq(column, value).maybeSingle()
    return (data?.status as string | undefined) ?? null
  } catch {
    return null
  }
}

/** Work order to a staff member (OWNER). The task id is created first so the buttons can carry it. */
export async function createLineTask(input: {
  assigneeId: string
  title: string
  detail?: string
  billId?: string | null
  appointmentId?: string | null
  idempotencyKey: string
}) {
  if (!input || !UUID.test(input.assigneeId || '')) return bad('ไม่พบพนักงาน')
  const title = (input.title ?? '').trim()
  if (!title || title.length > 200) return bad('กรุณาระบุเรื่อง (ไม่เกิน 200 ตัวอักษร)')
  if ((input.detail ?? '').length > 2000) return bad('รายละเอียดยาวเกินกำหนด')
  if (input.billId && !UUID.test(input.billId)) return bad('ไม่พบบิลอ้างอิง')
  if (input.appointmentId && !UUID.test(input.appointmentId)) return bad('ไม่พบนัดหมายอ้างอิง')
  if (!KEY.test(input.idempotencyKey || '')) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')

  const supabase = await createServerSupabase()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return bad('กรุณาเข้าสู่ระบบ')
  const [{ data: me }, { data: shop }] = await Promise.all([
    supabase.from('profiles').select('display_name, username').eq('id', auth.user.id).maybeSingle(),
    supabase.from('store_settings').select('policies').eq('singleton', true).maybeSingle(),
  ])
  // The text the OWNER saved in Settings › LINE (TASK_NEW) is the one sent
  const templates = (shop?.policies as { line?: { templates?: Record<string, string> } } | null)?.line?.templates
  // The buttons need the task id before the row exists: the database accepts a pre-made id.
  const taskId = crypto.randomUUID()
  let messages: LineMessage[]
  try {
    messages = taskMessages(taskId, { ผู้สั่ง: me?.display_name || me?.username || 'เจ้าของร้าน', เรื่อง: title }, templates)
  } catch (error) {
    return bad(error instanceof LineMessageError ? 'ข้อความไม่ถูกต้องหรือยาวเกินกำหนด' : 'ทำรายการ LINE ไม่สำเร็จ')
  }
  const created = await callRpc<{ task_id: string; duplicate: boolean }>('line_task_create', {
    p_task_id: taskId,
    p_assignee_id: input.assigneeId,
    p_title: title,
    p_detail: input.detail?.trim() || null,
    p_bill_id: input.billId || null,
    p_appointment_id: input.appointmentId || null,
    p_messages: messages,
    p_idempotency_key: input.idempotencyKey,
  })
  // Queued only is not sent: push now like the bill send (a failed run stays queued for retry)
  if (created.success && created.data && !created.data.duplicate) await runOutboxOnce(null)
  return created
}

const DRIVER_CODE = /^D\d{3,6}$/

/**
 * Driver link (OWNER). Drivers do not sign in: the OWNER makes a single-use code for one driver
 * code and the driver sends it from their own LINE in the shop chat (QR / link like customers).
 */
export async function createDriverLineLinkCode(driverCode: string) {
  if (!DRIVER_CODE.test(driverCode || '')) return bad('ไม่พบคนขับ')
  const r = await callRpc<{ code: string; expires_at: string }>('line_link_code_create_driver', { p_driver_code: driverCode })
  if (!r.success || !r.data) return r as LineActionResult<never>
  const supabase = await createServerSupabase()
  const { data: shop } = await supabase.from('store_settings').select('policies').eq('singleton', true).maybeSingle()
  const lineId = (shop?.policies as { business_profile?: { lineId?: string } } | null)?.business_profile?.lineId
  return {
    success: true,
    data: { code: r.data.code, expires_at: r.data.expires_at, oaUrl: lineOaMessageUrl(lineId, r.data.code) },
  } as LineActionResult<{ code: string; expires_at: string; oaUrl: string | null }>
}

export interface DriverDispatchResult {
  task_id: string
  duplicate: boolean
  /** line_deliveries.status: SENT only after LINE answered OK */
  status: string | null
  mode: 'mock' | 'live'
}

/**
 * Staff job to a driver over LINE (separate from customer bill messages). The appointment must
 * already be dispatched to this driver (saved first in the POS); the database checks that, the
 * driver's link and the caller's appointments menu. One key per dispatch, so a retry sends once.
 */
export async function sendDispatchToDriver(input: {
  appointmentId: string
  driverCode: string
  title: string
  detail?: string
  idempotencyKey: string
}): Promise<LineActionResult<DriverDispatchResult>> {
  if (!input || !UUID.test(input.appointmentId || '')) return bad('ไม่พบนัดหมายอ้างอิง')
  if (!DRIVER_CODE.test(input.driverCode || '')) return bad('ไม่พบคนขับ')
  const title = (input.title ?? '').trim().slice(0, 200)
  if (!title) return bad('กรุณาระบุเรื่อง (ไม่เกิน 200 ตัวอักษร)')
  if (!KEY.test(input.idempotencyKey || '')) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')

  const supabase = await createServerSupabase()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return bad('กรุณาเข้าสู่ระบบ')
  const [{ data: me }, { data: shop }] = await Promise.all([
    supabase.from('profiles').select('display_name, username').eq('id', auth.user.id).maybeSingle(),
    supabase.from('store_settings').select('policies').eq('singleton', true).maybeSingle(),
  ])
  const templates = (shop?.policies as { line?: { templates?: Record<string, string> } } | null)?.line?.templates
  const taskId = crypto.randomUUID()
  let messages: LineMessage[]
  try {
    messages = driverTaskMessages(taskId, { ผู้สั่ง: me?.display_name || me?.username || 'ร้าน', เรื่อง: title }, templates)
  } catch (error) {
    return bad(error instanceof LineMessageError ? 'ข้อความไม่ถูกต้องหรือยาวเกินกำหนด' : 'ทำรายการ LINE ไม่สำเร็จ')
  }
  const created = await callRpc<{ task_id: string; duplicate: boolean }>('line_task_create_driver', {
    p_task_id: taskId,
    p_driver_code: input.driverCode,
    p_title: title,
    p_detail: input.detail?.trim().slice(0, 2000) || null,
    p_appointment_id: input.appointmentId,
    p_messages: messages,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!created.success || !created.data) return { success: false, error: created.error }
  const status = await runOutboxOnce({ task_id: created.data.task_id })
  return { success: true, data: { ...created.data, status, mode: lineDeliveryMode() } }
}

export interface WithdrawResult {
  /** open LINE jobs of drivers who no longer hold the appointment, now cancelled */
  withdrawn: number
  /** notices queued to those drivers' LINE */
  queued: number
  /** drivers whose LINE is not linked or blocked the shop: not told on LINE */
  unreachable: number
  /** notices LINE answered OK for (live mode only) */
  sent: number
  mode: 'mock' | 'live'
}

/** The notice to a driver who loses the job (Settings › LINE texts when the OWNER changed them). */
async function withdrawMessages(kind: 'WITHDRAWN' | 'CANCELLED', title: string, reason?: string): Promise<LineMessage[] | null> {
  const supabase = await createServerSupabase()
  const { data: shop } = await supabase.from('store_settings').select('policies').eq('singleton', true).maybeSingle()
  const templates = (shop?.policies as { line?: { templates?: Record<string, string> } } | null)?.line?.templates
  const subject = (title ?? '').trim().slice(0, 200) || 'งาน'
  try {
    const messages =
      kind === 'CANCELLED'
        ? [textMessage('TASK_CANCELLED', { เรื่อง: subject, เหตุผล: (reason ?? '').trim().slice(0, 200) || 'ร้านยกเลิกงาน' }, templates)]
        : [textMessage('TASK_WITHDRAWN', { เรื่อง: subject }, templates)]
    assertValidMessages(messages)
    return messages
  } catch {
    return null
  }
}

/** Live mode: push the queued notices now and count the ones LINE answered OK for (W:<task id>). */
async function pushWithdrawNotices(taskFilter: { appointmentId: string } | { taskIds: string[] }): Promise<number> {
  if (lineDeliveryMode() !== 'live') return 0
  await runOutboxOnce(null)
  const { createAdminClient } = await import('@/lib/supabase/admin')
  let ids: string[]
  if ('taskIds' in taskFilter) ids = taskFilter.taskIds
  else {
    const { data: tasks } = await createAdminClient().from('line_tasks').select('id').eq('appointment_id', taskFilter.appointmentId).eq('status', 'CANCELLED')
    ids = (tasks ?? []).map((t) => t.id as string)
  }
  if (!ids.length) return 0
  const { count } = await createAdminClient()
    .from('line_deliveries')
    .select('id', { count: 'exact', head: true })
    .in('dedupe_key', ids.map((id) => `W:${id}`))
    .eq('status', 'SENT')
  return count ?? 0
}

/**
 * Withdraw (ถอนงาน): REASSIGN after the job was dispatched to another driver, UNASSIGN when the
 * shop takes the driver off the job (status tab ยกเลิกงาน: the job stays and can be dispatched
 * again), CANCEL after an appointment cancelled by status. The database cancels the open LINE
 * jobs of every driver who no longer holds the job (their buttons stop working) and queues the
 * notice to each of them once.
 */
export async function withdrawDriverTasks(input: {
  appointmentId: string
  kind: 'REASSIGN' | 'UNASSIGN' | 'CANCEL'
  title: string
  reason?: string
}): Promise<LineActionResult<WithdrawResult>> {
  if (!input || !UUID.test(input.appointmentId || '')) return bad('ไม่พบนัดหมายอ้างอิง')
  if (!['REASSIGN', 'UNASSIGN', 'CANCEL'].includes(input.kind)) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  const messages = await withdrawMessages(input.kind === 'CANCEL' ? 'CANCELLED' : 'WITHDRAWN', input.title, input.reason)
  if (!messages) return bad('ข้อความไม่ถูกต้องหรือยาวเกินกำหนด')
  const r = await callRpc<{ withdrawn: number; queued: number; unreachable: number }>('line_driver_tasks_withdraw', {
    p_appointment_id: input.appointmentId,
    p_kind: input.kind,
    p_messages: messages,
  })
  if (!r.success || !r.data) return { success: false, error: r.error }
  const sent = r.data.queued > 0 ? await pushWithdrawNotices({ appointmentId: input.appointmentId }) : 0
  return { success: true, data: { ...r.data, sent, mode: lineDeliveryMode() } }
}

/**
 * ยกเลิกงาน on the job details: the job is deleted from the database (appointment_delete). Its
 * driver's open LINE job is cancelled and the driver told first; a job with a delivery note of a
 * bill is refused by the database. Customers, bills, payments and stock are not touched.
 */
export async function deleteAppointmentJob(input: { appointmentId: string; title: string }): Promise<LineActionResult<WithdrawResult>> {
  if (!input || !UUID.test(input.appointmentId || '')) return bad('ไม่พบนัดหมายอ้างอิง')
  const messages = await withdrawMessages('CANCELLED', input.title, 'ร้านยกเลิกงาน')
  if (!messages) return bad('ข้อความไม่ถูกต้องหรือยาวเกินกำหนด')
  // the job is gone after the call: remember its open driver tasks to count the notices sent
  const supabase = await createServerSupabase()
  const { data: open } = await supabase
    .from('line_tasks')
    .select('id')
    .eq('appointment_id', input.appointmentId)
    .not('driver_code', 'is', null)
    .in('status', ['SENT', 'ACCEPTED'])
  const r = await callRpc<{ withdrawn: number; queued: number; unreachable: number }>('appointment_delete', {
    p_appointment_id: input.appointmentId,
    p_messages: messages,
  })
  if (!r.success || !r.data) return { success: false, error: r.error }
  const sent = r.data.queued > 0 ? await pushWithdrawNotices({ taskIds: (open ?? []).map((t) => t.id as string) }) : 0
  return { success: true, data: { withdrawn: r.data.withdrawn, queued: r.data.queued, unreachable: r.data.unreachable, sent, mode: lineDeliveryMode() } }
}

export async function cancelLineTask(taskId: string, reason: string) {
  if (!UUID.test(taskId || '')) return bad('ไม่พบงานนี้')
  if (!(reason || '').trim()) return bad('กรุณาระบุเหตุผล')
  return callRpc('line_task_cancel', { p_task_id: taskId, p_reason: reason.trim() })
}
