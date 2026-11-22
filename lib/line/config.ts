import { type LineTemplateKey } from './templates'
import type { SystemConfig } from '@/features/settings/services/settings-storage'

/**
 * One source for every LINE option: the Settings screens render from these lists, the
 * validator (lib/line/policy.ts) checks against them, and the worker maps rules to texts.
 * The database checks the same keys and ranges (_line_policy_check, migration 20261022090000).
 */

/** In-app notice types (notifications.event_type) the OWNER may also send to staff LINE. */
export type LineNotifyEventType = NonNullable<keyof SystemConfig['line']['notify']>

export const LINE_NOTIFY_EVENTS: ReadonlyArray<{ type: LineNotifyEventType; label: string }> = [
  { type: 'APPOINTMENT_DUE', label: 'นัดหมายใกล้ถึง' },
  { type: 'DELIVERY_DUE', label: 'กำหนดส่งสินค้า' },
  { type: 'RENTAL_DUE_SOON', label: 'ใกล้ครบกำหนดคืน' },
  { type: 'RENTAL_OVERDUE', label: 'เลยกำหนดคืน' },
  { type: 'PAYMENT_DUE', label: 'ใกล้ครบกำหนดชำระ' },
  { type: 'LOW_STOCK', label: 'สินค้าใกล้หมด' },
  { type: 'JOB_STEP', label: 'คนขับอัปเดตงาน' },
  { type: 'JOB_ACCEPT_LATE', label: 'คนขับยังไม่รับงาน' },
]

/** Who receives a text (Settings › LINE › ข้อความ shows it and the chat preview). */
export type LineTemplateAudience = 'พนักงาน' | 'คนขับ' | 'ลูกค้า'

/** The four groups on the แก้ไขข้อความ page (owner 2026-11-21). */
export type LineTemplateCategory = 'FRIEND' | 'CATALOG' | 'CUSTOMER' | 'STAFF'
export const LINE_TEMPLATE_CATEGORIES: ReadonlyArray<{ id: LineTemplateCategory; label: string }> = [
  { id: 'FRIEND', label: 'เพิ่มเพื่อนและลงทะเบียน' },
  { id: 'CATALOG', label: 'สินค้าและการติดต่อ' },
  { id: 'CUSTOMER', label: 'ลูกค้าและเอกสาร' },
  { id: 'STAFF', label: 'พนักงานและคนขับ' },
]

/** Texts the OWNER may reword in Settings › LINE › แก้ไขข้อความ. Each one is sent by real code (see where it is used). */
export const LINE_EDITABLE_TEMPLATES: ReadonlyArray<{ key: LineTemplateKey; label: string; to: LineTemplateAudience; category: LineTemplateCategory }> = [
  { key: 'REGISTER_WELCOME', label: 'ข้อความต้อนรับเมื่อเพิ่มเพื่อน', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'REGISTER_RETRY', label: 'ขอชื่อและเบอร์อีกครั้ง', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'REGISTER_HOWTO', label: 'วิธีลงทะเบียน (ปุ่ม ลงทะเบียน เมื่อยังไม่มีฟอร์ม)', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'REGISTER_PENDING', label: 'ลงทะเบียนสำเร็จ รอร้านตรวจสอบ', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'REGISTER_NEED_INFO', label: 'ร้านขอข้อมูลเพิ่มเติม', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'REGISTER_APPROVED', label: 'ร้านอนุมัติแล้ว', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'REGISTER_REJECTED', label: 'ร้านปฏิเสธ', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'LINK_SUCCESS', label: 'ผูกบัญชีสำเร็จ', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'LINK_INVALID', label: 'ผูกบัญชีไม่สำเร็จ (รหัสไม่ถูกต้อง)', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'LINK_EXPIRED', label: 'รหัสหมดอายุ', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'LINK_LOCKED', label: 'ใส่รหัสผิดหลายครั้ง', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'LINK_TAKEN', label: 'LINE นี้ผูกกับบัญชีอื่นแล้ว', to: 'ลูกค้า', category: 'FRIEND' },
  { key: 'CATALOG_INTRO', label: 'แนะนำหมวดหมู่สินค้า', to: 'ลูกค้า', category: 'CATALOG' },
  { key: 'CATALOG_ITEMS_INTRO', label: 'แสดงรายการสินค้าในหมวด', to: 'ลูกค้า', category: 'CATALOG' },
  { key: 'CATALOG_EMPTY', label: 'ยังไม่มีรายการสินค้าให้แสดง', to: 'ลูกค้า', category: 'CATALOG' },
  { key: 'PRICE_INQUIRY_REPLY', label: 'ตอบเมื่อสอบถามราคา', to: 'ลูกค้า', category: 'CATALOG' },
  { key: 'PREORDER_INQUIRY_REPLY', label: 'ตอบเมื่อสอบถามสั่งสินค้าล่วงหน้า', to: 'ลูกค้า', category: 'CATALOG' },
  { key: 'CONTACT_SHOP', label: 'ติดต่อร้าน', to: 'ลูกค้า', category: 'CATALOG' },
  { key: 'SHOP_INFO', label: 'ข้อมูลร้านและเวลาทำการ', to: 'ลูกค้า', category: 'CATALOG' },
  { key: 'CUSTOMER_RETURN_REMINDER', label: 'แจ้งเตือนกำหนดคืน', to: 'ลูกค้า', category: 'CUSTOMER' },
  { key: 'CUSTOMER_DUE_TODAY', label: 'แจ้งเตือนครบกำหนดคืนวันนี้', to: 'ลูกค้า', category: 'CUSTOMER' },
  { key: 'CUSTOMER_OVERDUE', label: 'แจ้งเตือนเกินกำหนดคืน', to: 'ลูกค้า', category: 'CUSTOMER' },
  { key: 'CUSTOMER_PAYMENT_DUE', label: 'แจ้งเตือนชำระเงิน', to: 'ลูกค้า', category: 'CUSTOMER' },
  { key: 'CUSTOMER_APPOINTMENT', label: 'แจ้งเตือนนัดหมาย', to: 'ลูกค้า', category: 'CUSTOMER' },
  { key: 'CUSTOMER_JOB_STEP', label: 'แจ้งความคืบหน้าการจัดส่ง', to: 'ลูกค้า', category: 'CUSTOMER' },
  { key: 'STAFF_NOTICE', label: 'แจ้งเตือนพนักงาน', to: 'พนักงาน', category: 'STAFF' },
  { key: 'TASK_NEW', label: 'มอบหมายงานคนขับ', to: 'คนขับ', category: 'STAFF' },
  { key: 'TASK_ACCEPTED', label: 'ตอบกลับเมื่อรับงาน', to: 'คนขับ', category: 'STAFF' },
  { key: 'TASK_STEP_DONE', label: 'แจ้งความคืบหน้า (ขั้นตอนงาน)', to: 'คนขับ', category: 'STAFF' },
  { key: 'TASK_DONE', label: 'ตอบกลับเมื่องานเสร็จ', to: 'คนขับ', category: 'STAFF' },
  { key: 'DRIVER_ACCEPT_REMINDER', label: 'เตือนเมื่อยังไม่รับงาน', to: 'คนขับ', category: 'STAFF' },
  { key: 'TASK_WITHDRAWN', label: 'ถอนงาน', to: 'คนขับ', category: 'STAFF' },
  { key: 'TASK_CANCELLED', label: 'ยกเลิกงาน', to: 'คนขับ', category: 'STAFF' },
]

