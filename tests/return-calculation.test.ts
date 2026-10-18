import { describe, expect, it } from 'vitest'
import type { ReturnInspectionItem } from '@/lib/types/rental-return'
import { computeItemRentalCalculation } from '@/features/bills/services/return-calculation'

describe('computeItemRentalCalculation', () => {
  it('uses the current return transaction date instead of a prior partial-return date', () => {
    const item: ReturnInspectionItem = {
      rentalBillItemId: 'line-1',
      productId: 'product-1',
      productName: 'Rental item',
      totalQtyInBill: 1,
      outstandingQty: 1,
      returnQty: 1,
      normalQty: 1,
      damagedQty: 0,
      lostQty: 0,
      dailyRate: 10,
      repairFeePerUnit: 0,
      replacementFeePerUnit: 0,
      totalDamageFee: 0,
      rentalType: 'DAILY',
      usageCount: 10,
      rentalStartDate: '2026-10-01',
      scheduledReturnDate: '2026-10-10',
      actualReturnDate: '2026-10-03',
    }

    expect(computeItemRentalCalculation(item, { actualReturnDate: '2026-10-04' })).toMatchObject({
      actualRentalDays: 4,
      itemRentalFee: 40,
      earlyReturnCredit: 60,
    })
  })
})
