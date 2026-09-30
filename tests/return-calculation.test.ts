import { describe, expect, it } from 'vitest'
import {
  computeItemRentalCalculation,
  computeReturnCalculation,
} from '@/features/bills/services/return-calculation'
import type { ReturnInspectionItem } from '@/lib/types/rental-return'

const item: ReturnInspectionItem = {
  rentalBillItemId: 'rental-item-1',
  productId: 'product-1',
  productName: 'Test product',
  totalQtyInBill: 1,
  outstandingQty: 1,
  returnQty: 1,
  normalQty: 1,
  damagedQty: 0,
  lostQty: 0,
  dailyRate: 100,
  repairFeePerUnit: 0,
  replacementFeePerUnit: 0,
  totalDamageFee: 0,
}

describe('rental return calculations', () => {
  it('counts rental dates inclusively and computes late days', () => {
    expect(
      computeItemRentalCalculation(item, {
        rentalStartDate: '2026-04-01',
        scheduledReturnDate: '2026-04-03',
        actualReturnDate: '2026-04-05',
      })
    ).toEqual({
      actualRentalDays: 5,
      overdueDays: 2,
      isOverdue: true,
      itemRentalFee: 0,
    })
  })

  it('counts a same-day return as one rental day without overdue days', () => {
    expect(
      computeItemRentalCalculation(item, {
        rentalStartDate: '2026-04-03',
        scheduledReturnDate: '2026-04-03',
        actualReturnDate: '2026-04-03',
      })
    ).toEqual({
      actualRentalDays: 1,
      overdueDays: 0,
      isOverdue: false,
      itemRentalFee: 0,
    })
  })

  it('keeps invalid and reversed date ranges at zero days', () => {
    expect(
      computeItemRentalCalculation(item, {
        rentalStartDate: '2026-02-30',
        scheduledReturnDate: '2026-04-03',
        actualReturnDate: '2026-04-02',
      }).actualRentalDays
    ).toBe(0)
  })

  it('uses calendar days for the return summary while preserving fee policy', () => {
    const result = computeReturnCalculation(
      '2026-04-01',
      '2026-04-03',
      '2026-04-05',
      [item],
      0,
      false,
      0
    )

    expect(result).toMatchObject({
      actualRentalDays: 5,
      scheduledRentalDays: 3,
      lateDays: 2,
      isOverdue: true,
      isEarlyReturn: false,
      actualRentalFee: 0,
      lateFeeTotal: 0,
    })
  })
})
