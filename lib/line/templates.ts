import { LINE_LIMITS, LineMessageError } from './messages'
import { cardMessage, mapUrl, telUrl, type FlexButton, type FlexRow } from './flex'
import { type LineMessage } from './types'

/**
 * Message templates (spec "ตัวอย่างข้อความที่ส่งออก"). Defaults live here; the OWNER may
 * override the text of a key in Settings (store_settings.policies.line.templates) using only
 * that key's placeholders. Rendering fails instead of sending a message with a hole in it.
 */

export const LINE_TEMPLATES = {
  LINK_SUCCESS: { text: 'ผูก LINE กับบัญชี {ชื่อ} ที่ {ชื่อร้าน} เรียบร้อยแล้ว คุณจะได้รับแจ้งเตือนทาง LINE นี้', vars: ['ชื่อ', 'ชื่อร้าน'] },
  LINK_INVALID: { text: 'รหัสไม่ถูกต้อง กรุณาตรวจสอบรหัสอีกครั้ง หรือขอรหัสใหม่จากร้าน', vars: [] },
  LINK_EXPIRED: { text: 'รหัสนี้หมดอายุหรือใช้ไปแล้ว กรุณาขอรหัสใหม่จากร้าน', vars: [] },
  LINK_LOCKED: { text: 'ใส่รหัสผิดหลายครั้ง กรุณารอสักครู่แล้วขอรหัสใหม่จากร้าน', vars: [] },
  LINK_TAKEN: { text: 'LINE นี้ผูกกับบัญชีอื่นแล้ว ให้เจ้าของร้านยกเลิกก่อน', vars: [] },
  REGISTER_WELCOME: {
    text: 'ขอบคุณที่เพิ่มเพื่อน{ชื่อร้าน}\nพิมพ์ชื่อ-นามสกุลและเบอร์โทร เพื่อรับบิลและแจ้งเตือนวันคืนทาง LINE\nเช่น สมชาย ใจดี 0812345678',
    vars: ['ชื่อร้าน'],
  },
  REGISTER_RETRY: { text: 'ยังไม่พบชื่อและเบอร์โทรในข้อความ พิมพ์ชื่อ-นามสกุลและเบอร์ 10 หลัก เช่น สมชาย ใจดี 0812345678', vars: [] },
  REGISTER_PHONE_TAKEN: { text: 'เบอร์นี้ผูกกับ LINE อื่นไว้แล้ว ร้านจะติดต่อกลับทาง LINE นี้', vars: [] },
  REGISTER_PENDING: { text: 'ได้รับชื่อและเบอร์โทรแล้ว ร้านจะตรวจข้อมูลและติดต่อกลับทาง LINE นี้', vars: [] },
  TEST: { text: 'ข้อความทดสอบจาก {ชื่อร้าน} ถ้าเห็นข้อความนี้ แปลว่า LINE พร้อมใช้งาน', vars: ['ชื่อร้าน'] },
  STAFF_NOTICE: { text: '[{หัวข้อ}] {รายละเอียด}', vars: ['หัวข้อ', 'รายละเอียด'] },
  TASK_NEW: { text: 'งานใหม่จาก {ผู้สั่ง}: {เรื่อง}', vars: ['ผู้สั่ง', 'เรื่อง'] },
  TASK_ACCEPTED: { text: 'รับงานแล้ว: {เรื่อง}', vars: ['เรื่อง'] },
  TASK_DONE: { text: 'บันทึกว่าเสร็จแล้ว: {เรื่อง}', vars: ['เรื่อง'] },
  TASK_NOT_ALLOWED: { text: 'งานนี้ไม่ได้มอบหมายให้บัญชีของคุณ หรือปิดไปแล้ว', vars: [] },
  TASK_STEP_DONE: { text: 'บันทึกขั้น {ขั้นตอน} แล้ว: {เรื่อง}', vars: ['ขั้นตอน', 'เรื่อง'] },
  TASK_ACCEPT_FIRST: { text: 'กรุณากด "รับงาน" ในข้อความงานก่อนอัปเดตขั้นตอน', vars: [] },
  TASK_WITHDRAWN: { text: 'ถอนงาน: {เรื่อง} งานนี้มอบให้ผู้อื่นแล้ว ไม่ต้องดำเนินการต่อ', vars: ['เรื่อง'] },
  TASK_CANCELLED: { text: 'ยกเลิกงาน: {เรื่อง} ({เหตุผล}) ไม่ต้องดำเนินการต่อ', vars: ['เรื่อง', 'เหตุผล'] },
  DRIVER_ACCEPT_REMINDER: { text: 'ยังไม่ได้กดรับงาน: {เรื่อง} กรุณากด "รับงาน" ในข้อความงาน', vars: ['เรื่อง'] },
  CUSTOMER_RETURN_REMINDER: {
    text: 'เรียนคุณ{ชื่อลูกค้า} บิล {เลขบิล} ครบกำหนดคืน {วันคืน} ยอดค้าง {ยอดค้าง} บาท ขอบคุณค่ะ {ชื่อร้าน}',
    vars: ['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน'],
  },
  CUSTOMER_DUE_TODAY: {
    text: 'เรียนคุณ{ชื่อลูกค้า} บิล {เลขบิล} ครบกำหนดคืนวันนี้ ({วันคืน}) ยอดค้าง {ยอดค้าง} บาท ขอบคุณค่ะ {ชื่อร้าน}',
    vars: ['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน'],
  },
  CUSTOMER_OVERDUE: {
    text: 'เรียนคุณ{ชื่อลูกค้า} บิล {เลขบิล} เลยกำหนดคืน ({วันคืน}) แล้ว กรุณาติดต่อร้านเพื่อนัดคืนสินค้า ยอดค้าง {ยอดค้าง} บาท {ชื่อร้าน}',
    vars: ['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน'],
  },
  CUSTOMER_PAYMENT_DUE: {
    text: 'เรียนคุณ{ชื่อลูกค้า} บิล {เลขบิล} มียอดค้างชำระ {ยอดค้าง} บาท ครบกำหนด {วันครบ} ขอบคุณค่ะ {ชื่อร้าน}',
    vars: ['ชื่อลูกค้า', 'เลขบิล', 'วันครบ', 'ยอดค้าง', 'ชื่อร้าน'],
  },
  CUSTOMER_APPOINTMENT: {
    text: 'เรียนคุณ{ชื่อลูกค้า} แจ้งนัดหมาย "{เรื่อง}" วันที่ {วันนัด} ขอบคุณค่ะ {ชื่อร้าน}',
    vars: ['ชื่อลูกค้า', 'เรื่อง', 'วันนัด', 'ชื่อร้าน'],
  },
  CUSTOMER_JOB_STEP: {
    text: 'เรียนคุณ{ชื่อลูกค้า} งาน "{เรื่อง}": {ขั้นตอน} (คนขับ {คนขับ}) {ชื่อร้าน}',
    vars: ['ชื่อลูกค้า', 'เรื่อง', 'ขั้นตอน', 'คนขับ', 'ชื่อร้าน'],
  },
} as const satisfies Record<string, { text: string; vars: readonly string[] }>

