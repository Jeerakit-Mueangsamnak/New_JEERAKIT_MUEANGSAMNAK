import type { ReturnCalculationResult, ReturnInspectionItem } from '@/lib/types/rental-return'
import { addSatang, multiplySatang, toBaht, toSatang } from '@/lib/money'

/**
 * On-screen PREVIEW of a return (Master v4.3.1 §14–§16). The server recalculates the real
 * amounts when the return is saved; this only mirrors the same rules so staff see the
 * expected result first:
 * - no late fee exists (overdue = notice + phone call + continuation);
 * - daily items returned early are charged on the days actually used (first day = day 1);
 *   per-round items are one round — dates are reminders only, early return changes nothing;
 * - damage / lost fees are what staff confirm (prefilled from the product defaults);
 * - the deposit is never deducted (it is only shown).
 */

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000

function getCalendarDay(value?: string): number | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null
  return timestamp
}

function getInclusiveDays(startDate?: string, endDate?: string): number {
  const start = getCalendarDay(startDate)
  const end = getCalendarDay(endDate)
  if (start === null || end === null || end < start) return 0
  return Math.floor((end - start) / DAY_IN_MILLISECONDS) + 1
}

const returnedQtyOf = (item: ReturnInspectionItem) => (item.normalQty || 0) + (item.damagedQty || 0)

/** Rent for one item as it will stand after this return (preview). */
export function computeItemRentalCalculation(
  item: ReturnInspectionItem,
  dates?: { rentalStartDate?: string; scheduledReturnDate?: string; actualReturnDate?: string },
  _config?: unknown
) {
  const rentalStartDate = item.rentalStartDate || dates?.rentalStartDate
  const scheduledReturnDate = item.scheduledReturnDate || dates?.scheduledReturnDate
  const actualReturnDate = dates?.actualReturnDate ?? item.actualReturnDate
  const actualRentalDays = Math.max(1, getInclusiveDays(rentalStartDate, actualReturnDate))
  const scheduledDay = getCalendarDay(scheduledReturnDate)
  const actualDay = getCalendarDay(actualReturnDate)
  const overdueDays =
    scheduledDay !== null && actualDay !== null && actualDay > scheduledDay
      ? Math.floor((actualDay - scheduledDay) / DAY_IN_MILLISECONDS)
      : 0
  const periods = Math.max(1, item.usageCount || 1)
  const qty = returnedQtyOf(item) || item.outstandingQty || 0
  const isDaily = item.rentalType === 'DAILY'
  const billedDays = isDaily ? Math.min(periods, actualRentalDays) : periods
  const itemRentalFee = toBaht(multiplySatang(toSatang(item.dailyRate || 0), qty * billedDays))
  const unusedDays = isDaily ? Math.max(0, periods - actualRentalDays) : 0
  const earlyReturnCredit = toBaht(multiplySatang(toSatang(item.dailyRate || 0), returnedQtyOf(item) * unusedDays))

  return {
    actualRentalDays,
    overdueDays,
    isOverdue: overdueDays > 0,
    itemRentalFee,
    unusedDays,
    earlyReturnCredit,
  }
}

export function computeReturnCalculation(
  start: string,
  scheduled: string,
  actual: string,
  items: ReturnInspectionItem[],
  heldDeposit: number,
  _deductDeposit: boolean,
  collected: number,
  _config?: unknown,
  billSummary?: { grandTotal: number; paidAmount: number; outstandingAmount: number }
): ReturnCalculationResult {
  let repairTotalSatang = 0
  let replaceTotalSatang = 0
  let creditSatang = 0

  for (const item of items) {
    repairTotalSatang = addSatang(repairTotalSatang, multiplySatang(toSatang(item.repairFeePerUnit || 0), item.damagedQty || 0))
    replaceTotalSatang = addSatang(replaceTotalSatang, multiplySatang(toSatang(item.replacementFeePerUnit || 0), item.lostQty || 0))
    const calc = computeItemRentalCalculation(item, { rentalStartDate: start, scheduledReturnDate: scheduled, actualReturnDate: actual })
    creditSatang = addSatang(creditSatang, toSatang(calc.earlyReturnCredit))
  }

  const damageTotalSatang = addSatang(repairTotalSatang, replaceTotalSatang)
  const damageTotal = toBaht(damageTotalSatang)
  const credit = toBaht(creditSatang)
  const persistedGrand = billSummary?.grandTotal || 0
  const persistedPaid = billSummary?.paidAmount || 0
  const persistedOutstanding = billSummary?.outstandingAmount || 0
  const grandTotalCharge = toBaht(addSatang(addSatang(toSatang(persistedGrand), damageTotalSatang), -creditSatang))
  const actualRentalDays = getInclusiveDays(start, actual)
  const scheduledRentalDays = getInclusiveDays(start, scheduled)
  const scheduledDay = getCalendarDay(scheduled)
  const actualDay = getCalendarDay(actual)
  const lateDays =
    scheduledDay !== null && actualDay !== null && actualDay > scheduledDay
      ? Math.floor((actualDay - scheduledDay) / DAY_IN_MILLISECONDS)
      : 0
  const isEarlyReturn = scheduledDay !== null && actualDay !== null && actualDay < scheduledDay
  // > 0: customer still owes; < 0: customer overpaid → refund suggested (a separate PIN act)
  const netAmount = toBaht(addSatang(toSatang(grandTotalCharge), -toSatang(persistedPaid)))

  return {
    actualRentalDays,
    scheduledRentalDays,
    lateDays,
    isEarlyReturn,
    isOverdue: lateDays > 0,
    persistedGrandTotal: persistedGrand,
    persistedPaidAmount: persistedPaid,
    persistedOutstandingAmount: persistedOutstanding,
    actualRentalFee: toBaht(addSatang(toSatang(persistedGrand), -creditSatang)),
    rentalFeeDelta: credit > 0 ? -credit : 0,
    lateFeeTotal: 0,
    totalDamageFee: damageTotal,
    repairFeeTotal: toBaht(repairTotalSatang),
    replacementFeeTotal: toBaht(replaceTotalSatang),
    returnChargeDelta: toBaht(addSatang(damageTotalSatang, -creditSatang)),
    grandTotalCharge,
    heldDepositAmount: heldDeposit,
    netAmount,
    deductFromDeposit: false,
    actualCollectedAmount: collected,
    netRefundAmount: netAmount < 0 ? -netAmount : 0,
    remainingDebtAmount: netAmount > 0 ? Math.max(0, netAmount - collected) : 0,
  }
}
