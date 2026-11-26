import { LINE_LIMITS, LineMessageError } from './messages'
import { billDesignMessage, cardMessage, mapUrl, telUrl, type FlexButton, type FlexRow } from './flex'
import { type LineMessage } from './types'
import { LINE_EDITABLE_TEMPLATES } from './config'

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
    text:
      'ยินดีต้อนรับสู่ร้านจีรกิตติ์\n\nบริการจำหน่ายและให้เช่าแบบเหล็กและนั่งร้าน\n\nคุณสามารถดูรายการสินค้า สอบถามราคา สอบถามการสั่งสินค้าล่วงหน้า หรือติดต่อทางร้านผ่านเมนูด้านล่างได้เลย\n\nหากคุณเป็นลูกค้าของร้านและต้องการรับเอกสารหรือการแจ้งเตือนผ่าน LINE กรุณาลงทะเบียนหรือผูกบัญชีของคุณกับทางร้าน',
    vars: ['ชื่อร้าน'],
  },
  REGISTER_RETRY: { text: 'ยังไม่พบชื่อและเบอร์โทรในข้อความ พิมพ์ชื่อ-นามสกุลและเบอร์ 10 หลัก เช่น สมชาย ใจดี 0812345678', vars: [] },
  REGISTER_PHONE_TAKEN: { text: 'เบอร์นี้ผูกกับ LINE อื่นไว้แล้ว ร้านจะติดต่อกลับทาง LINE นี้', vars: [] },
  REGISTER_PENDING: { text: 'ได้รับคำขอลงทะเบียนแล้ว ร้านจะตรวจสอบข้อมูลก่อน และแจ้งผลทาง LINE นี้', vars: [] },
  REGISTER_HOWTO: { text: 'ลงทะเบียนโดยพิมพ์ชื่อ-นามสกุลและเบอร์โทร 10 หลักในแชตนี้ เช่น สมชาย ใจดี 0812345678 ร้านจะตรวจสอบก่อนและแจ้งผลทาง LINE นี้', vars: [] },
  REGISTER_APPROVED: { text: 'ร้านอนุมัติแล้ว ผูก LINE กับบัญชี {ชื่อ} ที่ {ชื่อร้าน} เรียบร้อย คุณจะได้รับเอกสารและการแจ้งเตือนทาง LINE นี้', vars: ['ชื่อ', 'ชื่อร้าน'] },
  REGISTER_REJECTED: { text: 'ขออภัย ร้านยังไม่สามารถยืนยันการลงทะเบียนของคุณได้ หากต้องการสอบถามติดต่อ {ชื่อร้าน} โทร {เบอร์โทรร้าน}', vars: ['ชื่อร้าน', 'เบอร์โทรร้าน'] },
  REGISTER_NEED_INFO: { text: 'ร้านขอข้อมูลเพิ่มเพื่อยืนยันการลงทะเบียน: {ข้อความจากร้าน} กรุณาตอบกลับในแชตนี้ ({ชื่อร้าน})', vars: ['ข้อความจากร้าน', 'ชื่อร้าน'] },
  SHOP_INFO: { text: '{ชื่อร้าน}\nสอบถามเพิ่มเติมได้ที่แชตนี้ หรือโทร {เบอร์โทรร้าน}', vars: ['ชื่อร้าน', 'เบอร์โทรร้าน'] },
  CONTACT_SHOP: { text: 'ได้รับเรื่องแล้ว เจ้าหน้าที่จะตอบกลับในแชตนี้ หากเร่งด่วนโทร {เบอร์โทรร้าน} ({ชื่อร้าน})', vars: ['ชื่อร้าน', 'เบอร์โทรร้าน'] },
  PRICE_INQUIRY_REPLY: { text: 'รับเรื่องสอบถามราคา: {รายการ} เจ้าหน้าที่จะตอบกลับในแชตนี้', vars: ['รายการ'] },
  PREORDER_INQUIRY_REPLY: {
    text: 'รับเรื่องสอบถามสั่งสินค้าล่วงหน้า: {รายการ}\nนี่เป็นการสอบถามเท่านั้น ยังไม่ใช่การยืนยันคำสั่งซื้อหรือการจองสินค้า เจ้าหน้าที่จะตรวจสอบและตอบกลับในแชตนี้',
    vars: ['รายการ'],
  },
  CATALOG_INTRO: { text: 'เลือกหมวดสินค้าที่สนใจได้เลย', vars: [] },
  CATALOG_ITEMS_INTRO: { text: 'รายการในหมวด {หมวด}', vars: ['หมวด'] },
  CATALOG_EMPTY: { text: 'ขณะนี้ยังไม่มีรายการสินค้าให้แสดง กรุณาติดต่อร้านโดยตรง โทร {เบอร์โทรร้าน}', vars: ['เบอร์โทรร้าน'] },
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
  SLIP_OWNER_NEW: { text: 'ลูกค้าแนบสลิปทาง LINE: {ชื่อลูกค้า} บิล {เลขบิล} ยอด {ยอดเงิน} บาท ตรวจได้ที่เมนู LINE › สลิปรอตรวจ', vars: ['ชื่อลูกค้า', 'เลขบิล', 'ยอดเงิน'] },
  SLIP_APPROVED: {
    text: 'ร้านได้รับชำระเงินแล้ว บิล {เลขบิล} ยอด {ยอดเงิน} บาท ยอดค้างคงเหลือ {ยอดค้าง} บาท ขอบคุณค่ะ {ชื่อร้าน}',
    vars: ['เลขบิล', 'ยอดเงิน', 'ยอดค้าง', 'ชื่อร้าน'],
  },
  SLIP_REJECTED: { text: 'ร้านยังยืนยันสลิปของบิล {เลขบิล} ไม่ได้: {เหตุผล} กรุณาแนบสลิปใหม่หรือติดต่อ {ชื่อร้าน}', vars: ['เลขบิล', 'เหตุผล', 'ชื่อร้าน'] },
  OWNER_SUMMARY: {
    text: 'สรุปยอดวันนี้ {วันที่}\nรายรับ {รายรับรวม} บาท\n{รายรับแยกช่องทาง}\nบิลใหม่ {บิลใหม่} ใบ\nยอดค้างชำระทั้งหมด {ยอดค้างรวม} บาท',
    vars: ['วันที่', 'รายรับรวม', 'รายรับแยกช่องทาง', 'บิลใหม่', 'ยอดค้างรวม'],
  },
  OWNER_TASK_SENT: { text: 'ส่งงานให้ {ชื่อพนักงาน} แล้ว: {เรื่อง}', vars: ['ชื่อพนักงาน', 'เรื่อง'] },
  OWNER_COMMAND_HELP: { text: 'คำสั่งที่ใช้ได้\n#สรุปยอดวันนี้\n#สั่งงาน ชื่อพนักงาน รายละเอียดงาน', vars: [] },
  OWNER_COMMAND_FAILED: { text: 'ทำคำสั่งไม่สำเร็จ: {เหตุผล}', vars: ['เหตุผล'] },
  RETURN_REQUEST_REPLY: { text: 'ได้รับเรื่องแจ้งนัดส่งคืนสินค้าแล้ว กรุณาพิมพ์วันและเวลาที่สะดวกในแชตนี้ เจ้าหน้าที่จะยืนยันกลับ', vars: [] },
  RETURN_REQUEST_OWNER: { text: 'ลูกค้าขอนัดส่งคืนสินค้าทาง LINE: {ชื่อลูกค้า} บิล {เลขบิล} ตอบนัดวันเวลาในแชตของลูกค้า', vars: ['ชื่อลูกค้า', 'เลขบิล'] },
  RETURN_REQUEST_NO_BILL: { text: 'ไม่พบสินค้าที่ต้องส่งคืน หากมีข้อสงสัยติดต่อ {ชื่อร้าน} โทร {เบอร์โทรร้าน}', vars: ['ชื่อร้าน', 'เบอร์โทรร้าน'] },
  OWNER_ORDER_HOWTO: { text: 'สั่งงานพนักงาน: พิมพ์ #สั่งงาน ชื่อพนักงาน รายละเอียดงาน หรือกดปุ่มด้านล่างเพื่อเปิดหน้าสั่งงานในแอป', vars: [] },
  MENU_NOTHING: { text: 'ตอนนี้ไม่มีรายการ', vars: [] },
  MENU_NOT_ALLOWED: { text: 'เมนูนี้ใช้ได้เฉพาะบัญชีที่ร้านยืนยันแล้ว หากต้องการผูกบัญชีติดต่อร้าน', vars: [] },
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