/** Address parts the registration form can ask for (policies.line.register.required, OWNER decides which are a must). */
export const LINE_REGISTER_FIELDS = ['province', 'district', 'subdistrict', 'address', 'postcode'] as const
export type LineRegisterField = (typeof LINE_REGISTER_FIELDS)[number]
export const LINE_REGISTER_FIELD_LABELS: Record<LineRegisterField, string> = {
  province: 'จังหวัด',
  district: 'อำเภอ',
  subdistrict: 'ตำบล',
  address: 'ที่อยู่',
  postcode: 'รหัสไปรษณีย์',
}

/** Numeric field of a reminder rule shown in Settings. */
export interface LineReminderField {
  key: 'daysBefore' | 'repeatDays'
  label: string
  min: number
  max: number
  default: number
}

export type LineReminderRuleKey = 'RENTAL_DUE_SOON' | 'RENTAL_DUE_TODAY' | 'RENTAL_OVERDUE' | 'PAYMENT_DUE' | 'APPOINTMENT_DUE'

/** Customer reminder rules (policies.line.reminders). All off until the OWNER switches one on. */
export const LINE_REMINDER_RULES: ReadonlyArray<{
  key: LineReminderRuleKey
  label: string
  template: LineTemplateKey
  fields: readonly LineReminderField[]
}> = [
  {
    key: 'RENTAL_DUE_SOON',
    label: 'ใกล้ครบกำหนดคืน',
    template: 'CUSTOMER_RETURN_REMINDER',
    fields: [{ key: 'daysBefore', label: 'ล่วงหน้า (วัน)', min: 1, max: 30, default: 1 }],
  },
  {
    key: 'RENTAL_DUE_TODAY',
    label: 'ครบกำหนดคืนวันนี้',
    template: 'CUSTOMER_DUE_TODAY',
    fields: [],
  },
  {
    key: 'RENTAL_OVERDUE',
    label: 'เลยกำหนดคืน',
    template: 'CUSTOMER_OVERDUE',
    fields: [{ key: 'repeatDays', label: 'เตือนซ้ำทุก (วัน)', min: 0, max: 30, default: 0 }],
  },
  {
    key: 'PAYMENT_DUE',
    label: 'ยอดค้างชำระ',
    template: 'CUSTOMER_PAYMENT_DUE',
    fields: [
      { key: 'daysBefore', label: 'ล่วงหน้า (วัน)', min: 0, max: 30, default: 1 },
      { key: 'repeatDays', label: 'เลยกำหนดแล้วเตือนซ้ำทุก (วัน)', min: 0, max: 30, default: 0 },
    ],
  },
  {
    key: 'APPOINTMENT_DUE',
    label: 'นัดหมาย',
    template: 'CUSTOMER_APPOINTMENT',
    fields: [{ key: 'daysBefore', label: 'ล่วงหน้า (วัน)', min: 0, max: 30, default: 1 }],
  },
]

