import type { FullBill } from '@/lib/types/rental-return'
import { getBillPaymentPresentation, getPaymentStatusPresentation, isCancelledOrVoidBill } from '@/features/bills/utils/bill-list-presentation'

/** Goods the customer has to bring back (sale lines never come back). */
export function summarizeReturnables(bill: Pick<FullBill, 'items'>) {
  const lines = bill.items.filter((item) => item.requiresReturn && item.rentalType !== 'SALE')
  const total = lines.reduce((sum, item) => sum + item.quantity, 0)
  const outstanding = lines.reduce((sum, item) => sum + Math.max(0, item.outstandingQty), 0)
  const returned = lines.reduce((sum, item) => sum + item.returnedQty, 0)
  return { total, returned, outstanding }
}

/** Short Thai date for tables: 4 พ.ย. 69. */
export function shortDateTh(value?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '')
  if (!match) return '-'
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

export const formatBaht =(value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Payment chip of the bill workspace: paid in full = "ชำระครบ"; anything still owed (not paid yet or
 * paid in part) = "ยอดค้าง" with the amount (owner 2026-11-03). Cancelled / void bills show no debt.
 */
export function getWorkspacePaymentChip(
  bill: Pick<FullBill, 'paymentStatus' | 'rentalStatus' | 'serverStatus' | 'refundDueAmount' | 'refundedAmount' | 'outstandingAmount'>
) {
  if (isCancelledOrVoidBill(bill)) return getBillPaymentPresentation(bill)
  if (bill.paymentStatus === 'PAID') {
    return { label: 'ชำระครบ', className: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' }
  }
  if ((bill.paymentStatus === 'UNPAID' || bill.paymentStatus === 'PARTIAL') && bill.outstandingAmount > 0) {
    return {
      label: `ยอดค้าง ${formatBaht(bill.outstandingAmount)}`,
      className: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
    }
  }
  return getPaymentStatusPresentation(bill.paymentStatus)
}

// ─── เช่าต่อ (continuation) of goods that stay with the customer ───────────────────────────

const toDay = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '')
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

const dayString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function addDays(day: string, amount: number): string {
  const date = toDay(day)
  if (!date) return day
  date.setDate(date.getDate() + amount)
  return dayString(date)
}

export interface ContinuationLine {
  fromLineId: string
  quantity: number
  unitPrice: number
  calc: 'PER_DAY' | 'PER_PERIOD'
  periods: number
  startDay: string
  endDay: string
  startAt: string
  endAt: string
  /** quantity × price × periods, for the preview */
  lineTotal: number
}

/**
 * The line of the new (continuation) bill for goods that stay with the customer: same price,
 * starting the day after the previous round ends (Master §17.4: never overlapping).
 * Daily goods run until the end day typed in "วันที่/รอบ" (default: as long as the round just ended);
 * any other goods get the number of rounds typed there, each as long as the old round — with no
 * rounds typed there is no เช่าต่อ for them (null).
 */
export function buildContinuationLine(
  item: {
    rentalBillItemId: string
    rentalType?: string
    rentalStartDate?: string
    scheduledReturnDate?: string
    dailyRate: number
    usageCount?: number
    continueEndDate?: string
    continueRounds?: number
  },
  quantity: number
): ContinuationLine | null {
  const start = toDay(item.rentalStartDate || '')
  const end = toDay(item.scheduledReturnDate || '')
  if (!end || quantity <= 0) return null
  const span = start ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1) : Math.max(1, item.usageCount || 1)
  const startDay = addDays(item.scheduledReturnDate as string, 1)
  const isDaily = item.rentalType === 'DAILY'
  const rounds = Math.floor(item.continueRounds || 0)
  if (item.rentalType !== 'DAILY' && rounds < 1) return null
  const endDay = isDaily
    ? item.continueEndDate || addDays(startDay, span - 1)
    : addDays(startDay, span * rounds - 1)
  // A new round has to end on or after the day it starts.
  const startDate = toDay(startDay)
  const endDate = toDay(endDay)
  if (!startDate || !endDate || endDate < startDate) return null
  const periods = isDaily ? Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1 : rounds
  return {
    fromLineId: item.rentalBillItemId,
    quantity,
    unitPrice: item.dailyRate,
    calc: isDaily ? 'PER_DAY' : 'PER_PERIOD',
    periods,
    startDay,
    endDay,
    startAt: new Date(`${startDay}T00:00:00`).toISOString(),
    endAt: new Date(`${endDay}T23:59:59`).toISOString(),
    lineTotal: Math.round(quantity * item.dailyRate * periods * 100) / 100,
  }
}
