import { describe, expect, it } from 'vitest'
import { computeReturnCalculation } from '@/features/bills/services/return-calculation'
import type { ReturnInspectionItem } from '@/lib/types/rental-return'

const item = (over: Partial<ReturnInspectionItem>): ReturnInspectionItem =>
  ({
    rentalBillItemId: 'a', productId: 'p', productCode: '', productName: 'นั่งร้าน', totalQtyInBill: 10, outstandingQty: 10,
    returnQty: 10, normalQty: 10, damagedQty: 0, lostQty: 0, dailyRate: 10, rentalType: 'DAILY', usageCount: 10,
    repairFeePerUnit: 0, replacementFeePerUnit: 0, totalDamageFee: 0, note: '', selected: true,
    rentalStartDate: '2026-11-01', scheduledReturnDate: '2026-11-10', actualReturnDate: '2026-11-10', ...over,
  }) as ReturnInspectionItem

const run = (items: ReturnInspectionItem[]) =>
  computeReturnCalculation('2026-11-01', '2026-11-10', '2026-11-10', items, 0, false, 0, undefined, { grandTotal: 1000, paidAmount: 0, outstandingAmount: 1000 })

describe('return calculation: daily goods use their own return date', () => {
  it('returned on the booked day: no credit', () => {
    expect(run([item({})]).rentalFeeDelta).toBe(0)
  })
  it('daily goods returned 3 days early get the unused days back (10 sets x 10 baht x 3 days)', () => {
    expect(run([item({ actualReturnDate: '2026-11-07' })]).rentalFeeDelta).toBe(-300)
  })
  it('per-round goods ignore a return date', () => {
    expect(run([item({ rentalType: 'NORMAL', actualReturnDate: '2026-11-07' })]).rentalFeeDelta).toBe(0)
  })
})