export interface LineReminderRuleSetting {
  enabled?: boolean
  daysBefore?: number
  repeatDays?: number
}
export type LineReminderSettings = Partial<Record<LineReminderRuleKey, LineReminderRuleSetting>>

/** Driver job steps the OWNER may tell the customer about (policies.line.customerStages). */
export const LINE_CUSTOMER_STAGES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'ACCEPT', label: 'คนขับรับงานแล้ว' },
  { key: 'TRANSIT', label: 'กำลังเดินทาง (ออกส่ง / ออกเก็บ)' },
  { key: 'ARRIVED', label: 'ถึงหน้างานแล้ว' },
  { key: 'COMPLETED', label: 'ส่งเสร็จแล้ว' },
  { key: 'COLLECTED', label: 'เก็บสินค้าแล้ว' },
]

/** Single-number options of policies.line, with the range the database accepts. */
export const LINE_RESTRICTION_SCOPES = {
  ALL: 'ทุกการใช้งาน LINE', REGISTER: 'ลงทะเบียนและผูกบัญชี', CATALOG: 'ดูรายการสินค้า',
  INQUIRY: 'สอบถามราคาและสั่งล่วงหน้า', WORK: 'งานและการเงินผ่าน LINE', MESSAGES: 'รับข้อความจากระบบ',
} as const
export type LineRestrictionScope = keyof typeof LINE_RESTRICTION_SCOPES
export const LINE_NUMBER_OPTIONS = {
  interactionMaxPerMinute: { label: 'กดรวมได้ (ครั้ง/นาที)', min: 1, max: 120, default: 12 },
  interactionDuplicateSeconds: { label: 'เว้นการกดปุ่มเดิม (วินาที)', min: 1, max: 60, default: 3 },
  inquiryMaxPerWindow: { label: 'สอบถามราคาได้ต่อช่วง (ครั้ง)', min: 1, max: 60, default: 5 },
  inquiryWindowMinutes: { label: 'ช่วงเวลานับการสอบถามราคา (นาที)', min: 1, max: 60, default: 5 },
  registerCooldownMinutes: { label: 'เว้นการลงทะเบียนใหม่ (นาที)', min: 1, max: 1440, default: 5 },
  ownerNoticeCooldownMinutes: { label: 'เว้นแจ้งเจ้าของซ้ำต่อคน (นาที)', min: 1, max: 1440, default: 15 },
  abuseStrikeLimit: { label: 'ฝ่าฝืนก่อนระงับอัตโนมัติ (ครั้ง)', min: 1, max: 20, default: 3 },
  abuseWindowMinutes: { label: 'ช่วงเวลานับการฝ่าฝืน (นาที)', min: 1, max: 1440, default: 10 },
  abuseSuspendMinutes: { label: 'ระงับอัตโนมัตินาน (นาที)', min: 1, max: 1440, default: 15 },
  reminderHour: { label: 'เริ่มส่งเตือนลูกค้าตั้งแต่ (โมง)', min: 0, max: 23, default: 9 },
  acceptTimeoutMinutes: { label: 'เตือนคนขับถ้ายังไม่รับงานภายใน (นาที)', min: 0, max: 1440, default: 0 },
  linkInviteTtlHours: { label: 'ลิงก์ผูก LINE ใช้ได้นาน (ชั่วโมง)', min: 1, max: 720, default: 72 },
  linkCodeTtlMinutes: { label: 'รหัสผูกแบบพิมพ์ใช้ได้นาน (นาที)', min: 2, max: 60, default: 10 },
  linkMaxFailures: { label: 'ใส่รหัสผิดได้ (ครั้ง)', min: 3, max: 10, default: 5 },
  linkLockMinutes: { label: 'ล็อกเมื่อผิดเกิน (นาที)', min: 5, max: 1440, default: 15 },
  linkGlobalMaxFailures: { label: 'ผิดรวมทั้งร้านก่อนล็อก (ครั้ง)', min: 10, max: 200, default: 30 },
} as const

export const LINE_ABUSE_NUMBER_KEYS = ['interactionMaxPerMinute', 'interactionDuplicateSeconds', 'inquiryMaxPerWindow', 'inquiryWindowMinutes', 'registerCooldownMinutes', 'ownerNoticeCooldownMinutes', 'abuseStrikeLimit', 'abuseWindowMinutes', 'abuseSuspendMinutes'] as const

export type LineNumberOptionKey = keyof typeof LINE_NUMBER_OPTIONS

/** Number options shown on the LINE schedule screen (the link limits stay at their defaults). */
export const LINE_SCHEDULE_NUMBER_KEYS: readonly LineNumberOptionKey[] = ['reminderHour', 'acceptTimeoutMinutes', 'linkInviteTtlHours']

/** Who an invite link is for. */
export type LineInviteKind = 'STAFF' | 'DRIVER' | 'CUSTOMER'
