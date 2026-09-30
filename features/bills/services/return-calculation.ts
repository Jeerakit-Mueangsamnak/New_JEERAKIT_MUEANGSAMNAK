import type { ReturnCalculationResult, ReturnInspectionItem } from '@/lib/types/rental-return'
import {
  addSatang,
  calculateDepositSettlement,
  multiplySatang,
  toBaht,
  toSatang,
} from '@/lib/money'

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

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }

  return timestamp
}

function getInclusiveDays(startDate?: string, endDate?: string): number {
  const start = getCalendarDay(startDate)
  const end = getCalendarDay(endDate)
  if (start === null || end === null || end < start) return 0
  return Math.floor((end - start) / DAY_IN_MILLISECONDS) + 1
}

export function computeItemRentalCalculation(
  item: ReturnInspectionItem,
  dates?: { rentalStartDate?: string; scheduledReturnDate?: string; actualReturnDate?: string },
  _config?: unknown
) {
  const rentalStartDate = item.rentalStartDate || dates?.rentalStartDate
  const scheduledReturnDate = item.scheduledReturnDate || dates?.scheduledReturnDate
  const actualReturnDate = item.actualReturnDate || dates?.actualReturnDate
  const actualRentalDays = getInclusiveDays(rentalStartDate, actualReturnDate)
  const scheduledDay = getCalendarDay(scheduledReturnDate)
  const actualDay = getCalendarDay(actualReturnDate)
  const overdueDays =
    scheduledDay !== null && actualDay !== null && actualDay > scheduledDay
      ? Math.floor((actualDay - scheduledDay) / DAY_IN_MILLISECONDS)
      : 0

  return {
    actualRentalDays,
    overdueDays,
    isOverdue: overdueDays > 0,
    itemRentalFee: 0,
  }
}

export function computeReturnCalculation(
  start: string,
  scheduled: string,
  actual: string,
  items: ReturnInspectionItem[],
  heldDeposit: number,
  deductDeposit: boolean,
  collected: number,
  _config?: unknown,
  billSummary?: { grandTotal: number; paidAmount: number; outstandingAmount: number }
): ReturnCalculationResult {
  let repairTotalSatang = 0
  let replaceTotalSatang = 0

  for (const item of items) {
    repairTotalSatang = addSatang(
      repairTotalSatang,
      multiplySatang(toSatang(item.repairFeePerUnit || 0), item.damagedQty || 0)
    )
    replaceTotalSatang = addSatang(
      replaceTotalSatang,
      multiplySatang(toSatang(item.replacementFeePerUnit || 0), item.lostQty || 0)
    )
  }

  const damageTotalSatang = addSatang(repairTotalSatang, replaceTotalSatang)
  const damageTotal = toBaht(damageTotalSatang)
  const repairTotal = toBaht(repairTotalSatang)
  const replaceTotal = toBaht(replaceTotalSatang)
  const persistedGrand = billSummary?.grandTotal || 0
  const persistedPaid = billSummary?.paidAmount || 0
  const persistedOutstanding = billSummary?.outstandingAmount || 0
  const grandTotalCharge = toBaht(addSatang(toSatang(persistedGrand), damageTotalSatang))
  const actualRentalDays = getInclusiveDays(start, actual)
  const scheduledRentalDays = getInclusiveDays(start, scheduled)
  const scheduledDay = getCalendarDay(scheduled)
  const actualDay = getCalendarDay(actual)
  const lateDays =
    scheduledDay !== null && actualDay !== null && actualDay > scheduledDay
      ? Math.floor((actualDay - scheduledDay) / DAY_IN_MILLISECONDS)
      : 0
  const isEarlyReturn = scheduledDay !== null && actualDay !== null && actualDay < scheduledDay

  let netRefundAmount = 0
  let netAmount = 0

  if (deductDeposit) {
    const settlement = calculateDepositSettlement(heldDeposit, damageTotal)
    netRefundAmount = settlement.refundDue
    netAmount =
      settlement.balanceDue > 0
        ? settlement.balanceDue
        : settlement.refundDue > 0
          ? -settlement.refundDue
          : 0
  } else {
    netAmount = damageTotal
  }

  return {
    actualRentalDays,
    scheduledRentalDays,
    lateDays,
    isEarlyReturn,
    isOverdue: lateDays > 0,
    persistedGrandTotal: persistedGrand,
    persistedPaidAmount: persistedPaid,
    persistedOutstandingAmount: persistedOutstanding,
    actualRentalFee: 0,
    rentalFeeDelta: 0,
    lateFeeTotal: 0,
    totalDamageFee: damageTotal,
    repairFeeTotal: repairTotal,
    replacementFeeTotal: replaceTotal,
    returnChargeDelta: damageTotal,
    grandTotalCharge,
    heldDepositAmount: heldDeposit,
    netAmount,
    deductFromDeposit: deductDeposit,
    actualCollectedAmount: collected,
    netRefundAmount,
    remainingDebtAmount: netAmount > 0 ? Math.max(0, netAmount - collected) : 0,
  }
}
