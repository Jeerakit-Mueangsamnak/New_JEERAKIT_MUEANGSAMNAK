import { describe, expect, it } from 'vitest'
import { buildContinuationLine, getWorkspacePaymentChip, shortDateTh, summarizeReturnables } from '@/features/bills/utils/bill-workspace'
import type { FullBill } from '@/lib/types/rental-return'

const item = (over: Record<string, unknown>) =>
  ({ quantity: 10, returnedQty: 0, outstandingQty: 10, requiresReturn: true, rentalType: 'NORMAL', ...over }) as unknown as FullBill['items'][number]

const bill = (over: Record<string, unknown> = {}) =>
  ({ paymentStatus: 'UNPAID', rentalStatus: 'RENTING', serverStatus: 'ACTIVE', outstandingAmount: 2200, items: [], ...over }) as unknown as FullBill

describe('bill workspace summary', () => {
  it('counts only goods that come back', () => {
    const result = summarizeReturnables({
      items: [item({ quantity: 15, returnedQty: 5, outstandingQty: 10 }), item({ rentalType: 'SALE' }), item({ requiresReturn: false })],
    })
    expect(result).toEqual({ total: 15, returned: 5, outstanding: 10 })
  })

  it('shows paid in full as ชำระครบ', () => {
    expect(getWorkspacePaymentChip(bill({ paymentStatus: 'PAID', outstandingAmount: 0 })).label).toBe('ชำระครบ')
  })

  it('shows unpaid and part-paid bills as ยอดค้าง with the amount', () => {
    expect(getWorkspacePaymentChip(bill()).label).toBe('ยอดค้าง 2,200.00')
    expect(getWorkspacePaymentChip(bill({ paymentStatus: 'PARTIAL', outstandingAmount: 1200 })).label).toBe('ยอดค้าง 1,200.00')
  })

  it('shows no debt on a cancelled bill', () => {
    expect(getWorkspacePaymentChip(bill({ serverStatus: 'CANCELLED', rentalStatus: 'CANCELLED' })).label).toBe('-')
  })
})

describe('short Thai dates', () => {
  it('writes day, short month and 2-digit Buddhist year', () => {
    expect(shortDateTh('2026-11-04')).toBe('4 พ.ย. 69')
  })
  it('shows a dash when there is no date', () => {
    expect(shortDateTh('')).toBe('-')
    expect(shortDateTh(undefined)).toBe('-')
  })
})

describe('continuation line (เช่าต่อ)', () => {
  const base = { rentalBillItemId: 'l1', rentalStartDate: '2026-11-01', scheduledReturnDate: '2026-11-10', dailyRate: 20, usageCount: 10 }

  it('daily goods: same number of days, starting the day after the old round ends', () => {
    const line = buildContinuationLine({ ...base, rentalType: 'DAILY' }, 5)!
    expect(line).toMatchObject({ calc: 'PER_DAY', periods: 10, startDay: '2026-11-11', endDay: '2026-11-20', quantity: 5, lineTotal: 1000 })
  })

  it('other goods: one more round of the same length', () => {
    const line = buildContinuationLine({ ...base, rentalType: 'NORMAL', continueRounds: 1 }, 5)!
    expect(line).toMatchObject({ calc: 'PER_PERIOD', periods: 1, startDay: '2026-11-11', endDay: '2026-11-20', lineTotal: 100 })
  })

  it('other goods: no rounds typed means no เช่าต่อ', () => {
    expect(buildContinuationLine({ ...base, rentalType: 'NORMAL' }, 5)).toBeNull()
    expect(buildContinuationLine({ ...base, rentalType: 'NORMAL', continueRounds: 0 }, 5)).toBeNull()
  })

  it('daily goods: the end day typed decides how many days', () => {
    const line = buildContinuationLine({ ...base, rentalType: 'DAILY', continueEndDate: '2026-11-15' }, 5)!
    expect(line).toMatchObject({ periods: 5, startDay: '2026-11-11', endDay: '2026-11-15', lineTotal: 500 })
  })

  it('daily goods: an end day before the new round starts is refused', () => {
    expect(buildContinuationLine({ ...base, rentalType: 'DAILY', continueEndDate: '2026-11-10' }, 5)).toBeNull()
  })

  it('other goods: the rounds typed decide the length (each as long as the old round)', () => {
    const line = buildContinuationLine({ ...base, rentalType: 'NORMAL', continueRounds: 3 }, 5)!
    expect(line).toMatchObject({ calc: 'PER_PERIOD', periods: 3, startDay: '2026-11-11', endDay: '2026-12-10', lineTotal: 300 })
  })

  it('crosses a month end correctly and refuses an empty quantity', () => {
    expect(buildContinuationLine({ ...base, scheduledReturnDate: '2026-11-30', rentalType: 'DAILY' }, 1)!.startDay).toBe('2026-12-01')
    expect(buildContinuationLine(base, 0)).toBeNull()
  })
})