/**
 * Card or plain text per message (owner 2026-11-26, Settings › LINE › แก้ไขข้อความ): policies.line.templateCards, read
 * with the texts and carried in the overrides under TEMPLATE_CARDS_KEY (withTemplateCards). Only the messages below can
 * switch: the others go through database steps that accept plain text only (registration answers, slip answers, the
 * owner's slip / return notices, the shop's own screens) or carry the job buttons, so they stay as they are.
 */
export type TemplateFormat = 'FLEX' | 'TEXT'
export interface TemplateCard {
  format?: TemplateFormat
  /** card heading (default: the message's name) */
  title?: string
  /** heading colour #RRGGBB (default LINE green) */
  color?: string
  /** small closing line under the text */
  footer?: string
}
export const TEMPLATE_CARD_LIMITS = { title: 60, footer: 300 } as const
export const TEMPLATE_CARD_COLOURS = ['#06C755', '#F59E0B', '#EF4444', '#2563EB', '#334155'] as const
export const TEMPLATE_CARD_DEFAULT_COLOUR = '#06C755'
export const TEMPLATE_CARDS_KEY = '__cards'

const CARD_DEFAULT_KEYS: readonly LineTemplateKey[] = [
  'CUSTOMER_RETURN_REMINDER', 'CUSTOMER_DUE_TODAY', 'CUSTOMER_OVERDUE', 'CUSTOMER_PAYMENT_DUE', 'CUSTOMER_APPOINTMENT', 'CUSTOMER_JOB_STEP',
]
export const SWITCHABLE_TEMPLATES: ReadonlySet<LineTemplateKey> = new Set<LineTemplateKey>([
  ...CARD_DEFAULT_KEYS,
  'LINK_SUCCESS', 'LINK_INVALID', 'LINK_EXPIRED', 'LINK_LOCKED', 'LINK_TAKEN',
  'REGISTER_RETRY', 'REGISTER_PHONE_TAKEN', 'REGISTER_PENDING', 'REGISTER_HOWTO',
  'SHOP_INFO', 'CONTACT_SHOP', 'PRICE_INQUIRY_REPLY', 'PREORDER_INQUIRY_REPLY', 'CATALOG_INTRO', 'CATALOG_ITEMS_INTRO', 'CATALOG_EMPTY',
  'TASK_ACCEPTED', 'TASK_DONE', 'TASK_NOT_ALLOWED', 'TASK_ACCEPT_FIRST',
  'OWNER_SUMMARY', 'OWNER_TASK_SENT', 'OWNER_COMMAND_HELP', 'OWNER_COMMAND_FAILED',
  'RETURN_REQUEST_REPLY', 'RETURN_REQUEST_NO_BILL', 'MENU_NOTHING', 'MENU_NOT_ALLOWED',
])

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The saved card settings of one message (anything malformed is left out). */
export function templateCardOf(key: LineTemplateKey, cards: unknown): TemplateCard {
  const c = isObj(cards) && isObj(cards[key]) ? (cards[key] as Record<string, unknown>) : {}
  const out: TemplateCard = {}
  if (c.format === 'FLEX' || c.format === 'TEXT') out.format = c.format
  if (typeof c.title === 'string' && c.title.trim()) out.title = c.title.slice(0, TEMPLATE_CARD_LIMITS.title)
  if (typeof c.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.color)) out.color = c.color
  if (typeof c.footer === 'string' && c.footer.trim()) out.footer = c.footer.slice(0, TEMPLATE_CARD_LIMITS.footer)
  return out
}

