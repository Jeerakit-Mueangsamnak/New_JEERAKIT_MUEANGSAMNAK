'use server'

import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { assertValidMessages, LineMessageError } from '@/lib/line/messages'
import { driverTaskMessages, taskMessages, textMessage, withTemplateCards } from '@/lib/line/templates'
import { liffUrl } from '@/lib/line/liff-links'
import { type LineMessage } from '@/lib/line/types'
import { processOutbox } from '@/lib/line/outbox'
import { lineOaAddFriendUrl, lineOaMessageUrl } from '@/lib/line/oa-link'
import { createLineProvider, lineDeliveryMode } from '@/lib/line/provider'
import { formatThaiDate, reminderMessages, teamReminderMessages, type CronShop, type ReminderRow } from '@/lib/line/cron'
import { type LineInviteKind } from '@/lib/line/config'
import { billDesignMessage, cardMessage, type FlexButton } from '@/lib/line/flex'
import { isLineCardColor, LINE_CARD_COLORS, LINE_CARD_LIMITS } from '@/lib/line/bill-card-design'
import { SHOP_LINE_CARDS_COLUMN, SHOP_LINE_ID_COLUMN, SHOP_LINE_TEMPLATES_COLUMN } from '@/lib/line/policy'
import { pngSize, richMenuBody, richMenuItems, richMenuLabel, richMenuSize, RICH_MENU_KINDS, validateRichMenuImage, type RichMenuKind } from '@/lib/line/rich-menu'

/** store_settings read through SHOP_LINE_ID_COLUMN / SHOP_LINE_TEMPLATES_COLUMN (not the whole policies). */
type ShopLineId = { line_id?: string | null }
type ShopLineTemplates = { templates?: Record<string, string> | null }

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
  [/^LINE_CONTACT_SUSPENDED/, 'LINE นี้ถูกระงับการใช้งานประเภทนี้ ให้เจ้าของตรวจสอบการระงับก่อน'],
  [/^LINE_RESTRICTION_INVALID/, 'กรุณาเลือกประเภท ระบุเหตุผล และเวลาสิ้นสุดที่ถูกต้อง'],
  [/^LINE_CONTACT_NOT_LINKED/, 'ผู้รับยังไม่ได้ผูก LINE'],
  [/^LINE_CONTACT_UNREACHABLE/, 'ส่งไม่ถึงผู้รับ อาจบล็อกหรือลบ LINE ร้านแล้ว'],
  [/^LINE_CONTACT_NEEDS_REVIEW/, 'การผูก LINE ของลูกค้ายังรอร้านตรวจ กดยืนยันก่อนจึงจะส่งได้'],
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
  [/^LINE_MEMBER_ALREADY_LINKED/, 'พนักงานคนนี้ผูก LINE แล้ว'],
  [/^LINE_REMINDER_NOT_DUE/, 'รายการนี้ไม่อยู่ในรายการที่ต้องเตือนแล้ว กรุณารีเฟรช'],
  [/^LINE_DELIVERY_NOT_RETRYABLE/, 'ส่งใหม่ไม่ได้: รายการนี้ส่งแล้ว กำลังส่ง หรือผู้รับยกเลิก/บล็อก LINE ร้าน'],
  [/^INVALID_KIND/, 'คำขอไม่สมบูรณ์ กรุณาลองใหม่'],
  [/^LINE_CONTACT_NOT_PENDING/, 'รายชื่อนี้ไม่ได้รอร้านตรวจแล้ว กรุณารีเฟรช'],
  [/^LINE_CONTACT_UNKNOWN/, 'ไม่พบรายชื่อนี้ใน LINE ร้าน'],
  [/^LINE_REGISTER_NO_OWNER/, 'ยังไม่มีบัญชีเจ้าของร้านที่ใช้งานอยู่ จึงสร้างลูกค้าไม่ได้'],
  [/^LINE_REGISTER_INVALID/, 'ใส่ชื่อและเบอร์โทร 10 หลัก (ขึ้นต้นด้วย 0) ให้ครบ'],
  [/^LINE_CUSTOMER_PHONE_EXISTS/, 'เบอร์นี้มีในลูกค้าเดิมแล้ว ให้เลือก "เชื่อมกับลูกค้าเดิม" แทนการสร้างใหม่'],
  [/^LINE_NOTE_REQUIRED/, 'กรุณาพิมพ์ข้อความที่ต้องการให้ผู้ลงทะเบียนตอบ'],
  [/^LINE_VIEW_INVALID/, 'คำขอไม่สมบูรณ์ กรุณาลองใหม่'],
  [/^LINE_CODE_NOT_OPEN/, 'รหัสนี้ใช้ไปแล้ว หมดอายุ หรือยกเลิกไปแล้ว'],
  [/^LINE_CATALOG_INVALID/, 'คำขอไม่สมบูรณ์ กรุณาลองใหม่'],
  [/^LINE_CATALOG_NOT_FOUND/, 'ไม่พบหมวดหมู่หรือสินค้านี้ (สินค้าที่ไม่มีหมวดหมู่แสดงใน LINE ไม่ได้)'],
  [/^LINE_SLIP_NOT_FOUND/, 'ไม่พบสลิปนี้'],
  [/^LINE_SLIP_NOT_PENDING/, 'สลิปนี้ตรวจไปแล้ว กรุณารีเฟรช'],
  [/^OVERPAYMENT/, 'ยอดที่อนุมัติมากกว่ายอดค้างของบิล'],
  [/^BILL_NOT_PAYABLE/, 'บิลนี้ปิดหรือยกเลิกแล้ว รับชำระไม่ได้'],
  [/^PAYMENT_DATE_IN_FUTURE/, 'วันที่รับเงินต้องไม่เกินวันนี้'],
  [/^INVALID_AMOUNT/, 'จำนวนเงินไม่ถูกต้อง'],
  [/^LINE_TASK_STATUS_INVALID/, 'สถานะไม่ถูกต้อง (หมายเหตุไม่เกิน 500 ตัวอักษร)'],
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
  const { data: shop } = await supabase.from('store_settings').select(SHOP_LINE_ID_COLUMN).eq('singleton', true).maybeSingle()
  const lineId = (shop as ShopLineId | null)?.line_id ?? undefined
  return {
    success: true,
    data: { code: r.data.code, expires_at: r.data.expires_at, oaUrl: lineOaMessageUrl(lineId, r.data.code) },
  } as LineActionResult<{ code: string; expires_at: string; oaUrl: string | null }>
}

