import { describe, expect, it } from 'vitest'
import type { AuditLogEntry } from '@/features/audits/services/audit-storage'
import type { FullBill } from '@/lib/types/rental-return'
import { billMovementChecks, billMovementText, movementStepOrder } from '@/features/bills/utils/bill-movement'

const log = (action: string, over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: action + Math.random(), userId: 'u', displayName: 'จักรี', action, entityType: 'BILL', entityId: 'b',
  before: null, after: null, correlationId: '', createdAt: '2026-11-11T02:00:00Z', ...over,
})
const billWith = (outstanding: number) =>
  ({ items: [{ itemType: 'RENT', requiresReturn: true, outstandingQty: outstanding }] }) as unknown as Pick<FullBill, 'items'>

describe('การเคลื่อนไหว ticks (owner 2026-11-11)', () => {
  it('one payment ticks once; deposit-only money ticks on its cut row', () => {
    const logs = [
      log('BILL_CONFIRM'),
      log('PAYMENT_RECEIVE', { correlationId: 'c1', amount: 500, channel: 'CASH' }),
      log('PAYMENT_ALLOCATE', { correlationId: 'c1', after: { shipping: 500, outstanding_after: 530 } }),
      log('PAYMENT_ALLOCATE', { correlationId: 'c2', after: { deposit: 300, outstanding_after: 230 } }),
    ]
    expect(billMovementChecks(logs, billWith(2)).map((c) => c.paid)).toEqual([false, true, false, true])
  })

  it('returns: the last one is คืนครบ only when nothing is out; the others are คืนบางส่วน', () => {
    const logs = [log('RETURN_RECEIVE'), log('PAYMENT_RECEIVE'), log('RETURN_RECEIVE')]
    const done = billMovementChecks(logs, billWith(0))
    expect(done.map((c) => [c.partialReturn, c.fullReturn])).toEqual([[true, false], [false, false], [false, true]])
    const stillOut = billMovementChecks(logs, billWith(3))
    expect(stillOut.map((c) => [c.partialReturn, c.fullReturn])).toEqual([[true, false], [false, false], [true, false]])
  })

  it('the รายการ text says what was done in Thai, with amount, quantity and method', () => {
    expect(billMovementText(log('PAYMENT_RECEIVE', { amount: 500, channel: 'CASH,QR' }))).toBe('ชำระเงิน 500.00 บาท (เงินสด + QR Code)')
    expect(billMovementText(log('RETURN_RECEIVE', { after: { lines: [{ quantity: 2 }, { quantity: 3 }] } }))).toBe('คืนของ จำนวน 5')
    expect(billMovementText(log('PAYMENT_ALLOCATE', { after: { shipping: 500, deposit: 0, outstanding_after: 530 } }))).toBe(
      'ตัดชำระตามลำดับ: ค่าขนส่ง 500.00 · ค้างชำระ 530.00'
    )
  })
})

describe('steps saved in the same moment', () => {
  it('follow the work order: draft, bill, goods, money, cut', () => {
    const order = ['PAYMENT_ALLOCATE', 'PAYMENT_RECEIVE', 'BILL_CONFIRM', 'BILL_DRAFT_SAVE'].sort((a, b) => movementStepOrder(a) - movementStepOrder(b))
    expect(order).toEqual(['BILL_DRAFT_SAVE', 'BILL_CONFIRM', 'PAYMENT_RECEIVE', 'PAYMENT_ALLOCATE'])
  })
})
