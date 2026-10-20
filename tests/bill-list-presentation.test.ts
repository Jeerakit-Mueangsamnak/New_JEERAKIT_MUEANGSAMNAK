import { describe, expect, it } from 'vitest'
import {
  getBillListReturnDate,
  getBillOverdueDays,
  getPaymentStatusPresentation,
  getRentalStatusPresentation,
} from '@/features/bills/utils/bill-list-presentation'
import type { FullBillItem } from '@/lib/types/rental-return'

const makeItem = (overrides: Partial<FullBillItem> = {}): FullBillItem => ({
  rentalBillItemId: 'line-1',
  productId: 'product-1',
  productCode: 'SKU-1',
  productName: 'Rental item',
  quantity: 1,
  returnedQty: 0,
  outstandingQty: 1,
  dailyRate: 100,
  unit: 'piece',
  defaultRepairFee: 0,
  defaultReplacementFee: 0,
  requiresReturn: true,
  rentalStartDate: '2025-01-01',
  scheduledReturnDate: '2025-01-10',
  status: 'RENTING',
  ...overrides,
})

describe('bill list status presentation', () => {
  it.each([
    ['CONFIRMED', 'ยืนยันแล้ว'],
    ['RETURNED', 'คืนครบแล้ว'],
    ['VOID', 'โมฆะ'],
  ] as const)('shows the %s rental status accurately', (status, label) => {
    expect(getRentalStatusPresentation(status).label).toBe(label)
  })

  it('shows returned payment states separately from unpaid bills', () => {
    expect(getPaymentStatusPresentation('REFUND_PARTIAL').label).toBe('คืนเงินบางส่วน')
    expect(getPaymentStatusPresentation('REFUNDED').label).toBe('คืนเงินแล้ว')
  })
})

describe('getBillOverdueDays', () => {
  const today = new Date(2025, 0, 15, 12)

  it('counts the oldest overdue rental line that still has an obligation', () => {
    expect(getBillOverdueDays({
      rentalStatus: 'PARTIAL_RETURNED',
      items: [
        makeItem({ scheduledReturnDate: '2025-01-10' }),
        makeItem({ rentalBillItemId: 'line-2', scheduledReturnDate: '2025-01-12' }),
      ],
    }, today)).toBe(5)
  })

  it('ignores returned, sale, settled, invalid-date, and terminal bill lines', () => {
    const overdueLine = makeItem()
    expect(getBillOverdueDays({ rentalStatus: 'RENTING', items: [
      makeItem({ requiresReturn: false }),
      makeItem({ outstandingQty: 0 }),
      makeItem({ scheduledReturnDate: 'not-a-date' }),
      overdueLine,
    ] }, today)).toBe(5)
    expect(getBillOverdueDays({ rentalStatus: 'RETURNED', items: [overdueLine] }, today)).toBe(0)
    expect(getBillOverdueDays({ rentalStatus: 'CONFIRMED', items: [overdueLine] }, today)).toBe(0)
    expect(getBillOverdueDays({ rentalStatus: 'VOID', items: [overdueLine] }, today)).toBe(0)
  })
})

describe('getBillListReturnDate', () => {
  it('uses the earliest date among rental lines that still have items outstanding', () => {
    expect(getBillListReturnDate({
      rentalStatus: 'PARTIAL_RETURNED',
      scheduledReturnDate: '2025-01-12',
      items: [
        makeItem({ scheduledReturnDate: '2025-01-10' }),
        makeItem({ rentalBillItemId: 'line-2', scheduledReturnDate: '2025-01-12' }),
        makeItem({ rentalBillItemId: 'line-3', outstandingQty: 0, scheduledReturnDate: '2025-01-08' }),
        makeItem({ rentalBillItemId: 'line-4', requiresReturn: false, scheduledReturnDate: '2025-01-07' }),
      ],
    })).toBe('2025-01-10')
  })
})
