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

/** Texts the OWNER may reword in Settings › LINE › ข้อความที่ส่งทาง LINE. */
export const LINE_EDITABLE_TEMPLATES: ReadonlyArray<{ key: LineTemplateKey; label: string; to: LineTemplateAudience }> = [
  { key: 'STAFF_NOTICE', label: 'แจ้งเตือนพนักงาน', to: 'พนักงาน' },
  { key: 'TASK_NEW', label: 'สั่งงานใหม่', to: 'คนขับ' },
  { key: 'TASK_ACCEPTED', label: 'ตอบกลับเมื่อรับงาน', to: 'คนขับ' },
  { key: 'TASK_DONE', label: 'ตอบกลับเมื่องานเสร็จ', to: 'คนขับ' },
  { key: 'DRIVER_ACCEPT_REMINDER', label: 'เตือนคนขับที่ยังไม่รับงาน', to: 'คนขับ' },
  { key: 'REGISTER_WELCOME', label: 'ต้อนรับเมื่อเพิ่มเพื่อน (ขอชื่อและเบอร์)', to: 'ลูกค้า' },
  { key: 'REGISTER_RETRY', label: 'ขอชื่อและเบอร์อีกครั้ง', to: 'ลูกค้า' },
  { key: 'LINK_SUCCESS', label: 'ผูก LINE สำเร็จ', to: 'ลูกค้า' },
  { key: 'REGISTER_PHONE_TAKEN', label: 'เบอร์นี้ผูก LINE อื่นแล้ว', to: 'ลูกค้า' },
  { key: 'REGISTER_PENDING', label: 'รอร้านตรวจข้อมูล', to: 'ลูกค้า' },
  { key: 'CUSTOMER_RETURN_REMINDER', label: 'เตือนลูกค้า: ใกล้ครบกำหนดคืน', to: 'ลูกค้า' },
  { key: 'CUSTOMER_DUE_TODAY', label: 'เตือนลูกค้า: ครบกำหนดคืนวันนี้', to: 'ลูกค้า' },
  { key: 'CUSTOMER_OVERDUE', label: 'เตือนลูกค้า: เลยกำหนดคืน', to: 'ลูกค้า' },
  { key: 'CUSTOMER_PAYMENT_DUE', label: 'เตือนลูกค้า: ยอดค้างชำระ', to: 'ลูกค้า' },
  { key: 'CUSTOMER_APPOINTMENT', label: 'เตือนลูกค้า: นัดหมาย', to: 'ลูกค้า' },
  { key: 'CUSTOMER_JOB_STEP', label: 'แจ้งลูกค้า: ความคืบหน้างานส่ง/เก็บ', to: 'ลูกค้า' },
]

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
export const LINE_NUMBER_OPTIONS = {
  reminderHour: { label: 'เริ่มส่งเตือนลูกค้าตั้งแต่ (โมง)', min: 0, max: 23, default: 9 },
  acceptTimeoutMinutes: { label: 'เตือนคนขับถ้ายังไม่รับงานภายใน (นาที)', min: 0, max: 1440, default: 0 },
  linkInviteTtlHours: { label: 'ลิงก์ผูก LINE ใช้ได้นาน (ชั่วโมง)', min: 1, max: 720, default: 72 },
  linkCodeTtlMinutes: { label: 'รหัสผูกแบบพิมพ์ใช้ได้นาน (นาที)', min: 2, max: 60, default: 10 },
  linkMaxFailures: { label: 'ใส่รหัสผิดได้ (ครั้ง)', min: 3, max: 10, default: 5 },
  linkLockMinutes: { label: 'ล็อกเมื่อผิดเกิน (นาที)', min: 5, max: 1440, default: 15 },
  linkGlobalMaxFailures: { label: 'ผิดรวมทั้งร้านก่อนล็อก (ครั้ง)', min: 10, max: 200, default: 30 },
} as const

export type LineNumberOptionKey = keyof typeof LINE_NUMBER_OPTIONS

/** Number options shown on the LINE schedule screen (the link limits stay at their defaults). */
export const LINE_SCHEDULE_NUMBER_KEYS: readonly LineNumberOptionKey[] = ['reminderHour', 'acceptTimeoutMinutes', 'linkInviteTtlHours']

/** Who an invite link is for. */
export type LineInviteKind = 'STAFF' | 'DRIVER' | 'CUSTOMER'
