import type { AuditLogEntry } from '@/features/audits/services/audit-storage'
import type { FullBill } from '@/lib/types/rental-return'

/** What happened on a bill, in the shop's words (the server's audit action → Thai), owner 2026-11-11. */
export const BILL_MOVEMENT_LABELS: Record<string, string> = {
  BILL_DRAFT_SAVE: 'บันทึกแบบร่างบิล',
  BILL_DRAFT_DELETE: 'ลบบิลร่าง',
  BILL_CONFIRM: 'ออกบิล',
  DELIVERY_CREATE: 'ส่งของ',
  BACKORDER_ALLOCATE: 'จัดสรรของที่ค้างส่ง',
  PAYMENT_RECEIVE: 'ชำระเงิน',
  PAYMENT_ALLOCATE: 'ตัดชำระตามลำดับ',
  PAYMENT_VOID: 'ยกเลิกรายการรับเงิน',
  REFUND_PAY: 'คืนเงิน',
  RETURN_RECEIVE: 'คืนของ',
  EARLY_RETURN_CREDIT: 'คืนก่อนกำหนด (ลดค่าเช่า)',
  LOST_RECORD: 'บันทึกของหาย',
  INCIDENT_OPEN: 'แจ้งของชำรุด/หาย',
  INCIDENT_ASSESS: 'ประเมินความเสียหาย',
  INCIDENT_RESOLVE: 'ปิดเรื่องของชำรุด/หาย',
  INCIDENT_FOUND: 'พบของที่หาย',
  CHARGE_CREATE: 'เพิ่มค่าปรับ/ค่าเสียหาย',
  CHARGE_CONFIRM: 'ยืนยันค่าปรับ/ค่าเสียหาย',
  CHARGE_CANCEL: 'ยกเลิกค่าปรับ/ค่าเสียหาย',
  DEPOSIT_APPLY: 'หักชำระจากมัดจำ',
  DEPOSIT_REFUND: 'คืนมัดจำ',
  RENTAL_CONTINUATION_CREATE: 'เช่าต่อ',
  CARRY_FORWARD_REVERSE: 'ยกเลิกเช่าต่อ',
  BILL_CORRECT: 'แก้ไขรายละเอียดบิล',
  BILL_ADJUST: 'ปรับยอดบิล',
  WRITE_OFF: 'ตัดหนี้สูญ',
  OVERDUE_REVIEW: 'ตรวจบิลเกินกำหนด',
  BILL_RECONCILE: 'คำนวณยอดบิลใหม่',
  BILL_CANCEL: 'ยกเลิกบิล',
  BILL_VOID: 'โมฆะบิล',
  BILL_CLOSE: 'ปิดบิล',
  RESERVATION_CREATE: 'จองสินค้า',
  RESERVATION_RELEASE: 'ปล่อยการจองสินค้า',
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'เงินสด',
  QR: 'QR Code',
  TRANSFER: 'โอนเงิน',
  CARD: 'บัตร',
  OTHER: 'อื่น ๆ',
  DEPOSIT: 'มัดจำ',
}

const baht = (n: unknown) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** One line for the การเคลื่อนไหว table: what was done, with its amount / quantity / method when known. */
export function billMovementText(log: AuditLogEntry): string {
  const label = BILL_MOVEMENT_LABELS[log.action] || log.action
  if (log.action === 'PAYMENT_ALLOCATE' && log.after) {
    const a = log.after as Record<string, unknown>
    const parts = [
      Number(a.sale) > 0 && `ค่าสินค้าขาย ${baht(a.sale)}`,
      Number(a.shipping) > 0 && `ค่าขนส่ง ${baht(a.shipping)}`,
      Number(a.deposit) > 0 && `มัดจำ ${baht(a.deposit)}`,
      Number(a.rental) > 0 && `ค่าเช่า ${baht(a.rental)}`,
      Number(a.other) > 0 && `ค่าปรับ/อื่น ๆ ${baht(a.other)}`,
      `ค้างชำระ ${baht(a.outstanding_after ?? 0)}`,
    ].filter(Boolean)
    return `${label}: ${parts.join(' · ')}`
  }
  const extra: string[] = []
  // ส่งของ / คืนของ keep their lines (quantity per bill line) in the record
  const lines = Array.isArray(log.after?.lines) ? (log.after?.lines as Array<{ quantity?: unknown }>) : null
  const lineQty = lines ? lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0) : 0
  if (log.amount != null && Number(log.amount) !== 0) extra.push(`${baht(log.amount)} บาท`)
  else if (lineQty > 0) extra.push(`จำนวน ${lineQty}`)
  else if (log.quantity != null && Number(log.quantity) !== 0) extra.push(`จำนวน ${Number(log.quantity)}`)
  const methods = (log.channel || '')
    .split(',')
    .map((m) => METHOD_LABELS[m.trim()])
    .filter(Boolean)
  if (methods.length > 0) extra.push(`(${methods.join(' + ')})`)
  return extra.length > 0 ? `${label} ${extra.join(' ')}` : label
}

// Order of steps that the server saves in one moment (same time): the bill first, then goods, then money
const STEP_ORDER: Record<string, number> = {
  BILL_DRAFT_SAVE: 0,
  BILL_CONFIRM: 1,
  DELIVERY_CREATE: 2,
  RETURN_RECEIVE: 3,
  PAYMENT_RECEIVE: 4,
  DEPOSIT_APPLY: 4,
  PAYMENT_ALLOCATE: 5,
  BILL_CLOSE: 9,
}
export const movementStepOrder = (action: string) => STEP_ORDER[action] ?? 6

export interface BillMovementChecks {
  /** ✓ ชำระเงิน: money paid the bill in this step. */
  paid: boolean
  /** ✓ คืนบางส่วน: goods came back and some are still out. */
  partialReturn: boolean
  /** ✓ คืนครบ: the return that brought the last goods back. */
  fullReturn: boolean
}

/**
 * The tick columns of the การเคลื่อนไหว table (owner 2026-11-11), one per row of `logs` (oldest first).
 * One payment ticks once: ชำระเงิน sits on its receipt row (PAYMENT_RECEIVE / DEPOSIT_APPLY); the cut row
 * (PAYMENT_ALLOCATE) ticks only when no receipt row came with it (money that all went to the deposit).
 * คืนครบ = the last return when the bill has nothing out any more; every other return = คืนบางส่วน.
 */
export function billMovementChecks(logs: AuditLogEntry[], bill: Pick<FullBill, 'items'>): BillMovementChecks[] {
  const receiptSteps = new Set(logs.filter((l) => l.action === 'PAYMENT_RECEIVE').map((l) => l.correlationId).filter(Boolean))
  const nothingOut = bill.items
    .filter((i) => i.itemType === 'RENT' || i.requiresReturn)
    .every((i) => (i.outstandingQty ?? 0) <= 0)
  const lastReturn = logs.map((l) => l.action).lastIndexOf('RETURN_RECEIVE')
  return logs.map((l, i) => {
    const isReturn = l.action === 'RETURN_RECEIVE'
    const full = isReturn && i === lastReturn && nothingOut
    return {
      paid:
        l.action === 'PAYMENT_RECEIVE' ||
        l.action === 'DEPOSIT_APPLY' ||
        (l.action === 'PAYMENT_ALLOCATE' && !(l.correlationId && receiptSteps.has(l.correlationId))),
      partialReturn: isReturn && !full,
      fullReturn: full,
    }
  })
}