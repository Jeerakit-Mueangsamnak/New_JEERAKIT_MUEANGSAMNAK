/**
 * The one way the app writes business data (Master v4.3.1 §2, §34): every change goes
 * through a SECURITY DEFINER RPC that checks menu access, PIN, stock and money rules on the
 * server. Clients only SELECT tables (RLS) and call these functions.
 */
import { createClient } from '@/lib/supabase/client'

export class DbError extends Error {
  /** Server error tag, e.g. PIN_REQUIRED, INSUFFICIENT_STOCK (text before the first ':'). */
  readonly tag: string
  readonly raw: string
  readonly sqlState?: string

  constructor(raw: string, sqlState?: string) {
    super(dbErrorMessage(raw))
    this.name = 'DbError'
    this.raw = raw
    this.tag = raw.split(':')[0].trim()
    this.sqlState = sqlState
  }
}

const MESSAGES: Array<[RegExp, string]> = [
  [/^PIN_REQUIRED/, 'รายการนี้ต้องยืนยันด้วย PIN'],
  [/^PIN_CONFIRMATION_INVALID/, 'การยืนยัน PIN หมดอายุหรือใช้ไปแล้ว กรุณายืนยันใหม่'],
  [/^PIN_NOT_SET/, 'ยังไม่ได้ตั้ง PIN — ตั้ง PIN ที่เมนูตั้งค่าก่อน'],
  [/^PIN_FORMAT/, 'PIN ต้องเป็นตัวเลข 6 หลัก'],
  [/^REAUTH_REQUIRED/, 'กรุณายืนยันตัวตนใหม่ (ลิงก์/รหัสทางอีเมล หรือรหัสผ่าน) ก่อนตั้ง PIN ใหม่'],
  [/^REASON_REQUIRED/, 'กรุณาระบุเหตุผล'],
  [/^FORBIDDEN: OWNER only/, 'เฉพาะเจ้าของร้านเท่านั้น'],
  [/^FORBIDDEN: active member required/, 'บัญชียังไม่ได้รับอนุมัติหรือถูกระงับ'],
  [/^FORBIDDEN: menu/, 'บัญชีนี้ไม่มีสิทธิ์ใช้เมนูนี้'],
  [/^FORBIDDEN/, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้'],
  [/^ACTION_NOT_GRANTED/, 'ยังไม่ได้รับสิทธิ์ทำรายการนี้ — ให้เจ้าของร้านเปิดสิทธิ์ที่หน้า จัดการสิทธิ์'],
  [/^INSUFFICIENT_STOCK/, 'สินค้าในสต็อกไม่พอ'],
  [/^PRODUCT_CANNOT_SELL/, 'สินค้านี้ตั้งค่าให้เช่าอย่างเดียว ยังไม่เปิดขาย'],
  [/^PRODUCT_CANNOT_RENT/, 'สินค้านี้ตั้งค่าให้ขายอย่างเดียว ไม่เปิดให้เช่า'],
  [/^QUOTATION_NOT_CONVERTIBLE/, 'ใบเสนอราคานี้แปลงเป็นบิลไม่ได้ (ถูกใช้ไปแล้วหรือหมดอายุ)'],
  [/^QUOTATION_STATUS_TRANSITION/, 'สถานะใบเสนอราคานี้เปลี่ยนแบบนี้ไม่ได้ (อาจถูกยกเลิกหรือเปิดบิลไปแล้ว)'],
  [/^QUOTATION_NOT_DRAFT|^QUOTATION_ITEMS_LOCKED|^QUOTATION_NOT_EDITABLE/, 'ใบเสนอราคานี้เปิดบิลหรือยกเลิกไปแล้ว แก้ไขไม่ได้ — ใช้คัดลอกเป็นใบใหม่แทน'],
  [/^DOCUMENT_DATE_IN_FUTURE/, 'วันที่เอกสารต้องไม่อยู่ในอนาคต'],
  [/^QUOTATION_EMPTY/, 'ใบเสนอราคายังไม่มีรายการสินค้า'],
  [/^QUOTATION_NOT_FOUND/, 'ไม่พบใบเสนอราคา'],
  [/^EXPENSE_NOT_VOIDABLE|^OTHER_INCOME_NOT_VOIDABLE/, 'รายการนี้ถูกยกเลิกไปแล้ว หรือไม่พบรายการ'],
  [/^CUSTOMER_REQUIRED/, 'บิลเช่าต้องเลือกลูกค้า'],
  [/^CUSTOMER_INACTIVE/, 'ลูกค้ารายนี้ถูกปิดใช้งาน'],
  [/^PRODUCT_INACTIVE/, 'มีสินค้าที่ปิดใช้งานอยู่ในบิล'],
  [/^PRODUCT_CAPABILITY/, 'สินค้าบางรายการตั้งค่าไม่ให้ขาย/ให้เช่าแบบนี้'],
  [/^CREDIT_NOT_ALLOWED|CREDIT_LIMIT_EXCEEDED/, 'ลูกค้ารายนี้ไม่สามารถค้างชำระได้'],
  [/^BILL_NOT_DRAFT/, 'บิลนี้ยืนยันไปแล้ว แก้แบบร่างไม่ได้'],
  [/^BILL_EMPTY/, 'บิลยังไม่มีรายการสินค้า'],
  [/^BILL_NOT_OPEN|BILL_NOT_REFUNDABLE/, 'สถานะบิลไม่อนุญาตให้ทำรายการนี้'],
  [/^REFUND_EXCEEDS/, 'ยอดคืนเงินเกินยอดที่รับมาและยังไม่ได้คืน'],
  [/^PAYMENT_REQUIRED/, 'กรุณาเลือกรายการรับเงินที่จะคืน'],
  [/^PAYMENT_NOT_REFUNDABLE/, 'รายการรับเงินนี้คืนไม่ได้'],
  [/^OVERPAYMENT/, 'ยอดรับเงินเกินยอดค้าง'],
  [/^BILL_NOT_PAYABLE/, 'สถานะบิลไม่อนุญาตให้รับเงิน'],
  [/^TENDERS_REQUIRED/, 'กรุณาระบุช่องทางและจำนวนเงิน'],
  [/^INVALID_METHOD/, 'ช่องทางชำระเงินไม่ถูกต้อง'],
  [/^INVALID_AMOUNT/, 'จำนวนเงินไม่ถูกต้อง'],
  [/^RETURN_EXCEEDS_HELD/, 'จำนวนคืนเกินจำนวนที่ลูกค้ายังถืออยู่'],
  [/^RETURN_BEFORE_DELIVERY/, 'วันรับคืนต้องไม่ก่อนวันส่งของ'],
  [/^DELIVERY_EXCEEDS/, 'จำนวนส่งเกินจำนวนที่จัดสรรไว้'],
  [/^BILL_NOT_DELIVERABLE/, 'สถานะบิลไม่อนุญาตให้ส่งของ'],
  [/^DELIVERED_AT_IN_FUTURE|RETURNED_AT_IN_FUTURE/, 'วันเวลาต้องไม่อยู่ในอนาคต'],
  [/^DUPLICATE|already exists|duplicate key/i, 'ข้อมูลนี้มีอยู่แล้ว'],
  [/^VAT_SETUP_REQUIRED/, 'ต้องกรอกอัตรา VAT และวิธีคิดราคาก่อนเปิด VAT'],
  [/^DISCOUNT_LIMIT/, 'ต้องกรอกเปอร์เซ็นต์จำกัดส่วนลด (0–100)'],
  [/^AUTO_LOCK_OPTION_INVALID/, 'เวลาล็อกแอปไม่อยู่ในตัวเลือก'],
  [/^CANNOT_CHANGE_SELF/, 'ไม่สามารถเปลี่ยนสิทธิ์ของตัวเองได้'],
  [/^IDEMPOTENCY_IN_PROGRESS/, 'รายการนี้กำลังบันทึกอยู่ กรุณารอสักครู่'],
  [/^IDEMPOTENCY/, 'รายการนี้ถูกส่งซ้ำ กรุณาลองใหม่'],
  [/Failed to fetch|NetworkError|fetch failed/i, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (รายการยังไม่ถูกบันทึก)'],
]

export function dbErrorMessage(raw: string): string {
  for (const [re, text] of MESSAGES) {
    if (re.test(raw)) return text
  }
  return raw
}

/** Calls a business RPC; throws DbError with a Thai message on any server refusal. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = createClient()
  // Drop undefined so Postgres defaults apply.
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined))
  // The generated Database type is not wired into the client; RPC names are checked by tests instead.
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    params: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>)(fn, clean)
  if (error) throw new DbError(error.message, error.code)
  return data as T
}

/** Fresh idempotency key per user action (Master §2.5); a retry of the same click reuses it. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function isDbError(err: unknown, tag?: string): err is DbError {
  return err instanceof DbError && (!tag || err.tag === tag)
}

/** Read helper: throws a Thai error instead of returning { error }. */
export async function selectRows<T>(
  query: PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>
): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new DbError(error.message, error.code)
  return data ?? []
}