export type LineTemplateKey = keyof typeof LINE_TEMPLATES
export type TemplateVars = Record<string, string | number>
export type TemplateOverrides = Partial<Record<string, unknown>>

const PLACEHOLDER = /\{([^{}]+)\}/g

export function isTemplateKey(key: string): key is LineTemplateKey {
  return Object.prototype.hasOwnProperty.call(LINE_TEMPLATES, key)
}

/** An override is used only when it is text and names no placeholder the key does not have. */
function pickText(key: LineTemplateKey, overrides?: TemplateOverrides): string {
  const own = LINE_TEMPLATES[key]
  const candidate = overrides?.[key]
  if (typeof candidate !== 'string' || candidate.trim() === '' || candidate.length > LINE_LIMITS.textLength) return own.text
  const allowed = new Set<string>(own.vars)
  for (const m of candidate.matchAll(PLACEHOLDER)) {
    if (!allowed.has(m[1])) return own.text
  }
  return candidate
}

export function renderTemplate(key: LineTemplateKey, vars: TemplateVars = {}, overrides?: TemplateOverrides): string {
  const text = pickText(key, overrides).replace(PLACEHOLDER, (_all, name: string) => {
    const value = vars[name]
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new LineMessageError(`LINE_TEMPLATE_VAR_MISSING:${name}`)
    }
    return String(value)
  })
  if (text.length > LINE_LIMITS.textLength) throw new LineMessageError('LINE_TEXT_INVALID')
  return text
}

export function textMessage(key: LineTemplateKey, vars?: TemplateVars, overrides?: TemplateOverrides): LineMessage {
  return { type: 'text', text: renderTemplate(key, vars, overrides) }
}

