import type { FullBill } from '@/lib/types/rental-return'

type RentalListStatus = FullBill['rentalStatus']
type PaymentListStatus = FullBill['paymentStatus']

const dayNumber = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day))
  const date = new Date(timestamp)
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null
  }
  return timestamp / 86_400_000
}

export function getBillOverdueDays(
  bill: Pick<FullBill, 'rentalStatus' | 'items'>,
  today = new Date()
): number {
  if (!['RENTING', 'EXTENDED', 'PARTIAL_RETURNED'].includes(bill.rentalStatus)) return 0

  const todayNumber = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86_400_000
  return bill.items.reduce((maxDays, item) => {
    if (!item.requiresReturn || item.outstandingQty <= 0) return maxDays
    const scheduledDay = dayNumber(item.scheduledReturnDate)
    return scheduledDay === null ? maxDays : Math.max(maxDays, todayNumber - scheduledDay)
  }, 0)
}

export function getBillListReturnDate(
  bill: Pick<FullBill, 'rentalStatus' | 'items' | 'scheduledReturnDate'>
): string {
  if (!['RENTING', 'EXTENDED', 'PARTIAL_RETURNED'].includes(bill.rentalStatus)) {
    return bill.scheduledReturnDate
  }

  const outstandingDates = bill.items
    .filter((item) => item.requiresReturn && item.outstandingQty > 0 && dayNumber(item.scheduledReturnDate) !== null)
    .map((item) => item.scheduledReturnDate)
    .sort()
  return outstandingDates[0] ?? bill.scheduledReturnDate
}

export function getRentalStatusPresentation(status: RentalListStatus, overdueDays = 0) {
  if (overdueDays > 0) {
    return {
      label: `เกินกำหนด (${overdueDays} วัน)`,
      className: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-300',
    }
  }

  switch (status) {
    case 'DRAFT':
      return { label: 'แบบร่าง', className: 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300' }
    case 'CONFIRMED':
      return { label: 'ยืนยันแล้ว', className: 'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300' }
    case 'RENTING':
      return { label: 'กำลังเช่า', className: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300' }
    case 'EXTENDED':
      return { label: 'เช่าต่อ', className: 'bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300' }
    case 'PARTIAL_RETURNED':
      return { label: 'คืนบางส่วน', className: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300' }
    case 'RETURNED':
      return { label: 'คืนครบแล้ว', className: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' }
    case 'CLOSED':
      return { label: 'ปิดบิล', className: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200' }
    case 'CANCELLED':
      return { label: 'ยกเลิก', className: 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300' }
    case 'VOID':
      return { label: 'โมฆะ', className: 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300' }
  }
}

export const isCancelledOrVoidBill = (bill: Pick<FullBill, 'rentalStatus' | 'serverStatus'>): boolean =>
  ['CANCELLED', 'VOID'].includes(bill.serverStatus || '') || ['CANCELLED', 'VOID'].includes(bill.rentalStatus)

/** A cancelled / void bill is never owed money (Master §20): it leaves "ค้างชำระ". */
export function isOwingBill(bill: Pick<FullBill, 'rentalStatus' | 'serverStatus'>): boolean {
  return !isCancelledOrVoidBill(bill)
}

/** "เช่าต่อ" filter: the bill that moved its goods on, or the continuation bill that took them over. */
export function isExtensionBill(bill: Pick<FullBill, 'rentalStatus' | 'items'>): boolean {
  return bill.rentalStatus === 'EXTENDED' || bill.items.some((item) => (item.carriedInQty || 0) > 0)
}

/**
 * Payment badge for the bill list. Cancelled / void bills show no debt; money taken and not yet
 * paid back shows "รอคืนเงิน" (refunds are their own act — Master §20).
 */
export function getBillPaymentPresentation(
  bill: Pick<FullBill, 'paymentStatus' | 'rentalStatus' | 'serverStatus' | 'refundDueAmount' | 'refundedAmount'>
) {
  if (isCancelledOrVoidBill(bill)) {
    if ((bill.refundDueAmount || 0) > 0) {
      return { label: 'รอคืนเงิน', className: 'bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300' }
    }
    if ((bill.refundedAmount || 0) > 0) return getPaymentStatusPresentation('REFUNDED')
    return { label: '-', className: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' }
  }
  return getPaymentStatusPresentation(bill.paymentStatus)
}

export function getPaymentStatusPresentation(status: PaymentListStatus) {
  switch (status) {
    case 'PAID':
      return { label: 'ชำระแล้ว', className: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' }
    case 'PARTIAL':
      return { label: 'ชำระบางส่วน', className: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300' }
    case 'REFUND_PARTIAL':
      return { label: 'คืนเงินบางส่วน', className: 'bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300' }
    case 'REFUNDED':
      return { label: 'คืนเงินแล้ว', className: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200' }
    case 'UNPAID':
      return { label: 'ค้างชำระ', className: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300' }
  }
}
