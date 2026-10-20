import { LINE_LIMITS, LineMessageError } from './messages'
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
  CUSTOMER_RETURN_REMINDER: {
    text: 'เรียนคุณ{ชื่อลูกค้า} บิล {เลขบิล} ครบกำหนดคืน {วันคืน} ยอดค้าง {ยอดค้าง} บาท ขอบคุณค่ะ {ชื่อร้าน}',
    vars: ['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน'],
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

/** Job to a driver: only "รับงาน". After that every reply carries the button of the next step. */
export function driverTaskMessages(taskId: string, vars: { ผู้สั่ง: string; เรื่อง: string }, overrides?: TemplateOverrides): LineMessage[] {
  const text = renderTemplate('TASK_NEW', vars, overrides)
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
