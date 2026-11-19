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
  [/^CUSTOMER_REQUIRED/, 'บิลเช่าต้องเลือกลูกค้าหรือพิมพ์ชื่อลูกค้า'],
  [/^GUEST_NAME_TOO_LONG/, 'ชื่อลูกค้ายาวเกิน 200 ตัวอักษร'],
  // แก้ไขบิล (bill_revise, owner 2026-11-17)
  [/^BILL_NOT_REVISABLE/, 'บิลนี้ปิดหรือยกเลิกแล้ว แก้ไขไม่ได้'],
  [/^BILL_CUSTOMER_LOCKED: credit/, 'บิลเครดิตเปลี่ยนลูกค้าไม่ได้'],
  [/^BILL_CUSTOMER_LOCKED: continuation/, 'บิลที่มีการเช่าต่อเปลี่ยนลูกค้าไม่ได้'],
  [/Could not find the function public\.bill_set_customer/, 'ระบบยังไม่ได้ติดตั้งคำสั่งเปลี่ยนลูกค้าในฐานข้อมูล'],
  [/^LINE_HAS_CONTINUATION/, 'สินค้านี้ผูกกับบิลเช่าต่อ ลดหรือลบไม่ได้ ให้ใช้รับคืน'],
  [/^LINE_HAS_UNITS/, 'สินค้ามีเลขประจำชิ้นที่ลูกค้าถืออยู่ ให้รับคืนก่อนแล้วค่อยลบหรือลดจำนวน'],
  [/^INVALID_LINE/, 'ข้อมูลสินค้าในบิลไม่ถูกต้อง (จำนวน ราคา รอบ หรือวันที่)'],
  [/^INVALID_REVISION/, 'ข้อมูลการแก้ไขบิลไม่ถูกต้อง'],
  [/^INVALID_FEES/, 'ค่าขนส่งน้อยกว่าค่าบริการอื่นที่มีในบิล'],
  [/^INVALID_DISCOUNT/, 'ส่วนลดต้องไม่ติดลบ'],
  [/^INVALID_DOCUMENT_DATE/, 'วันที่ออกเอกสารต้องไม่อยู่ในอนาคต'],
  [/^CUSTOMER_INACTIVE/, 'ลูกค้ารายนี้ถูกปิดใช้งาน'],
  [/^PRODUCT_INACTIVE/, 'มีสินค้าที่ปิดใช้งานอยู่ในบิล'],
  [/^PRODUCT_IN_USE/, 'สินค้านี้มีประวัติการใช้งานแล้ว ลบถาวรไม่ได้ — ใช้ระงับการใช้งานแทน'],
  [/^CUSTOMER_IN_USE/, 'ลูกค้ารายนี้มีประวัติการใช้งานแล้ว ลบถาวรไม่ได้ — ใช้ระงับการใช้งานแทน'],
  [/^CATEGORY_IN_USE/, 'หมวดหมู่นี้ยังมีสินค้าอยู่ ลบถาวรไม่ได้ — ใช้ระงับการใช้งานแทน'],
  [/^UNIT_IN_USE/, 'หน่วยนับนี้ยังมีสินค้าใช้อยู่ ลบถาวรไม่ได้ — ใช้ระงับการใช้งานแทน'],
  [/^PRODUCT_NOT_FOUND/, 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว)'],
  [/^CUSTOMER_NOT_FOUND|^CATEGORY_NOT_FOUND|^UNIT_NOT_FOUND|^BILL_NOT_FOUND/, 'ไม่พบข้อมูลนี้ (อาจถูกลบไปแล้ว)'],
  [/Could not find the function public\.(product_delete|customer_delete|product_category_delete|unit_delete|bill_draft_delete)/, 'ระบบยังไม่ได้ติดตั้งคำสั่งลบนี้ในฐานข้อมูล'],
  [/^BILL_DRAFT_NOT_YOURS/, 'ลบได้เฉพาะบิลร่างที่ตัวเองสร้าง บิลร่างของคนอื่นให้เจ้าของร้านลบ'],
  [/^BILL_DRAFT_LINKED/, 'บิลร่างนี้ผูกกับนัดหมายหรืองาน LINE อยู่ ลบไม่ได้'],
  [/^BILL_IS_DRAFT/, 'บิลนี้ยังเป็นบิลร่าง ใช้ปุ่มลบแทนการยกเลิก'],
  [/^BILL_VOID_OWNER_ONLY/, 'ยกเลิกได้เฉพาะบิลที่ตัวเองเปิดในวันนี้ บิลของคนอื่นหรือบิลข้ามวันต้องให้เจ้าของร้านยกเลิก'],
  [/^PRODUCT_CAPABILITY/, 'สินค้าบางรายการตั้งค่าไม่ให้ขาย/ให้เช่าแบบนี้'],
  [/^CREDIT_NOT_ALLOWED|CREDIT_LIMIT_EXCEEDED/, 'ลูกค้ารายนี้ไม่สามารถค้างชำระได้'],
  [/^BILL_NOT_DRAFT/, 'บิลนี้ยืนยันไปแล้ว แก้แบบร่างไม่ได้'],
  [/^BILL_EMPTY/, 'บิลยังไม่มีรายการสินค้า'],
  [/^BILL_NOT_OPEN|BILL_NOT_REFUNDABLE/, 'สถานะบิลไม่อนุญาตให้ทำรายการนี้'],
  [/^REFUND_EXCEEDS/, 'ยอดคืนเงินเกินยอดที่รับมาและยังไม่ได้คืน'],
  [/^PAYMENT_REQUIRED/, 'กรุณาเลือกรายการรับเงินที่จะคืน'],
  [/^PAYMENT_NOT_REFUNDABLE/, 'รายการรับเงินนี้คืนไม่ได้'],
  [/^OVERPAYMENT/, 'ยอดรับเงินเกินยอดค้าง'],
  [/^DEPOSIT_EXCEEDED/, 'ยอดเกินเงินมัดจำที่ถืออยู่'],
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
  // Every other refusal the database can send, in Thai (owner 2026-11-18: no English code on screen)
  // บิล
  [/^BILL_NOT_VOIDABLE/, 'บิลนี้ยกเลิกไม่ได้ (ยกเลิกได้เฉพาะบิลที่ยืนยันแล้วหรือกำลังเช่าอยู่)'],
  [/^BILL_NOT_CORRECTABLE/, 'บิลนี้แก้ไขไม่ได้ (ยังเป็นบิลร่างหรือไม่พบบิล)'],
  [/^CORRECTION_FIELD_NOT_ALLOWED/, 'แก้ได้เฉพาะหมายเหตุ วันครบกำหนด และมัดจำ — ยอดเงิน วันเช่า และจำนวน ให้ใช้แก้ไขบิลหรือเช่าต่อ'],
  [/^BILL_HAS_CONTINUATION/, 'บิลนี้ถูกเช่าต่อเป็นบิลใหม่แล้ว ให้ยกเลิกบิลใหม่ก่อน'],
  [/^BILL_STATUS_TRANSITION/, 'สถานะบิลเปลี่ยนแบบนี้ไม่ได้'],
  [/^BILL_LINES_LOCKED/, 'บิลยืนยันแล้ว แก้รายการสินค้าตรงไม่ได้ ให้ใช้แก้ไขบิล'],
  [/^BILL_TERMS_IMMUTABLE_AFTER_CONFIRM|^BILL_LINE_TERMS_IMMUTABLE_AFTER_CONFIRM/, 'บิลยืนยันแล้ว เงื่อนไขบิลแก้ตรงไม่ได้ ให้ใช้แก้ไขบิลหรือเช่าต่อ'],
  [/^BILL_LINE_IDENTITY_IMMUTABLE|^BILL_LINEAGE_IMMUTABLE|^BILL_NO_IMMUTABLE|^BILL_SNAPSHOT_IMMUTABLE/, 'ข้อมูลส่วนนี้ของบิลบันทึกถาวรแล้ว แก้ไขไม่ได้'],
  [/^QUOTATION_SNAPSHOT_IMMUTABLE/, 'ข้อมูลส่วนนี้ของใบเสนอราคาบันทึกถาวรแล้ว แก้ไขไม่ได้'],
  [/^LINE_NOT_IN_BILL/, 'ไม่พบสินค้านี้ในบิล (อาจถูกแก้ไปแล้ว) กรุณาเปิดบิลใหม่'],
  [/^CUSTOM_LINE_NAME_REQUIRED/, 'กรุณาพิมพ์ชื่อรายการ'],
  [/^CUSTOM_LINE_PRICE_REQUIRED/, 'กรุณาใส่ราคาของรายการ'],
  [/^INVALID_DEPOSIT/, 'เงินมัดจำต้องไม่ติดลบ'],
  [/^INVALID_VAT_ENABLED|^INVALID_VAT_MODE/, 'ค่า VAT ของบิลไม่ถูกต้อง กรุณาเลือกใหม่'],
  [/^UNKNOWN_FIELDS/, 'ข้อมูลบิลไม่ถูกต้อง กรุณาเปิดหน้าใหม่แล้วลองอีกครั้ง'],
  // เช่าต่อ
  [/^PARENT_BILL_NOT_ACTIVE/, 'บิลเดิมไม่ได้อยู่ระหว่างเช่า จึงเช่าต่อไม่ได้'],
  [/^LINE_NOT_IN_PARENT/, 'ไม่พบสินค้านี้ในบิลเดิม'],
  [/^ITEMS_REQUIRED/, 'กรุณาเลือกสินค้าที่จะเช่าต่อ'],
  [/^CONTINUATION_PERIOD_REQUIRED/, 'กรุณาระบุวันเริ่มและวันคืนของรอบเช่าต่อ (วันคืนต้องหลังวันเริ่ม)'],
  [/^CONTINUATION_OVERLAPS_PREVIOUS_ROUND/, 'วันเริ่มเช่าต่อต้องไม่ก่อนวันคืนของรอบเดิม'],
  [/^CONTINUATION_QTY_EXCEEDS_HELD/, 'จำนวนเช่าต่อเกินจำนวนที่ลูกค้ายังถืออยู่'],
  [/^DAILY_CONTINUATION_MUST_START_NEXT_DAY/, 'สินค้าคิดรายวัน รอบเช่าต่อต้องเริ่มวันถัดจากวันคืนเดิม'],
  [/^MIXED_DUE_LINES/, 'มีสินค้าที่ยังไม่ถึงกำหนดคืนปนอยู่ ให้เช่าต่อแยกรายการ'],
  [/^START_MODE_REQUIRED/, 'เลยกำหนดคืนแล้ว กรุณาเลือกว่าจะเริ่มนับต่อจากวันคืนเดิม หรือจากวันที่อนุมัติ'],
  [/^START_MODE_NOT_APPLICABLE/, 'การเลือกวันเริ่มนับใช้ได้เฉพาะสินค้าที่เลยกำหนดคืนแล้ว'],
  [/^UNITS_REQUIRED/, 'สินค้ามีเลขประจำชิ้น กรุณาเลือกเลขให้ครบตามจำนวน'],
  [/^UNIT_NOT_HELD_BY_LINE/, 'เลขประจำชิ้นที่เลือกไม่ได้อยู่กับรายการนี้'],
  // เงิน
  [/^PAYMENT_DATE_IN_FUTURE/, 'วันที่รับเงินต้องไม่อยู่ในอนาคต'],
  [/^PAYMENT_NOT_FOUND/, 'ไม่พบรายการรับเงินนี้'],
  [/^PAYMENT_NOT_COMPLETED/, 'รายการรับเงินนี้ถูกยกเลิกไปแล้ว'],
  [/^PAYMENT_HAS_REFUNDS/, 'รายการรับเงินนี้มีการคืนเงินแล้ว ยกเลิกไม่ได้'],
  [/^VOID_WOULD_LEAVE_REFUNDS_UNCOVERED/, 'ยกเลิกไม่ได้ เพราะยอดที่คืนลูกค้าไปแล้วจะมากกว่ายอดรับเงินที่เหลือ'],
  [/^METHOD_REQUIRED/, 'กรุณาเลือกช่องทางคืนเงิน'],
  [/^WRITE_OFF_EXCEEDS_BALANCE/, 'ยอดตัดหนี้ต้องมากกว่า 0 และไม่เกินยอดค้าง'],
  [/^CHARGE_NOT_CONFIRMED_ON_BILL|^INCIDENT_NOT_IN_BILL/, 'รายการนี้ไม่อยู่ในบิล'],
  // สินค้าและสต็อก
  [/^PRODUCT_OUT_WITH_CUSTOMER/, 'สินค้านี้ถูกจองหรือลูกค้ายังไม่คืน ลบไม่ได้'],
  [/^ITEM_TYPE_LOCKED/, 'สินค้านี้มีประวัติสต็อกแล้ว เปลี่ยนชนิดสินค้าไม่ได้'],
  [/^UNIT_REQUIRED/, 'กรุณาเลือกหน่วยนับที่ใช้งานอยู่'],
  [/^INVALID_QUANTITY/, 'จำนวนต้องไม่ติดลบ'],
  [/^SERIALIZED_STOCK_VIA_UNITS/, 'สินค้ามีเลขประจำชิ้น ให้เพิ่มสต็อกโดยลงทะเบียนทีละชิ้น'],
  [/^SERIALIZED_ADJUST_NEEDS_ONE_UNIT_AND_BOTH_STATES/, 'สินค้ามีเลขประจำชิ้น ปรับได้ครั้งละ 1 ชิ้น และต้องเลือกสถานะต้นทางกับปลายทาง'],
  [/^UNITS_NOT_ALLOWED_FOR_QUANTITY_PRODUCT/, 'สินค้านับจำนวน ไม่ต้องเลือกเลขประจำชิ้น'],
  [/^STATE_NOT_ADJUSTABLE/, 'สถานะต้นทางกับปลายทางต้องต่างกัน และต้องเป็นสถานะที่ปรับได้'],
  [/^DAMAGED_OR_LOST_CANNOT_GO_STRAIGHT_TO_AVAILABLE/, 'ของชำรุดหรือสูญหายต้องผ่านตรวจสอบหรือซ่อมก่อน จึงจะกลับมาพร้อมใช้'],
  [/^CONVERT_SAME_PRODUCT/, 'สินค้าต้นทางกับปลายทางต้องเป็นคนละตัว'],
  [/^CONVERT_QUANTITY_PRODUCTS_ONLY/, 'แปลงได้เฉพาะสินค้าแบบนับจำนวน'],
  [/^TARGET_PRODUCT_INACTIVE/, 'สินค้าปลายทางถูกปิดใช้งาน'],
  // เอกสาร
  [/^DOCUMENT_NAME_INVALID/, 'ชื่อเอกสารต้องไม่ว่าง และยาวไม่เกิน 100 ตัวอักษร'],
  [/^DOCUMENT_NAME_NOT_FOUND/, 'ไม่พบชื่อเอกสารนี้ (อาจถูกลบไปแล้ว)'],
  [/^DOCUMENT_NAME_TARGET_INVALID|^TEMPLATE_TARGET_INVALID/, 'กลุ่มเอกสารไม่ถูกต้อง (ต้องเป็นเอกสารลูกค้าหรือเอกสารบิล)'],
  [/^TEMPLATE_NOT_FOUND/, 'ไม่พบแบบฟอร์มนี้ (อาจถูกลบไปแล้ว)'],
  [/^TEMPLATE_REQUIRED_FIELDS_INVALID/, 'ข้อมูลแบบฟอร์มไม่ครบ หรือไฟล์ใหญ่เกิน 1 MB'],
  [/^TEMPLATE_(DATA|FIELDS|ID|IDS)_/, 'ข้อมูลแบบฟอร์มไม่ถูกต้อง กรุณาเปิดหน้าใหม่แล้วลองอีกครั้ง'],
  // ตั้งค่า
  [/^VAT_SETUP_INCOMPLETE/, 'ต้องกรอกทั้งอัตรา VAT และวิธีคิดราคา'],
  [/^INVALID_VAT_RATE/, 'อัตรา VAT ต้องมากกว่า 0'],
  [/^INVALID_DOC_NUMBER_FORMAT/, 'รูปแบบเลขเอกสารไม่ถูกต้อง (จำนวนหลักต้องอยู่ระหว่าง 3–10)'],
  [/^UNKNOWN_DOC_TYPE/, 'ไม่รู้จักประเภทเอกสารนี้'],
  [/^INVALID_TIMEZONE/, 'เขตเวลาไม่ถูกต้อง'],
  [/^AUTO_LOCK_DEFAULT_NOT_IN_OPTIONS/, 'เวลาล็อกเริ่มต้นต้องอยู่ในตัวเลือกเวลาล็อก'],
  [/^INVALID_POLICY|^INVALID_NOTIFICATION_PREFS/, 'ค่าที่ตั้งไม่ถูกต้อง กรุณาตรวจตัวเลขแล้วลองใหม่'],
  // สมาชิกและสิทธิ์
  [/^MEMBER_NOT_FOUND/, 'ไม่พบผู้ใช้งานนี้'],
  [/^MEMBER_NOT_ACTIVE/, 'ผู้ใช้งานนี้ยังไม่ได้รับอนุมัติหรือถูกระงับ'],
  [/^GRANTOR_MUST_BE_OWNER|^GRANT_TARGET_MUST_BE_USER/, 'ให้สิทธิ์ได้เฉพาะเจ้าของร้าน และให้ได้เฉพาะพนักงาน'],
  [/^OWNER_HAS_ALL_ACTIONS/, 'เจ้าของร้านทำได้ทุกรายการอยู่แล้ว'],
  [/^UNKNOWN_ACTION/, 'ไม่รู้จักรายการที่ขอสิทธิ์'],
  [/^NO_HARD_DELETE|^INVALID_PENDING_MEMBER_DELETE|^MEMBER_DELETE_NOT_COMPLETED/, 'ลบได้เฉพาะผู้สมัครที่ยังรออนุมัติ'],
  [/^ACTION_REQUIRED|^INVALID_PURPOSE/, 'คำขอยืนยัน PIN ไม่ถูกต้อง กรุณาลองใหม่'],
  // LINE (ฝั่งระบบ)
  [/^LINE_TASK_NOT_OF_SENDER/, 'งานนี้ไม่ได้มอบให้ผู้ส่งข้อความนี้'],
  [/^LINE_(EVENT_ID|EVENT_KIND|SOURCE|USER)_INVALID/, 'ข้อมูลจาก LINE ไม่ถูกต้อง'],
  // ป้องกันประวัติ
  [/^APPEND_ONLY/, 'ข้อมูลประวัติแก้ไขหรือลบไม่ได้'],
  // จากโครงฐานข้อมูลตั้งต้น (baseline)
  [/^BILL_NOT_ADJUSTABLE/, 'บิลนี้ปรับยอดไม่ได้ (ปรับได้เฉพาะบิลที่ยืนยันแล้วหรือกำลังเช่าอยู่)'],
  [/^INVALID_ADJUSTMENT_REVERSAL/, 'รายการปรับยอดนี้ย้อนกลับไม่ได้ (อาจย้อนไปแล้ว)'],
  [/^INVALID_ADJUSTMENT/, 'ยอดปรับต้องมากกว่า 0'],
  [/^CREDIT_EXCEEDS_BILL/, 'ยอดลดหนี้เกินยอดของบิล'],
  [/^ALREADY_REVERSED/, 'รายการนี้ย้อนกลับไปแล้ว'],
  [/^CARRY_FORWARD_NOT_FOUND/, 'ไม่พบรายการยกยอดนี้'],
  [/^CHILD_NO_LONGER_HOLDS_QUANTITY/, 'บิลเช่าต่อรับคืนหรือเช่าต่อไปแล้ว ให้ย้อนรายการเหล่านั้นก่อน'],
  [/^UNIT_NOT_HELD_BY_CHILD/, 'เลขประจำชิ้นนี้ไม่ได้อยู่กับบิลเช่าต่อแล้ว'],
  [/^CARRY_FORWARD_LINE_MISMATCH|^CARRY_FORWARD_NOT_CHILD_OF_PARENT|^CONTINUATION_CUSTOMER_MISMATCH|^ORIGINAL_BILL_MISMATCH/, 'ข้อมูลบิลเช่าต่อไม่ตรงกับบิลเดิม'],
  [/^CHARGE_NOT_FOUND/, 'ไม่พบรายการค่าใช้จ่ายนี้'],
  [/^CHARGE_NOT_PENDING|^CHARGE_NOT_CANCELLABLE/, 'รายการค่าใช้จ่ายนี้ยืนยันหรือยกเลิกไปแล้ว'],
  [/^RENTAL_LINE_NOT_FOUND|^NOT_A_RENTAL_LINE_OF_BILL/, 'ไม่พบสินค้าเช่านี้ในบิล'],
  [/^CONDITION_REQUIRED/, 'กรุณาเลือกสภาพสินค้าที่รับคืน'],
  [/^RETURN_EMPTY/, 'ยังไม่ได้ใส่จำนวนรับคืน'],
  [/^DELIVERY_EMPTY/, 'ยังไม่ได้ใส่จำนวนส่งของ'],
  [/^MISSING_EXCEEDS_HELD/, 'จำนวนที่แจ้งหายเกินจำนวนที่ลูกค้าถืออยู่'],
  [/^LOST_QUANTITY_INVALID/, 'จำนวนสูญหายไม่ถูกต้อง (ต้องไม่เกินจำนวนที่แจ้งไว้)'],
  [/^NOT_AN_OPEN_MISSING_CASE/, 'ไม่พบรายการแจ้งของหายที่ยังเปิดอยู่'],
  [/^INVALID_INCIDENT_TYPE/, 'ประเภทเหตุการณ์ไม่ถูกต้อง'],
  [/^INCIDENT_NOT_OPEN/, 'เหตุการณ์นี้ปิดไปแล้ว'],
  [/^INCIDENT_HAS_PENDING_CHARGE/, 'ยังมีค่าใช้จ่ายรอยืนยันในเหตุการณ์นี้ ให้ยืนยันหรือยกเลิกก่อน'],
  [/^CONFIRMED_LOST_CANNOT_BE_REJECTED/, 'ของที่ยืนยันว่าสูญหายแล้ว ปฏิเสธไม่ได้'],
  [/^COUNT_NOT_OPEN/, 'รอบตรวจนับนี้ปิดไปแล้ว'],
  [/^COUNT_NOT_COUNTED/, 'ยังตรวจนับไม่ครบ'],
  [/^COUNT_LINE_NOT_FOUND/, 'ไม่พบสินค้านี้ในรอบตรวจนับ'],
  [/^DISCREPANCY_REASON_REQUIRED/, 'สินค้าที่นับได้ไม่ตรง ต้องใส่เหตุผล'],
  [/^PRODUCT_NOT_QUANTITY_OR_INACTIVE/, 'รับเข้าได้เฉพาะสินค้านับจำนวนที่ใช้งานอยู่'],
  [/^PRODUCT_NOT_SERIALIZED/, 'สินค้านี้ไม่ได้ใช้เลขประจำชิ้น หรือถูกปิดใช้งาน'],
  [/^UNIT_STATE_INVALID/, 'สถานะของเลขประจำชิ้นนี้ทำรายการนี้ไม่ได้'],
  [/^UNIT_IDENTITY_IMMUTABLE/, 'เลขประจำชิ้นแก้ไขไม่ได้'],
  [/^STOCK_MOVE_NEEDS_STATE/, 'ต้องระบุสถานะสต็อกต้นทางหรือปลายทาง'],
  [/^QUOTATION_NOT_OPEN/, 'ใบเสนอราคานี้ปิดไปแล้ว จองสินค้าไม่ได้'],
  [/^RESERVATION_EXPIRY_REQUIRED/, 'วันหมดอายุการจองต้องอยู่ในอนาคต'],
  [/^RESERVATION_NOT_ACTIVE/, 'การจองนี้ถูกปล่อยหรือหมดอายุไปแล้ว'],
  [/^PAYMENT_IMMUTABLE|^PAYMENT_STATUS_TRANSITION/, 'รายการรับเงินบันทึกถาวรแล้ว แก้ไขไม่ได้'],
  [/^DOCUMENT_NOT_FOUND/, 'ไม่พบเอกสารนี้'],
  [/^CONTRACT_CONTENT_IMMUTABLE/, 'เนื้อหาสัญญาแก้ไขไม่ได้ ให้สร้างเอกสารใหม่แทน'],
  [/^DOCUMENT_SEQUENCE_NO_RECYCLE/, 'เลขเอกสารย้อนกลับไม่ได้'],
  [/^NOTIFICATION_NOT_FOUND/, 'ไม่พบการแจ้งเตือนนี้'],
  [/^INVALID_INITIAL_STATUS/, 'สถานะเริ่มต้นของนัดหมายไม่ถูกต้อง'],
  [/^USE_RESCHEDULE_OR_SET_STATUS/, 'เปลี่ยนเวลาหรือสถานะนัดหมายให้ใช้ปุ่มเลื่อนนัดหรือปุ่มเปลี่ยนสถานะ'],
  [/^GRANT_REQUIRES_OWNER|^MENU_OWNER_ONLY/, 'เมนูนี้ให้สิทธิ์ได้เฉพาะเจ้าของร้าน'],
  [/^UNKNOWN_MENU_CODE/, 'ไม่รู้จักเมนูนี้'],
  [/^OWNER_ALREADY_EXISTS/, 'ร้านนี้มีเจ้าของร้านแล้ว'],
  [/Failed to fetch|NetworkError|fetch failed/i, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (รายการยังไม่ถูกบันทึก)'],
  [/(JWT|api key|apikey|Invalid API key|invalid claim)/i, 'การเชื่อมต่อฐานข้อมูลไม่ถูกต้อง (คีย์ระบบ) — แจ้งเจ้าของร้านตรวจสอบการตั้งค่า'],
  [/statement timeout|canceling statement/i, 'ฐานข้อมูลใช้เวลานานเกินกำหนด — กรุณาลองใหม่ด้วยรายการที่เล็กลง'],
  [/timeout|timed out|ETIMEDOUT/i, 'เซิร์ฟเวอร์ตอบช้ากว่าปกติ — กรุณาลองใหม่อีกครั้ง'],
  [/row-level security|violates row-level security/i, 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลรายการนี้'],
]

export function dbErrorMessage(raw: string): string {
  for (const [re, text] of MESSAGES) {
    if (re.test(raw)) return text
  }
  // Thai text from the server is shown as it is; anything else never reaches the screen in English
  if (/[฀-๿]/.test(raw)) return raw
  const code = raw.match(/^[A-Z][A-Z0-9_]{3,}/)?.[0]
  return code ? `ทำรายการไม่สำเร็จ (รหัส ${code}) กรุณาลองใหม่ หรือแจ้งเจ้าของร้าน` : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
}

/** Calls a business RPC; throws DbError with a Thai message on any server refusal. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = createClient()
  // Drop undefined so Postgres defaults apply.
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined))
  // The generated Database type is not wired into the client; RPC names are checked by tests instead.
  const screen = currentScreen()
  const call = (supabase.rpc as unknown as (
    name: string,
    params: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> & {
    setHeader?: (name: string, value: string) => unknown
  })(fn, clean)
  // The audit log stores which screen the change came from (public._request_screen).
  if (screen) call.setHeader?.('x-app-screen', screen)
  const { data, error } = await call
  if (error) {
    // The failed transaction rolled back its own audit row; record the refusal separately.
    if (!NO_FAILURE_AUDIT.has(fn)) {
      void supabase.rpc('audit_log_failure', { p_rpc: fn, p_error: error.message, p_screen: screen }).then(
        () => undefined,
        () => undefined
      )
    }
    throw new DbError(error.message, error.code)
  }
  return data as T
}

/** PIN checks, the failure logger itself and read-only totals are not logged as failed actions. */
const NO_FAILURE_AUDIT = new Set(['audit_log_failure', 'verify_pin', 'set_pin', 'owner_recover_pin', 'finance_statement_opening_balance'])

function currentScreen(): string | null {
  if (typeof window === 'undefined') return null
  return encodeURI(window.location.pathname).slice(0, 200)
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

/** PostgREST keeps the URL short: at most this many ids per `in (...)` filter. */
export const IDS_PER_QUERY = 100

/**
 * Reads rows for a list of ids in chunks of IDS_PER_QUERY (in parallel), so a long list never makes a URL the
 * server refuses. Empty / repeated ids are skipped. The one shared helper (was copied in 4 repositories).
 */
export async function readByIds<T>(ids: ReadonlyArray<string | null | undefined>, read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += IDS_PER_QUERY) chunks.push(unique.slice(i, i + IDS_PER_QUERY))
  return (await Promise.all(chunks.map(read))).flat()
}

/** The most rows the database returns for one request (Supabase default max rows). */
export const READ_PAGE_SIZE = 1000

/**
 * Reads every row of a list, page by page, so nothing is silently cut at the 1,000-row limit.
 * `makeQuery` builds the query afresh for each page; `tiebreak` columns (the primary key) are added
 * to the ordering so the pages never overlap or skip a row.
 */
export async function selectAllRows<T>(
  makeQuery: () => any,
  tiebreak: string[] = ['id']
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += READ_PAGE_SIZE) {
    let query = makeQuery()
    for (const column of tiebreak) query = query.order(column, { ascending: true })
    const page = await selectRows<T>(query.range(from, from + READ_PAGE_SIZE - 1))
    rows.push(...page)
    if (page.length < READ_PAGE_SIZE) return rows
  }
}