export async function unlinkLineContact(contactId: string, reason?: string) {
  if (!UUID.test(contactId || '')) return bad('ไม่พบรายการ LINE นี้')
  return callRpc('line_contact_unlink', { p_contact_id: contactId, p_reason: reason?.trim() || 'เจ้าของร้านยกเลิกการผูก LINE' })
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
  /** The linked LINE (for the shop's check). */
  contact_id?: string | null
  /** A customer's link waits for the shop to check it (owner 2026-11-11): no bill is sent until then. */
  needs_review?: boolean
  typed_name?: string | null
  typed_phone?: string | null
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
  /** Flex Card (owner 2026-11-05): a title and label/value rows from the stored bill; the text goes under the title. */
  card?: { title: string; rows: Array<{ label: string; value: string }>; style?: BillCardStyle }
}): Promise<LineActionResult<{ delivery_id: string; status: string; duplicate: boolean; mode: 'mock' | 'live' }>> {
  if (!input || !UUID.test(input.billId || '')) return bad('ไม่พบบิลนี้')
  if (!KEY.test(input.idempotencyKey || '')) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  const text = (input.text ?? '').trim()
  const buttons = input.card ? await payButtons(input.billId) : []
  let messages: LineMessage[]
  try {
    messages = input.card ? [billCard(input.card, text, buttons)] : [{ type: 'text', text }]
    assertValidMessages(messages)
  } catch {
    return bad('ข้อความไม่ถูกต้องหรือยาวเกินกำหนด')
  }
  const queued = input.card
    ? await callRpc<{ delivery_id: string; status: string; duplicate: boolean }>('line_bill_send_card', {
        p_bill_id: input.billId,
        p_messages: messages,
        p_idempotency_key: input.idempotencyKey,
      })
    : await callRpc<{ delivery_id: string; status: string; duplicate: boolean }>('line_bill_send', {
        p_bill_id: input.billId,
        p_text: text,
        p_idempotency_key: input.idempotencyKey,
      })
  if (!queued.success || !queued.data) return { success: false, error: queued.error }
  const status = await runOutboxOnce({ id: queued.data.delivery_id })
  return { success: true, data: { ...queued.data, status: status ?? queued.data.status, mode: lineDeliveryMode() } }
}

/** Look of a card the shop designed in Settings › LINE (การ์ดบิล LINE, owner 2026-11-12). */
type BillCardStyle = { color: string; badge?: string; footer?: string }

/**
 * ชำระเงิน / แนบสลิป (owner 2026-11-25): two buttons to this bill's own pay form, only while money is owed and the
 * LIFF form is set up. The database accepts no other action in a bill card.
 */
async function payButtons(billId: string): Promise<FlexButton[]> {
  const pay = liffUrl('pay', { bill: billId })
  const slip = liffUrl('pay', { bill: billId, tab: 'slip' })
  if (!pay || !slip) return []
  const supabase = await createServerSupabase()
  const { data } = await supabase.from('bills').select('status, balance_due').eq('id', billId).maybeSingle()
  if (!data || !['CONFIRMED', 'ACTIVE'].includes(data.status as string) || !(Number(data.balance_due) > 0)) return []
  return [
    { label: 'ชำระเงิน / ดู QR', uri: pay, primary: true },
    { label: 'แนบสลิป', uri: slip },
  ]
}

