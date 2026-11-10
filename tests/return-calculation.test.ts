import { describe, expect, it } from 'vitest'
import type { ReturnInspectionItem } from '@/lib/types/rental-return'
import { chargedExtraRounds, computeItemRentalCalculation, computeReturnCalculation, extraRoundsFeeOf, extraRoundsOf } from '@/features/bills/services/return-calculation'

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

describe('per-round goods used for more rounds than the bill (owner 2026-11-07)', () => {
  // Paid in full at pickup for 3 rounds; the customer actually used 5 more rounds.
  const roundItem = (over: Partial<ReturnInspectionItem> = {}): ReturnInspectionItem => ({
    rentalBillItemId: 'line-1', productId: 'p-1', productName: 'แบบเสา',
    totalQtyInBill: 10, outstandingQty: 10, returnQty: 10, normalQty: 8, damagedQty: 1, lostQty: 1,
    dailyRate: 15, repairFeePerUnit: 0, replacementFeePerUnit: 0, totalDamageFee: 0,
    rentalType: 'NORMAL', usageCount: 3, continueRounds: 5, selected: true,
    ...over,
  })
  const bill = { grandTotal: 450, paidAmount: 450, outstandingAmount: 0 }

  it('the rounds box on a returned row = extra rounds: rate × every piece out × rounds, added to the rent', () => {
    expect(extraRoundsOf(roundItem())).toBe(5)
    expect(extraRoundsFeeOf(roundItem())).toBe(750) // 15 × 10 × 5
    const calc = computeReturnCalculation('2026-11-01', '2026-11-03', '2026-11-07', [roundItem()], 0, false, 0, undefined, bill)
    expect(calc.extraRoundsFee).toBe(750)
    expect(calc.actualRentalFee).toBe(1200)
    expect(calc.grandTotalCharge).toBe(1200)
    expect(calc.netAmount).toBe(750) // what the customer still pays now
  })

  it('a row that continues (เช่าต่อ) keeps the box for the new bill: nothing extra on this bill', () => {
    expect(extraRoundsOf(roundItem({ continueQty: 2 }))).toBe(0)
    expect(extraRoundsOf(roundItem({ rentalType: 'DAILY' }))).toBe(0)
    const calc = computeReturnCalculation('2026-11-01', '2026-11-03', '2026-11-07', [roundItem({ continueRounds: 0 })], 0, false, 0, undefined, bill)
    expect(calc.extraRoundsFee).toBe(0)
    expect(calc.netAmount).toBe(0)
  })
})

describe('extra rounds with nothing coming back yet (BL-02112569-000002: 10 pieces, 14 ฿/round, 1 round paid)', () => {
  const item: ReturnInspectionItem = {
    rentalBillItemId: 'line-1', productId: 'p-1', productName: 'แบบ',
    totalQtyInBill: 10, outstandingQty: 10, returnQty: 0, normalQty: 0, damagedQty: 0, lostQty: 0,
    dailyRate: 14, repairFeePerUnit: 0, replacementFeePerUnit: 0, totalDamageFee: 0,
    rentalType: 'NORMAL', usageCount: 1, continueRounds: 4, selected: true,
  }

  it('used 5 rounds in all → type 4: 14 × 10 × 4 = 560 to pay, goods still out', () => {
    expect(extraRoundsFeeOf(item)).toBe(560)
    const calc = computeReturnCalculation('2026-11-02', '2026-11-02', '2026-11-07', [item], 0, false, 0, undefined, { grandTotal: 140, paidAmount: 140, outstandingAmount: 0 })
    expect(calc.grandTotalCharge).toBe(700)
    expect(calc.netAmount).toBe(560)
  })

  it('rounds already charged count as rounds of the bill (never charged twice)', () => {
    const charges = [
      { status: 'CONFIRMED', billLineId: 'line-1', basis: { kind: 'EXTRA_ROUNDS', rounds: 4 } },
      { status: 'CONFIRMED', billLineId: 'line-1', basis: null },
      { status: 'CANCELLED', billLineId: 'line-1', basis: { kind: 'EXTRA_ROUNDS', rounds: 9 } },
      { status: 'CONFIRMED', billLineId: 'line-2', basis: { kind: 'EXTRA_ROUNDS', rounds: 2 } },
    ]
    expect(chargedExtraRounds(charges, 'line-1')).toBe(4)
  })
})
