/**
 * แม่แบบข้อความ LINE (owner 2026-11-13, from the shop's reference screen "เขียนข้อความ"): the shop writes a message
 * once, keeps it, and picks it when sending a bill on LINE. Stored in store_settings.policies.line_message_templates.
 * Sending to a whole group at once is not built (owner: แม่แบบอย่างเดียวก่อน).
 */
export type LineMessageTopic = 'DELIVERY' | 'RETURN' | 'OUTSTANDING' | 'BILL' | 'GENERAL'
export const LINE_MESSAGE_TOPICS: ReadonlyArray<{ id: LineMessageTopic; label: string }> = [
  { id: 'DELIVERY', label: 'นัดส่ง / นัดรับของ' },
  { id: 'RETURN', label: 'เตือนวันคืน' },
  { id: 'OUTSTANDING', label: 'แจ้งยอดค้างชำระ' },
  { id: 'BILL', label: 'แจ้งเรื่องบิล' },
  { id: 'GENERAL', label: 'ข่าวสารจากร้าน' },
]

export type LineMessageGroup = 'STAFF' | 'CUSTOMER' | 'DRIVER'
export const LINE_MESSAGE_GROUPS: ReadonlyArray<{ id: LineMessageGroup; label: string }> = [
  { id: 'STAFF', label: 'พนักงานร้าน' },
  { id: 'CUSTOMER', label: 'ลูกค้า / ผู้เช่า' },
  { id: 'DRIVER', label: 'คนขับ / ผู้จัดส่ง' },
]

/** Words in { } that are filled when the message is used. */
export const LINE_MESSAGE_VARS: ReadonlyArray<{ token: string; label: string }> = [
  { token: '{ชื่อ}', label: 'ชื่อผู้รับ' },
  { token: '{เลขบิล}', label: 'เลขที่บิล' },
  { token: '{ยอดค้าง}', label: 'ยอดค้างชำระ' },
  { token: '{วันที่คืน}', label: 'กำหนดคืน' },
  { token: '{ร้าน}', label: 'ชื่อร้าน' },
]

export interface LineMessageTemplate {
  id: string
  name: string
  topic: LineMessageTopic
  groups: LineMessageGroup[]
  subject: string
  text: string
}

export const LINE_MESSAGE_LIMITS = { templates: 30, name: 40, subject: 100, text: 1000 } as const

export function newLineMessageTemplate(): LineMessageTemplate {
  return {
    id: '',
    name: '',
    topic: 'DELIVERY',
    groups: ['CUSTOMER'],
    subject: '',
    text: 'สวัสดี {ชื่อ}\n\nร้าน {ร้าน} ขอแจ้งเรื่องบิล {เลขบิล}\nยอดค้างชำระ {ยอดค้าง} · กำหนดคืน {วันที่คืน}\n\nขอบคุณครับ',
  }
}

export interface LineMessageValues {
  name: string
  billNo?: string
  outstanding?: string
  returnDate?: string
  shop: string
}

/** The message with its { } words filled; a word with no value is left empty. */
export function fillLineMessage(text: string, v: LineMessageValues): string {
  const map: Record<string, string> = {
    '{ชื่อ}': v.name,
    '{เลขบิล}': v.billNo ?? '',
    '{ยอดค้าง}': v.outstanding ?? '',
    '{วันที่คืน}': v.returnDate ?? '',
    '{ร้าน}': v.shop.trim() || 'ร้าน',
  }
  return Object.entries(map).reduce((out, [token, value]) => out.split(token).join(value), text)
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Saved templates from store_settings.policies (anything malformed is dropped). */
export function parseLineMessageTemplates(v: unknown): LineMessageTemplate[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object' && typeof (t as { id?: unknown }).id === 'string')
    .slice(0, LINE_MESSAGE_LIMITS.templates)
    .map((t) => ({
      id: String(t.id),
      name: str(t.name, LINE_MESSAGE_LIMITS.name),
      topic: LINE_MESSAGE_TOPICS.some((x) => x.id === t.topic) ? (t.topic as LineMessageTopic) : 'GENERAL',
      groups: Array.isArray(t.groups) ? LINE_MESSAGE_GROUPS.map((g) => g.id).filter((id) => (t.groups as unknown[]).includes(id)) : [],
      subject: str(t.subject, LINE_MESSAGE_LIMITS.subject),
      text: str(t.text, LINE_MESSAGE_LIMITS.text),
    }))
}

export function validateLineMessageTemplate(t: LineMessageTemplate): string | null {
  if (!t.name.trim()) return 'กรุณาตั้งชื่อแม่แบบ'
  if (t.name.trim().length > LINE_MESSAGE_LIMITS.name) return `ชื่อแม่แบบยาวได้ไม่เกิน ${LINE_MESSAGE_LIMITS.name} ตัวอักษร`
  if (t.groups.length === 0) return 'เลือกกลุ่มผู้รับอย่างน้อย 1 กลุ่ม'
  if (t.subject.trim().length > LINE_MESSAGE_LIMITS.subject) return `เรื่องยาวได้ไม่เกิน ${LINE_MESSAGE_LIMITS.subject} ตัวอักษร`
  if (!t.text.trim()) return 'กรุณาพิมพ์ข้อความ'
  if (t.text.length > LINE_MESSAGE_LIMITS.text) return `ข้อความยาวได้ไม่เกิน ${LINE_MESSAGE_LIMITS.text} ตัวอักษร`
  return null
}