/** The bill as a Flex Card; the only buttons are the server's pay buttons. */
function billCard(card: { title: string; rows: Array<{ label: string; value: string }>; style?: BillCardStyle }, text: string, buttons: FlexButton[] = []) {
  const title = typeof card?.title === 'string' ? card.title.trim() : ''
  const rows = Array.isArray(card?.rows) ? card.rows : []
  if (!title || rows.length > 10) throw new LineMessageError('LINE_MESSAGE_SHAPE')
  const clean = rows.map((r) => {
    if (!r || typeof r.label !== 'string' || typeof r.value !== 'string') throw new LineMessageError('LINE_MESSAGE_SHAPE')
    return { label: r.label.trim().slice(0, 40), value: r.value.trim().slice(0, 200) }
  })
  if (card.style) {
    const { color, badge, footer } = card.style
    // only the shop's own colours; texts as the card limits allow
    if (!isLineCardColor(color) || (badge !== undefined && typeof badge !== 'string') || (footer !== undefined && typeof footer !== 'string')) {
      throw new LineMessageError('LINE_MESSAGE_SHAPE')
    }
    return billDesignMessage({
      altText: title,
      title: title.slice(0, LINE_CARD_LIMITS.title),
      badge: (badge ?? '').trim().slice(0, LINE_CARD_LIMITS.badge),
      color: LINE_CARD_COLORS[color].hex,
      text: text || undefined,
      rows: clean,
      footer: (footer ?? '').trim().slice(0, LINE_CARD_LIMITS.footer),
      buttons,
    })
  }
  return cardMessage({ altText: title, title, text: text || undefined, rows: clean, buttons })
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
    supabase.from('store_settings').select(SHOP_LINE_TEMPLATES_COLUMN).eq('singleton', true).maybeSingle(),
  ])
  // The text the OWNER saved in Settings › LINE (TASK_NEW) is the one sent
  const templates = (shop as ShopLineTemplates | null)?.templates ?? undefined
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
  const { data: shop } = await supabase.from('store_settings').select(SHOP_LINE_ID_COLUMN).eq('singleton', true).maybeSingle()
  const lineId = (shop as ShopLineId | null)?.line_id ?? undefined
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
  const [{ data: me }, { data: shop }, { data: apt }] = await Promise.all([
    supabase.from('profiles').select('display_name, username').eq('id', auth.user.id).maybeSingle(),
    supabase.from('store_settings').select(SHOP_LINE_TEMPLATES_COLUMN).eq('singleton', true).maybeSingle(),
    supabase
      .from('appointments')
      .select('start_datetime, location, contact_name, contact_phone, description, customer:customers(name, phone, address)')
      .eq('id', input.appointmentId)
      .maybeSingle(),
  ])
  const templates = (shop as ShopLineTemplates | null)?.templates ?? undefined
  const customer = (Array.isArray(apt?.customer) ? apt?.customer[0] : apt?.customer) as
    | { name?: string; phone?: string; address?: string }
    | null
    | undefined
  const taskId = crypto.randomUUID()
  // The job card shows what the driver needs from the appointment (empty values are left out).
  const details = apt
    ? {
        when: apt.start_datetime ? formatThaiDate(apt.start_datetime as string, true) : '',
        customer: (apt.contact_name as string | null) || customer?.name || '',
        phone: (apt.contact_phone as string | null) || customer?.phone || null,
        place: (apt.location as string | null) || customer?.address || null,
        detail: input.detail?.trim() || (apt.description as string | null) || null,
        formUrl: liffUrl('job', { task: taskId }),
      }
    : undefined
  let messages: LineMessage[]
  try {
    messages = driverTaskMessages(taskId, { ผู้สั่ง: me?.display_name || me?.username || 'ร้าน', เรื่อง: title }, templates, details)
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
  const { data: shop } = await supabase.from('store_settings').select(SHOP_LINE_TEMPLATES_COLUMN).eq('singleton', true).maybeSingle()
  const templates = (shop as ShopLineTemplates | null)?.templates ?? undefined
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

export async function cancelLineTask(taskId: string, reason?: string) {
  if (!UUID.test(taskId || '')) return bad('ไม่พบงานนี้')
  return callRpc('line_task_cancel', { p_task_id: taskId, p_reason: reason?.trim() || null })
}

// ── Invite link (LIFF) ───────────────────────────────────────────────────────

export interface LineInviteResult {
  code: string
  expires_at: string
  /** LIFF link to send to the person's own LINE (null until NEXT_PUBLIC_LIFF_ID is set). */
  url: string | null
  /** LINE "share" link that opens a chat picker with the invite text typed in. */
  shareUrl: string | null
  /** Fallback: the shop OA chat with the code typed in (works without LIFF). */
  oaUrl: string | null
}

/**
 * Invite link for one staff member (OWNER), driver (OWNER) or customer (members who serve
 * customers). Single use; the database keeps only the hash and revokes an older open link.
 */
export async function createLineInviteLink(kind: LineInviteKind, target: string): Promise<LineActionResult<LineInviteResult>> {
  if (!['STAFF', 'DRIVER', 'CUSTOMER'].includes(kind)) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  if (kind === 'DRIVER' ? !DRIVER_CODE.test(target || '') : !UUID.test(target || '')) return bad('ไม่พบรายชื่อนี้')
  const r = await callRpc<{ code: string; expires_at: string }>('line_invite_create', { p_kind: kind, p_target: target })
  if (!r.success || !r.data) return r as LineActionResult<never>
  const supabase = await createServerSupabase()
  const { data: shop } = await supabase.from('store_settings').select(`company_name, ${SHOP_LINE_ID_COLUMN}`).eq('singleton', true).maybeSingle()
  const lineId = (shop as ShopLineId | null)?.line_id ?? undefined
  const url = liffUrl('bind', { t: r.data.code, k: kind })
  const shopName = (shop?.company_name as string | null)?.trim() || 'ร้าน'
  const shareText = url ? `${shopName}: กดลิงก์นี้เพื่อยืนยันตัวตนและผูก LINE (ใช้ได้ครั้งเดียว)\n${url}` : null
  return {
    success: true,
    data: {
      code: r.data.code,
      expires_at: r.data.expires_at,
      url,
      shareUrl: shareText ? `https://line.me/R/share?text=${encodeURIComponent(shareText)}` : null,
      oaUrl: lineOaMessageUrl(lineId, r.data.code),
    },
  }
}

/** The OWNER / LINE menu checked a flagged link (typed name / phone did not match). */
export async function confirmLineContactReview(contactId: string) {
  if (!UUID.test(contactId || '')) return bad('ไม่พบรายชื่อนี้')
  return callRpc<{ contact_id: string }>('line_contact_review_ok', { p_contact_id: contactId })
}

// ── Customer reminders by hand + delivery retry (Settings › LINE) ─────────────

export type ReminderCandidate = Omit<ReminderRow, 'contact_id' | 'dedupe_key'> & { last_queued_at: string | null; last_status: string | null }

export async function getReminderCandidates() {
  return callRpc<ReminderCandidate[]>('line_customer_reminder_candidates', {})
}

async function cronShop(): Promise<CronShop> {
  const supabase = await createServerSupabase()
  const { data: row } = await supabase
    .from('store_settings')
    .select(`company_name, phone, ${SHOP_LINE_ID_COLUMN}, ${SHOP_LINE_TEMPLATES_COLUMN}, ${SHOP_LINE_CARDS_COLUMN}`)
    .eq('singleton', true)
    .maybeSingle()
  const data = row as ({ company_name?: string | null; phone?: string | null } & ShopLineId & ShopLineTemplates & { cards?: unknown }) | null
  return {
    shopName: data?.company_name?.trim() || 'ร้าน',
    templates: withTemplateCards(data?.templates, data?.cards),
    lineId: data?.line_id?.trim() || null,
    phone: (data?.phone as string | null)?.trim() || null,
  }
}

/**
 * ส่งเตือนเอง: renders the reminder of one current candidate (same text as the schedule) and
 * queues it for that bill's / appointment's own customer, then runs the outbox once.
 */
export async function sendCustomerReminder(input: {
  rule: string
  sourceId: string
  idempotencyKey: string
}): Promise<LineActionResult<{ delivery_id: string; duplicate: boolean; status: string | null; mode: 'mock' | 'live' }>> {
  if (!input || !UUID.test(input.sourceId || '')) return bad('ไม่พบรายการนี้')
  if (!KEY.test(input.idempotencyKey || '')) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  const list = await getReminderCandidates()
  if (!list.success || !list.data) return { success: false, error: list.error }
  const row = list.data.find((c) => c.rule === input.rule && c.source_id === input.sourceId)
  if (!row) return bad('รายการนี้ไม่อยู่ในรายการที่ต้องเตือนแล้ว กรุณารีเฟรช')
  let built: { templateKey: string; messages: LineMessage[] }
  try {
    built = reminderMessages(row, await cronShop())
  } catch {
    return bad('ข้อความไม่ถูกต้องหรือยาวเกินกำหนด')
  }
  const queued = await callRpc<{ delivery_id: string; duplicate: boolean }>('line_customer_reminder_send', {
    p_rule: input.rule,
    p_source_id: input.sourceId,
    p_template_key: built.templateKey,
    p_messages: built.messages,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!queued.success || !queued.data) return { success: false, error: queued.error }
  const status = await runOutboxOnce({ id: queued.data.delivery_id })
  return { success: true, data: { ...queued.data, status, mode: lineDeliveryMode() } }
}

export type TeamReminderCandidate = Omit<ReminderCandidate, 'last_status'> & { staff_count: number }

/** ส่งเตือนพนักงานเอง (OWNER, owner 2026-11-26): what is due, with the last time it was sent to staff. */
export async function getTeamReminderCandidates() {
  return callRpc<TeamReminderCandidate[]>('line_team_reminder_candidates', {})
}

/** ส่งเตือนพนักงานเอง: the staff notice of one due item to every linked staff member, then the outbox once. */
export async function sendTeamReminder(input: { rule: string; sourceId: string }): Promise<LineActionResult<{ queued: number; mode: 'mock' | 'live' }>> {
  if (!input || !UUID.test(input.sourceId || '')) return bad('ไม่พบรายการนี้')
  const list = await getTeamReminderCandidates()
  if (!list.success || !list.data) return { success: false, error: list.error }
  const row = list.data.find((c) => c.rule === input.rule && c.source_id === input.sourceId)
  if (!row) return bad('รายการนี้ไม่อยู่ในรายการที่ต้องเตือนแล้ว กรุณารีเฟรช')
  let messages: LineMessage[]
  try {
    messages = teamReminderMessages(row, await cronShop())
  } catch {
    return bad('ข้อความไม่ถูกต้องหรือยาวเกินกำหนด')
  }
  const queued = await callRpc<{ queued: number }>('line_team_reminder_send', {
    p_rule: row.rule,
    p_source_type: row.source_type,
    p_source_id: row.source_id,
    p_messages: messages,
  })
  if (!queued.success || !queued.data) return { success: false, error: queued.error }
  if (queued.data.queued > 0) await runOutboxOnce(null)
  return { success: true, data: { queued: queued.data.queued, mode: lineDeliveryMode() } }
}

/** ประวัติการส่ง: send a failed / cancelled row again (same retry key, so LINE delivers it once). */
export async function retryLineDelivery(deliveryId: string): Promise<LineActionResult<{ delivery_id: string; status: string; mode: 'mock' | 'live' }>> {
  if (!UUID.test(deliveryId || '')) return bad('ไม่พบรายการนี้')
  const r = await callRpc<{ delivery_id: string; status: string }>('line_delivery_retry', { p_delivery_id: deliveryId })
  if (!r.success) return { success: false, error: r.error }
  const status = await runOutboxOnce({ id: deliveryId })
  return { success: true, data: { delivery_id: deliveryId, status: status ?? 'PENDING', mode: lineDeliveryMode() } }
}

// ── คนใน LINE: pending friends (self-registration) ────────────────────────────

export type ShopRegisterResult =
  | { result: 'LINKED_CUSTOMER'; name?: string; customer_id?: string; created?: boolean }
  | { result: 'PHONE_TAKEN'; customer_id?: string }
  | { result: 'DUPLICATE' | 'INVALID' | 'ALREADY_LINKED' }

/**
 * "ร้านกรอกให้": the shop types name + phone for a friend still waiting. The database applies the
 * same rule as the chat (new phone = new customer, a known phone without LINE = that customer,
 * never replaces another LINE). Nothing is sent to LINE.
 */
export async function registerLineContactByShop(contactId: string, name: string, phone: string) {
  if (!UUID.test(contactId || '')) return bad('ไม่พบรายชื่อนี้')
  const n = (name ?? '').trim()
  const p = (phone ?? '').replace(/\D/g, '')
  if (!n || n.length > 200) return bad('กรุณาใส่ชื่อ-นามสกุล')
  if (!/^0\d{9}$/.test(p)) return bad('เบอร์โทรต้องเป็น 10 หลัก ขึ้นต้นด้วย 0')
  return callRpc<ShopRegisterResult>('line_contact_register_by_shop', { p_contact_id: contactId, p_name: n, p_phone: p })
}

/** "ไม่รับ": leaves the list; that LINE stays a friend of the shop but is linked to no one. The person is told unless the owner switched that off. */
export async function rejectLineContact(contactId: string, reason?: string) {
  if (!UUID.test(contactId || '')) return bad('ไม่พบรายชื่อนี้')
  const r = await callRpc<{ contact_id: string; notify?: boolean }>('line_contact_reject', { p_contact_id: contactId, p_reason: reason?.trim() || null })
  if (r.success && r.data?.notify) await pushRegisterAnswer(contactId, 'REGISTER_REJECTED', {})
  return r
}

// ── คนใน LINE: lists, checking a request, a word to one person (owner 2026-11-21) ──

export type LinePeopleView = 'ALL' | 'UNREG' | 'PENDING' | 'NEEDINFO' | 'CUSTOMERS' | 'STAFF' | 'DRIVERS' | 'GENERAL' | 'REJECTED' | 'UNLINKED' | 'BLOCKED'
const PEOPLE_VIEWS: readonly string[] = ['ALL', 'UNREG', 'PENDING', 'NEEDINFO', 'CUSTOMERS', 'STAFF', 'DRIVERS', 'GENERAL', 'REJECTED', 'UNLINKED', 'BLOCKED']
export type LinePeopleCounts = Record<'all' | 'unreg' | 'pending' | 'needinfo' | 'customers' | 'staff' | 'drivers' | 'general' | 'rejected' | 'unlinked' | 'blocked', number>

/** One person as a screen sees them. line_user_id is never part of it. */
export interface LinePerson {
  id: string
  display_name: string | null
  picture_url: string | null
  status: 'UNLINKED' | 'LINKED'
  followed: boolean
  followed_at: string | null
  created_at: string
  last_event_at: string | null
  register_status: string | null
  register_note: string | null
  register_payload: { match?: 'NONE' | 'ONE' | 'TAKEN' | 'MANY'; channel?: string; address?: Record<string, string>; submitted_at?: string; consent_at?: string } | null
  register_customer_id: string | null
  typed_name: string | null
  typed_phone: string | null
  needs_review: boolean
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  profile_id: string | null
  profile_name: string | null
  driver_code: string | null
  linked_at: string | null
  unlinked_at: string | null
  unlink_reason: string | null
  restriction_count?: number
  self_registered: boolean
}

/** All counts in one small answer (no list is downloaded to count it). */
export async function getLinePeopleCounts() {
  return callRpc<LinePeopleCounts>('line_people_counts', {})
}

/** One page (25) of a list, searched by the database. */
export async function listLinePeople(view: LinePeopleView, search: string, offset: number) {
  if (!PEOPLE_VIEWS.includes(view)) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  return callRpc<{ total: number; rows: LinePerson[] }>('line_people_list', {
    p_view: view,
    p_search: (search ?? '').trim().slice(0, 100) || null,
    p_limit: 25,
    p_offset: Math.max(0, Math.floor(Number(offset) || 0)),
  })
}

/**
 * The answer to a request, to that friend's own chat. Text only, from the owner's templates; a failed push
 * never undoes the shop's decision (the row waits in the outbox and the history shows what happened).
 */
async function pushRegisterAnswer(contactId: string, templateKey: 'REGISTER_APPROVED' | 'REGISTER_REJECTED' | 'REGISTER_NEED_INFO', vars: Record<string, string>): Promise<void> {
  try {
    const shop = await cronShop()
    const messages = [textMessage(templateKey, { ...vars, ชื่อร้าน: shop.shopName, เบอร์โทรร้าน: shop.phone || '-' }, shop.templates)]
    const { createSupabaseLineStore } = await import('@/lib/line/supabase-store')
    await createSupabaseLineStore().enqueueRegister({ contactId, templateKey, messages, dedupeKey: `${templateKey}:${contactId}:${Date.now()}` })
    await runOutboxOnce(null)
  } catch {
    // the decision stands; the shop can write to the person from ติดต่อผ่าน LINE
  }
}

/** "ขอข้อมูลเพิ่ม": the request stays open and the person is told what the shop needs. */
export async function needInfoLineRegister(contactId: string, note: string) {
  if (!UUID.test(contactId || '')) return bad('ไม่พบรายชื่อนี้')
  const text = (note ?? '').trim().slice(0, 500)
  if (!text) return bad('กรุณาพิมพ์ข้อความที่ต้องการให้ผู้ลงทะเบียนตอบ')
  const r = await callRpc<{ contact_id: string; notify?: boolean }>('line_contact_register_need_info', { p_contact_id: contactId, p_note: text })
  if (r.success && r.data?.notify) await pushRegisterAnswer(contactId, 'REGISTER_NEED_INFO', { ข้อความจากร้าน: text })
  return r
}

export interface ApproveLineRegisterInput {
  contactId: string
  /** An existing customer the shop is sure about; leave out to make a new customer from the request */
  customerId?: string
  name?: string
  phone?: string
  address?: Record<string, string>
}

/** "อนุมัติ": links the request to a customer (new or existing) and tells the person (switch: policies.line.register.notifyApproved). */
export async function approveLineRegister(input: ApproveLineRegisterInput) {
  if (!input || !UUID.test(input.contactId || '')) return bad('ไม่พบรายชื่อนี้')
  if (input.customerId !== undefined && !UUID.test(input.customerId)) return bad('ไม่พบลูกค้ารายนี้')
  const phone = input.phone ? input.phone.replace(/\D/g, '') : undefined
  if (!input.customerId && phone !== undefined && phone !== '' && !/^0\d{9}$/.test(phone)) return bad('เบอร์โทรต้องเป็น 10 หลัก ขึ้นต้นด้วย 0')
  const address = input.address
    ? Object.fromEntries(
        Object.entries(input.address)
          .filter(([k, v]) => ['address', 'subdistrict', 'district', 'province', 'postcode'].includes(k) && typeof v === 'string')
          .map(([k, v]) => [k, v.trim().slice(0, 300)]),
      )
    : null
  const r = await callRpc<{ result: 'LINKED_CUSTOMER'; contact_id: string; customer_id: string; created: boolean; name: string; notify?: boolean }>('line_contact_register_approve', {
    p_contact_id: input.contactId,
    p_customer_id: input.customerId ?? null,
    p_name: input.customerId ? null : input.name?.trim() || null,
    p_phone: input.customerId ? null : phone || null,
    p_address: input.customerId ? null : address,
  })
  if (r.success && r.data?.notify) await pushRegisterAnswer(input.contactId, 'REGISTER_APPROVED', { ชื่อ: r.data.name || '-' })
  return r
}

/** "ติดต่อผ่าน LINE": a plain text from the shop to one friend (not to someone who blocked the OA). */
export async function sendLineContactMessage(
  contactId: string,
  text: string,
  idempotencyKey: string,
): Promise<LineActionResult<{ delivery_id: string | null; duplicate: boolean; status: string | null; mode: 'mock' | 'live' }>> {
  if (!UUID.test(contactId || '')) return bad('ไม่พบรายชื่อนี้')
  if (!KEY.test(idempotencyKey || '')) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  const body = (text ?? '').trim()
  if (!body || body.length > 1000) return bad('ข้อความต้องไม่ว่างและยาวไม่เกิน 1,000 ตัวอักษร')
  const queued = await callRpc<{ delivery_id: string | null; duplicate: boolean }>('line_contact_message_send', {
    p_contact_id: contactId,
    p_text: body,
    p_idempotency_key: idempotencyKey,
  })
  if (!queued.success || !queued.data) return { success: false, error: queued.error }
  const status = queued.data.delivery_id ? await runOutboxOnce({ id: queued.data.delivery_id }) : null
  return { success: true, data: { ...queued.data, status, mode: lineDeliveryMode() } }
}

export interface LineCodeRow {
  id: string
  purpose: string
  driver_code: string | null
  target: string | null
  created_at: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
  state: 'OPEN' | 'USED' | 'REVOKED' | 'EXPIRED'
  created_by: string | null
}

/** จัดการรหัสเชิญ (owner): the codes without their secret. */
export async function listLineCodes() {
  return callRpc<LineCodeRow[]>('line_codes_list', { p_limit: 50 })
}

export async function revokeLineCode(codeId: string) {
  if (!UUID.test(codeId || '')) return bad('ไม่พบรหัสนี้')
  return callRpc<{ code_id: string; revoked: boolean }>('line_link_code_revoke', { p_code_id: codeId })
}

export interface LineAuditRow {
  id: string
  created_at: string
  action: string
  entity_type: string
  entity_id: string | null
  result: string
  reason: string | null
  actor: string
  detail: string
}

/** ประวัติการตรวจสอบ (owner): the LINE audit trail, newest first; one person's history when `entityId` is given. */
export async function listLineAudit(offset: number, entityId?: string) {
  if (entityId !== undefined && !UUID.test(entityId)) return bad('ไม่พบรายชื่อนี้')
  return callRpc<LineAuditRow[]>('line_audit_list', { p_limit: 50, p_offset: Math.max(0, Math.floor(Number(offset) || 0)), p_entity: entityId ?? null })
}

/** The shop OA's LINE ID (Settings › กิจการ) and its add-friend link, for the QR on คนใน LINE. */
export async function getLineOaInfo(): Promise<LineActionResult<{ lineId: string | null; addFriendUrl: string | null }>> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('store_settings').select(SHOP_LINE_ID_COLUMN).eq('singleton', true).maybeSingle()
  if (error) return bad('โหลดข้อมูลร้านไม่สำเร็จ')
  const lineId = (data as ShopLineId | null)?.line_id?.trim() || null
  return { success: true, data: { lineId, addFriendUrl: lineOaAddFriendUrl(lineId) } }
}

// ── รายการสินค้าใน LINE (owner 2026-11-21): the OWNER ticks what a person who added the OA may see ──

export interface LineCatalogProduct {
  id: string
  name: string
  active: boolean
  line_listed: boolean
  can_sell: boolean
  can_rent: boolean
  sale_price: number | null
  rental_price: number | null
  unit: string | null
}
export interface LineCatalogCategory {
  id: string
  name: string
  active: boolean
  line_listed: boolean
  line_order: number
  products: LineCatalogProduct[]
}

/** Every category with its products and what is ticked (the owner sees the prices already; no cost is sent). */
export async function getLineCatalogAdmin() {
  return callRpc<{ show_price: boolean; categories: LineCatalogCategory[] }>('line_catalog_admin', {})
}

/** Tick / untick one category (with its place in the list), one product, or every product of a category. */
export async function setLineCatalog(kind: 'CATEGORY' | 'PRODUCT' | 'CATEGORY_PRODUCTS', id: string, listed: boolean, order?: number) {
  if (!['CATEGORY', 'PRODUCT', 'CATEGORY_PRODUCTS'].includes(kind) || !UUID.test(id || '')) return bad('ไม่พบหมวดหมู่หรือสินค้านี้')
  if (order !== undefined && (!Number.isInteger(order) || order < 0 || order > 9999)) return bad('ลำดับต้องเป็นเลข 0–9999')
  return callRpc<{ kind: string; id: string; listed: boolean; rows: number }>('line_catalog_set', { p_kind: kind, p_id: id, p_listed: listed, p_order: order ?? null })
}

// ── เมนู LINE: the chat menus (owner 2026-11-21) ──────────────────────────────

export interface RichMenuInfo {
  kind: RichMenuKind
  label: string
  /** Followers who should have this menu / who LINE was told to show it to */
  people: number
  on_menu: number
  published_at: string | null
  items: string[]
  /** The picture in /public, for the preview */
  image: string
}

/** The four menus as the owner sees them. Nothing is published by looking. */
export async function getRichMenuStatus(): Promise<LineActionResult<{ mode: 'mock' | 'live'; menus: RichMenuInfo[] }>> {
  const r = await callRpc<Array<{ kind: RichMenuKind; published_at: string | null; people: number; on_menu: number }>>('line_rich_menu_status', {})
  if (!r.success || !r.data) return { success: false, error: r.error }
  const ctx = { phone: null, registerUrl: liffUrl('register') }
  return {
    success: true,
    data: {
      mode: lineDeliveryMode(),
      menus: RICH_MENU_KINDS.map((kind) => {
        const row = r.data?.find((x) => x.kind === kind)
        return {
          kind,
          label: richMenuLabel(kind),
          people: Number(row?.people ?? 0),
          on_menu: Number(row?.on_menu ?? 0),
          published_at: row?.published_at ?? null,
          items: richMenuItems(kind, ctx).map((i) => i.label),
          image: `/line/rich-menu/${kind}.png`,
        }
      }),
    },
  }
}

const MENU_MOCK = 'เซิร์ฟเวอร์ยังอยู่ในโหมดทดลอง ยังเผยแพร่หรือยกเลิกเมนูจริงไม่ได้ (ต้องตั้งเป็นโหมดส่งจริงก่อน)'

/** Everything a publish / un-publish needs before it touches LINE; the OWNER check is the database's (line_rich_menu_status). */
async function menuSetup(kind: RichMenuKind) {
  if (!RICH_MENU_KINDS.includes(kind)) return { error: 'คำขอไม่สมบูรณ์ กรุณาลองใหม่' } as const
  const guard = await callRpc('line_rich_menu_status', {})
  if (!guard.success) return { error: guard.error } as const
  if (lineDeliveryMode() !== 'live') return { error: MENU_MOCK } as const
  const { createSupabaseLineStore } = await import('@/lib/line/supabase-store')
  const store = createSupabaseLineStore()
  const { accessToken } = await store.credentials()
  if (!accessToken) return { error: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ LINE' } as const
  const supabase = await createServerSupabase()
  const { data: auth } = await supabase.auth.getUser()
  return { store, provider: createLineProvider(accessToken), actor: auth.user?.id ?? null } as const
}

/**
 * "เผยแพร่เมนู": creates the menu at LINE from the picture in /public, uploads it, makes GENERAL LINE's default menu,
 * and keeps the id the database needs. Real LINE only (never in the trial mode); a step that fails undoes the menu it made.
 */
export async function publishRichMenu(kind: RichMenuKind): Promise<LineActionResult<{ kind: RichMenuKind }>> {
  const setup = await menuSetup(kind)
  if ('error' in setup) return bad(setup.error ?? 'ทำรายการไม่สำเร็จ')
  const { store, provider, actor } = setup
  const { createRichMenu, uploadRichMenuImage, setDefaultRichMenu } = provider
  if (!createRichMenu || !uploadRichMenuImage || !setDefaultRichMenu) return bad(MENU_MOCK)

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')
  if (!/^https:\/\//.test(site)) return bad('ยังไม่ได้ตั้งที่อยู่เว็บ (NEXT_PUBLIC_SITE_URL) จึงอ่านรูปเมนูไม่ได้')
  let bytes: Uint8Array
  try {
    const res = await fetch(`${site}/line/rich-menu/${kind}.png`, { cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch {
    return bad('อ่านรูปเมนูไม่สำเร็จ กรุณาลองใหม่')
  }
  const size = pngSize(bytes)
  const refused = size ? validateRichMenuImage({ ...size, bytes: bytes.byteLength, type: 'image/png' }) : 'รูปเมนูไม่ใช่ไฟล์ PNG'
  if (refused) return bad(refused)
  const want = richMenuSize(kind)
  if (size && (size.width !== want.width || size.height !== want.height)) return bad('ขนาดรูปไม่ตรงกับช่องปุ่มของเมนู ให้สร้างรูปใหม่')

  const shop = await cronShop()
  const created = await createRichMenu.call(provider, richMenuBody(kind, { phone: shop.phone, registerUrl: liffUrl('register') }))
  if (!created.ok || !created.richMenuId) return bad('LINE ไม่รับเมนูนี้ กรุณาตรวจการเชื่อมต่อ LINE แล้วลองใหม่')
  const id = created.richMenuId
  const undo = async () => {
    await provider.deleteRichMenu?.(id).catch(() => undefined)
  }
  const up = await uploadRichMenuImage.call(provider, id, bytes, 'image/png')
  if (!up.ok) {
    await undo()
    return bad('LINE ไม่รับรูปเมนู กรุณาลองใหม่')
  }
  if (kind === 'GENERAL') {
    const def = await setDefaultRichMenu.call(provider, id)
    if (!def.ok) {
      await undo()
      return bad('ตั้งเมนูนี้เป็นเมนูเริ่มต้นไม่สำเร็จ กรุณาลองใหม่')
    }
  }
  let old: string | null
  try {
    old = await store.richMenuSave(kind, id, actor)
  } catch {
    await undo()
    return bad('บันทึกเมนูไม่สำเร็จ กรุณาลองใหม่')
  }
  if (old && old !== id) await provider.deleteRichMenu?.(old).catch(() => undefined)
  return { success: true, data: { kind } }
}

/** "ยกเลิกเผยแพร่": the menu is deleted at LINE and forgotten here; the people it was shown to fall back to the default. */
export async function unpublishRichMenu(kind: RichMenuKind): Promise<LineActionResult<{ kind: RichMenuKind }>> {
  const setup = await menuSetup(kind)
  if ('error' in setup) return bad(setup.error ?? 'ทำรายการไม่สำเร็จ')
  const { store, provider, actor } = setup
  let old: string | null
  try {
    old = await store.richMenuClear(kind, actor)
  } catch {
    return bad('ยกเลิกเมนูไม่สำเร็จ กรุณาลองใหม่')
  }
  if (kind === 'GENERAL') await provider.cancelDefaultRichMenu?.().catch(() => undefined)
  if (old) await provider.deleteRichMenu?.(old).catch(() => undefined)
  return { success: true, data: { kind } }
}

export interface LineRestriction {
  scope: import('@/lib/line/config').LineRestrictionScope
  reason: string
  created_at: string
  created_by: string
  until_at: string | null
  source: 'OWNER' | 'ABUSE'
  revoked_at: string | null
  active: boolean
}

export async function listLineRestrictions(contactId: string) {
  if (!UUID.test(contactId || '')) return bad('ไม่พบรายชื่อนี้')
  return callRpc<LineRestriction[]>('line_contact_restrictions', { p_contact_id: contactId })
}

export async function setLineRestriction(contactId: string, scope: import('@/lib/line/config').LineRestrictionScope, until: string | null, reason: string, revoke = false) {
  if (!UUID.test(contactId || '') || !['ALL', 'REGISTER', 'CATALOG', 'INQUIRY', 'WORK', 'MESSAGES'].includes(scope)) return bad('คำขอไม่สมบูรณ์')
  const note = (reason ?? '').trim()
  if (!note || note.length > 500) return bad('กรุณาระบุเหตุผลไม่เกิน 500 ตัวอักษร')
  if (until !== null && (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now())) return bad('เวลาสิ้นสุดต้องอยู่ในอนาคต')
  return callRpc('line_contact_restriction_set', { p_contact_id: contactId, p_scope: scope, p_until: until, p_reason: note, p_revoke: revoke })
}
// ── สลิปรอตรวจ (owner 2026-11-25): a customer's slip from the pay form, checked by the shop ──

export type LineSlipStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export interface LineSlipRow {
  id: string
  bill_id: string
  bill_no: string | null
  balance_due: number
  bill_status: string
  customer_name: string | null
  line_name: string | null
  amount: number
  status: LineSlipStatus
  approved_amount: number | null
  reject_reason: string | null
  image_path: string
  created_at: string
  decided_at: string | null
  decided_by: string | null
  /** automatic slip check (owner 2026-11-26): null = not checked */
  check_status?: 'PASS' | 'FAIL' | 'ERROR' | null
  check_detail?: { reasons?: string[]; amount_slip?: number; receiver?: string; duplicate?: boolean } | null
}

const SLIP_STATUSES: readonly string[] = ['PENDING', 'APPROVED', 'REJECTED']
const money = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function listLineSlips(status: LineSlipStatus | 'ALL', offset: number) {
  if (status !== 'ALL' && !SLIP_STATUSES.includes(status)) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  return callRpc<{ counts: Record<LineSlipStatus, number>; rows: LineSlipRow[] }>('line_slips_list', {
    p_status: status === 'ALL' ? null : status,
    p_limit: 25,
    p_offset: Math.max(0, Math.floor(Number(offset) || 0)),
  })
}

/** A 5-minute link to the slip picture (the bucket lets members with the bills menu read it). */
export async function getLineSlipImageUrl(path: string): Promise<LineActionResult<string>> {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path || '')) return bad('ไม่พบรูปสลิป')
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.storage.from('payment-slips').createSignedUrl(path, 300)
  if (error || !data?.signedUrl) return bad('เปิดรูปสลิปไม่สำเร็จ')
  return { success: true, data: data.signedUrl }
}

async function billForAnswer(billId: string) {
  const supabase = await createServerSupabase()
  const { data } = await supabase.from('bills').select('bill_no, balance_due').eq('id', billId).maybeSingle()
  return { billNo: (data?.bill_no as string | null) || '-', balance: Number(data?.balance_due ?? 0) }
}

/**
 * อนุมัติ: the database takes the money once (payment_receive, TRANSFER, the slip's own key) and queues the answer to
 * that customer's LINE in the same step. `amount` = what the shop read on the slip (at most what the bill owes).
 */
export async function approveLineSlip(input: { slipId: string; billId: string; amount: number; receivedOn?: string | null }) {
  if (!input || !UUID.test(input.slipId || '') || !UUID.test(input.billId || '')) return bad('ไม่พบสลิปนี้')
  const amount = Math.round(Number(input.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return bad('จำนวนเงินไม่ถูกต้อง')
  if (input.receivedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) return bad('วันที่รับเงินไม่ถูกต้อง')
  const [shop, bill] = await Promise.all([cronShop(), billForAnswer(input.billId)])
  let messages: LineMessage[] | null
  try {
    messages = [
      textMessage(
        'SLIP_APPROVED',
        { เลขบิล: bill.billNo, ยอดเงิน: money(amount), ยอดค้าง: money(Math.max(0, bill.balance - amount)), ชื่อร้าน: shop.shopName },
        shop.templates,
      ),
    ]
  } catch {
    messages = null
  }
  const r = await callRpc<{ slip_id: string; delivery_id: string | null; balance_due: number }>('line_slip_approve', {
    p_slip_id: input.slipId,
    p_amount: amount,
    p_received_on: input.receivedOn || null,
    p_messages: messages,
  })
  if (r.success && r.data?.delivery_id) await runOutboxOnce({ id: r.data.delivery_id })
  return r
}

export async function rejectLineSlip(input: { slipId: string; billId: string; reason: string }) {
  if (!input || !UUID.test(input.slipId || '') || !UUID.test(input.billId || '')) return bad('ไม่พบสลิปนี้')
  const reason = (input.reason ?? '').trim()
  if (!reason || reason.length > 300) return bad('กรุณาระบุเหตุผลไม่เกิน 300 ตัวอักษร')
  const [shop, bill] = await Promise.all([cronShop(), billForAnswer(input.billId)])
  let messages: LineMessage[] | null
  try {
    messages = [textMessage('SLIP_REJECTED', { เลขบิล: bill.billNo, เหตุผล: reason, ชื่อร้าน: shop.shopName }, shop.templates)]
  } catch {
    messages = null
  }
  const r = await callRpc<{ slip_id: string; delivery_id: string | null }>('line_slip_reject', { p_slip_id: input.slipId, p_reason: reason, p_messages: messages })
  if (r.success && r.data?.delivery_id) await runOutboxOnce({ id: r.data.delivery_id })
  return r
}

// ── สั่งงานพนักงาน (owner 2026-11-25): the staff tasks and their state ──

export type LineTaskStatus = 'SENT' | 'ACCEPTED' | 'DONE' | 'ISSUE' | 'CANCELLED'
export interface LineTaskRow {
  id: string
  title: string
  detail: string | null
  status: LineTaskStatus
  issue_note: string | null
  assignee: string | null
  bill_id: string | null
  bill_no: string | null
  created_at: string
  accepted_at: string | null
  done_at: string | null
  issue_at: string | null
  cancelled_at: string | null
  created_by: string | null
  /** line_deliveries.status of the task message */
  delivery: string | null
}
const TASK_STATUSES: readonly string[] = ['SENT', 'ACCEPTED', 'DONE', 'ISSUE', 'CANCELLED']

export async function listLineTasks(status: LineTaskStatus | 'ALL', offset: number) {
  if (status !== 'ALL' && !TASK_STATUSES.includes(status)) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  return callRpc<{ counts: Record<LineTaskStatus | 'ALL', number>; rows: LineTaskRow[] }>('line_tasks_list', {
    p_status: status === 'ALL' ? null : status,
    p_limit: 25,
    p_offset: Math.max(0, Math.floor(Number(offset) || 0)),
  })
}

export async function setLineTaskStatus(taskId: string, status: Exclude<LineTaskStatus, 'CANCELLED'>, note?: string) {
  if (!UUID.test(taskId || '') || !['SENT', 'ACCEPTED', 'DONE', 'ISSUE'].includes(status)) return bad('คำขอไม่สมบูรณ์ กรุณาลองใหม่')
  if ((note ?? '').length > 500) return bad('หมายเหตุยาวได้ไม่เกิน 500 ตัวอักษร')
  return callRpc<{ task_id: string; status: string; changed: boolean }>('line_task_set_status', { p_task_id: taskId, p_status: status, p_note: note?.trim() || null })
}

// ── QR พนักงาน (owner 2026-11-25): press to make, 5 minutes, dead at the first scan; no link to copy ──

/**
 * The QR text: the shop's own web address with a scan token (no code). The first scan (/api/line/staff-qr) kills
 * the QR and opens the shop chat with the single-use code typed in. The screen draws it as a picture only.
 */
export async function createStaffLineQr(profileId: string): Promise<LineActionResult<{ codeId: string; expiresAt: string; qrText: string }>> {
  if (!UUID.test(profileId || '')) return bad('ไม่พบพนักงาน')
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')
  if (!/^https?:\/\//.test(site)) return bad('ยังไม่ได้ตั้งที่อยู่เว็บของร้าน (NEXT_PUBLIC_SITE_URL)')
  const supabase = await createServerSupabase()
  const { data: shop } = await supabase.from('store_settings').select(SHOP_LINE_ID_COLUMN).eq('singleton', true).maybeSingle()
  // without the shop's LINE ID the scan could not open the shop chat: no code is made
  if (!lineOaMessageUrl((shop as ShopLineId | null)?.line_id ?? undefined, 'x')) return bad('ยังไม่ได้ใส่ LINE ID ของร้าน (ตั้งค่า › ข้อมูลกิจการ)')
  const r = await callRpc<{ code_id: string; token: string; expires_at: string }>('line_staff_qr_create', { p_profile_id: profileId })
  if (!r.success || !r.data) return { success: false, error: r.error }
  return { success: true, data: { codeId: r.data.code_id, expiresAt: r.data.expires_at, qrText: `${site}/api/line/staff-qr?t=${encodeURIComponent(r.data.token)}` } }
}

export async function getLineCodeState(codeId: string) {
  if (!UUID.test(codeId || '')) return bad('ไม่พบรหัสนี้')
  return callRpc<{ state: LineCodeRow['state'] | 'SCANNED'; expires_at: string }>('line_link_code_state', { p_code_id: codeId })
}