/** How a message goes out: the shop's choice, else what it always was (customer notices = card, the rest = text). */
export function templateFormat(key: LineTemplateKey, cards: unknown): TemplateFormat {
  if (!SWITCHABLE_TEMPLATES.has(key)) return 'TEXT'
  return templateCardOf(key, cards).format ?? (CARD_DEFAULT_KEYS.includes(key) ? 'FLEX' : 'TEXT')
}

export const templateLabel = (key: LineTemplateKey): string => LINE_EDITABLE_TEMPLATES.find((t) => t.key === key)?.label ?? ''

/** The texts plus the card settings, as one overrides object for the senders. */
export function withTemplateCards(templates: Record<string, unknown> | null | undefined, cards: unknown): TemplateOverrides {
  return { ...(templates ?? {}), ...(isObj(cards) ? { [TEMPLATE_CARDS_KEY]: cards } : {}) }
}

/** The card of a message: heading colour, heading, the text, closing line and buttons the server made. */
export function templateCardMessage(key: LineTemplateKey, text: string, cards: unknown, opts: { title?: string; buttons?: FlexButton[] } = {}): LineMessage {
  const card = templateCardOf(key, cards)
  const title = card.title || opts.title || templateLabel(key) || text.slice(0, 40)
  return billDesignMessage({ altText: text, title, color: card.color ?? TEMPLATE_CARD_DEFAULT_COLOUR, text, rows: [], footer: card.footer, buttons: opts.buttons })
}

export function textMessage(key: LineTemplateKey, vars?: TemplateVars, overrides?: TemplateOverrides): LineMessage {
  const text = renderTemplate(key, vars, overrides)
  const cards = overrides?.[TEMPLATE_CARDS_KEY]
  return templateFormat(key, cards) === 'FLEX' ? templateCardMessage(key, text, cards) : { type: 'text', text }
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
  /** The driver job form in LINE (LIFF), when the shop has set it up */
  formUrl?: string | null
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
    if (details.formUrl) buttons.push({ label: 'เปิดฟอร์มงาน', uri: details.formUrl })
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
  const cards = overrides?.[TEMPLATE_CARDS_KEY]
  if (templateFormat(key, cards) === 'TEXT') return [{ type: 'text', text }]
  const buttons: FlexButton[] = []
  if (contact?.chatUrl) buttons.push({ label: 'แชทกับร้าน', uri: contact.chatUrl, primary: true })
  const tel = telUrl(contact?.phone)
  if (tel) buttons.push({ label: 'โทรหาร้าน', uri: tel })
  return [templateCardMessage(key, text, cards, { title, buttons })]
}