const shorten = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`)

/** Postback data of a task button. Parsed by parseTaskPostback in the webhook. */
export function taskPostbackData(taskId: string, action: 'ACCEPT' | 'DONE' | 'STEP', stage?: string): string {
  return new URLSearchParams({ kind: 'task', task: taskId, action, ...(action === 'STEP' && stage ? { stage } : {}) }).toString()
}

/** Work order with the two buttons of the spec ("รับงาน" / "เสร็จแล้ว"). */
export function taskMessages(taskId: string, vars: { ผู้สั่ง: string; เรื่อง: string }, overrides?: TemplateOverrides): LineMessage[] {
  const text = renderTemplate('TASK_NEW', vars, overrides)
  return [
    {
      type: 'template',
      altText: shorten(text, LINE_LIMITS.altTextLength),
      template: {
        type: 'buttons',
        text: shorten(text, LINE_LIMITS.buttonsTextLength),
        actions: [
          { type: 'postback', label: 'รับงาน', data: taskPostbackData(taskId, 'ACCEPT'), displayText: 'รับงาน' },
          { type: 'postback', label: 'เสร็จแล้ว', data: taskPostbackData(taskId, 'DONE'), displayText: 'เสร็จแล้ว' },
        ],
      },
    },
  ]
}

/** What the driver needs on the job card (all from the appointment; empty values are left out). */
export interface DriverJobDetails {
  when?: string
  customer?: string
  phone?: string | null
  place?: string | null
  detail?: string | null
}

/** Job to a driver: only "รับงาน". After that every reply carries the button of the next step. */
export function driverTaskMessages(
  taskId: string,
  vars: { ผู้สั่ง: string; เรื่อง: string },
  overrides?: TemplateOverrides,
  details?: DriverJobDetails,
): LineMessage[] {
  const text = renderTemplate('TASK_NEW', vars, overrides)
  if (details) {
    const rows: FlexRow[] = [
      { label: 'วันเวลา', value: details.when ?? '' },
      { label: 'ลูกค้า', value: details.customer ?? '' },
      { label: 'โทร', value: details.phone ?? '' },
      { label: 'สถานที่', value: details.place ?? '' },
      { label: 'รายละเอียด', value: details.detail ?? '' },
    ]
    const buttons: FlexButton[] = [{ label: 'รับงาน', postback: taskPostbackData(taskId, 'ACCEPT'), displayText: 'รับงาน', primary: true }]
    const map = mapUrl(details.place)
    const tel = telUrl(details.phone)
    if (map) buttons.push({ label: 'เปิดแผนที่', uri: map })
    if (tel) buttons.push({ label: 'โทรหาลูกค้า', uri: tel })
    return [cardMessage({ altText: text, title: text, rows, buttons })]
  }
  return [
    {
      type: 'template',
      altText: shorten(text, LINE_LIMITS.altTextLength),
      template: {
        type: 'buttons',
        text: shorten(text, LINE_LIMITS.buttonsTextLength),
        actions: [{ type: 'postback', label: 'รับงาน', data: taskPostbackData(taskId, 'ACCEPT'), displayText: 'รับงาน' }],
      },
    },
  ]
}

/** A reply text with the one button of the driver's next step (label = the step name). */
export function nextStepMessage(taskId: string, text: string, next: { key: string; label: string }): LineMessage {
  const label = shorten(next.label, LINE_LIMITS.actionLabelLength)
  return {
    type: 'template',
    altText: shorten(`${text} · ขั้นถัดไป: ${next.label}`, LINE_LIMITS.altTextLength),
    template: {
      type: 'buttons',
      text: shorten(`${text}
ขั้นถัดไป: ${next.label}`, LINE_LIMITS.buttonsTextLength),
      actions: [{ type: 'postback', label, data: taskPostbackData(taskId, 'STEP', next.key), displayText: next.label }],
    },
  }
}

/** Customer notice card: the (owner-editable) text plus buttons to reach the shop. */
export function customerNoticeMessages(
  key: LineTemplateKey,
  title: string,
  vars: TemplateVars,
  overrides?: TemplateOverrides,
  contact?: { chatUrl?: string | null; phone?: string | null },
): LineMessage[] {
  const text = renderTemplate(key, vars, overrides)
  const buttons: FlexButton[] = []
  if (contact?.chatUrl) buttons.push({ label: 'แชทกับร้าน', uri: contact.chatUrl, primary: true })
  const tel = telUrl(contact?.phone)
  if (tel) buttons.push({ label: 'โทรหาร้าน', uri: tel })
  return [cardMessage({ altText: text, title, text, buttons })]
}
