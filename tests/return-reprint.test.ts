import { describe, expect, it } from 'vitest'
import type { FullBill } from '@/lib/types/rental-return'
import { savedReturnFormData } from '@/features/bills/services/return-reprint'
import { returnFormTotalPayable } from '@/features/documents/utils/transaction-print'

const bill = {
  id: 'b1',
  billNo: 'BL-1',
  customerName: 'ลูกค้า ก',
  customerPhone: '0812345678',
  rentalStartDate: '2026-11-01',
  scheduledReturnDate: '2026-11-05',
  grandTotal: 1300, // rent 1000 + damage 200 + lost 100
  paidAmount: 1000,
  items: [
    { rentalBillItemId: 'L1', productName: 'นั่งร้าน' },
    { rentalBillItemId: 'L2', productName: 'แผ่นพื้น' },
  ],
  charges: [
    { id: 'c1', chargeType: 'DAMAGE', amount: 200, status: 'CONFIRMED', reason: '', incidentCaseId: 'case1', createdAt: '' },
    { id: 'c2', chargeType: 'LOST', amount: 100, status: 'CONFIRMED', reason: '', createdAt: '' },
    { id: 'c3', chargeType: 'DAMAGE', amount: 999, status: 'CANCELLED', reason: '', incidentCaseId: 'case1', createdAt: '' },
  ],
} as unknown as FullBill

const saved = {
  id: 'r1',
  returnNo: 'RT-001',
  returnedAt: '2026-11-04T09:00:00+07:00',
  lines: [
    { id: 'rl1', billLineId: 'L1', quantity: 3, condition: 'NORMAL' },
    { id: 'rl2', billLineId: 'L1', quantity: 1, condition: 'MAJOR_DAMAGE' },
    { id: 'rl3', billLineId: 'L2', quantity: 2, condition: 'NORMAL' },
  ],
}

describe('reprint a saved return on ใบรับคืนบางส่วน', () => {
  it('rows are what came back in that return, with the damage fee of the cases it opened', () => {
    const data = savedReturnFormData(bill, saved, { case1: 'rl2' })
    expect(data.slipNo).toBe('RT-001')
    expect(data.returnDate).toBe('2026-11-04')
    expect(data.items).toEqual([
      { name: 'นั่งร้าน', returnedQty: 4, normalQty: 3, damagedQty: 1, lostQty: 0, damageFee: 200 },
      { name: 'แผ่นพื้น', returnedQty: 2, normalQty: 2, damagedQty: 0, lostQty: 0, damageFee: 0 },
    ])
  })

  it('money is the bill as it stands today: what is left to pay = the bill outstanding, nothing collected now', () => {
    const data = savedReturnFormData(bill, saved, { case1: 'rl2' })
    expect(data).toMatchObject({ rentFee: 1000, damageFee: 300, paidBefore: 1000, depositApplied: 0, collected: 0 })
    expect(returnFormTotalPayable(data)).toBe(300)
  })
})
