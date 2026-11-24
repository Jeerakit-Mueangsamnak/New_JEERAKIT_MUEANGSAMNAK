// ปิดบิลด่วน (owner 2026-11-20): every open part of the bill is settled with the normal server steps, in order —
// goods not delivered (delivered today) → everything back today in normal condition → a deposit
// never received is dropped → the deposit held pays first → the rest in cash → the deposit left back in cash.
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface State {
  lines: Array<{ id: string; remaining: number; outstanding: number }>
  owed: number
  held: number
  unpaidDeposit: number
  closed: boolean
}
let state: State

const billNow = () => ({
  id: 'bill-1',
  billNo: 'BL-1',
  billDate: '2026-11-01',
  rentalStartDate: '2026-11-02',
  items: state.lines.map((l) => ({ rentalBillItemId: l.id, productName: l.id, remainingQty: l.remaining, outstandingQty: l.outstanding })),
  outstandingAmount: state.owed,
  heldDepositAmount: state.held,
  depositOutstanding: state.unpaidDeposit,
  rentalStatus: state.closed ? 'CLOSED' : 'RENTING',
})

const tryClose = () => {
  state.closed = state.lines.every((l) => l.remaining === 0 && l.outstanding === 0) && state.owed === 0 && state.held + state.unpaidDeposit === 0
}

const rpcMock = vi.fn()
vi.mock('@/lib/db/rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/rpc')>()),
  rpc: (...args: unknown[]) => rpcMock(...args),
}))
vi.mock('@/features/bills/services/bill-storage', () => ({ refreshBillsCache: async () => [], fetchBillByIdFromSupabase: async () => billNow() }))
vi.mock('@/features/products/services/product-storage', () => ({ syncStockFromSupabase: async () => [] }))
vi.mock('@/features/finance/services/finance-storage', () => ({ refreshBillMoney: async () => undefined }))
vi.mock('@/features/settings/services/settings-storage', () => ({ activePaymentAccount: () => ({}), loadSystemSettings: () => ({ business: {} }) }))

const names = () => rpcMock.mock.calls.map((c) => c[0] as string)
const args = (name: string) => rpcMock.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>)

beforeEach(() => {
  rpcMock.mockReset()
  rpcMock.mockImplementation(async (name: string, p: Record<string, any>) => {
    if (name === 'delivery_create') {
      for (const l of p.p_lines) {
        const line = state.lines.find((x) => x.id === l.bill_line_id)!
        line.remaining -= l.quantity
        line.outstanding += l.quantity
      }
    }
    if (name === 'return_receive') {
      for (const l of p.p_lines) state.lines.find((x) => x.id === l.bill_line_id)!.outstanding -= l.quantity
      tryClose()
      return { return_id: 'ret-1', return_no: 'RT-1', early_return_credit: 0 }
    }
    if (name === 'bill_deposit_add') {
      state.owed -= state.unpaidDeposit
      state.unpaidDeposit = 0
    }
    if (name === 'bill_deposit_apply') {
      state.owed -= p.p_amount
      state.held -= p.p_amount
      tryClose()
      return { receipt_no: 'RC-D', total_amount: p.p_amount }
    }
    if (name === 'payment_receive') {
      const amount = p.p_tenders.reduce((s: number, t: { amount: number }) => s + t.amount, 0)
      state.owed -= amount
      tryClose()
      return { receipt_no: 'RC-1', total_amount: amount }
    }
    if (name === 'bill_refund_suggestion') return { suggested_refund: 0, balance_due: state.owed, payments: [] }
    if (name === 'bill_deposit_refund') {
      state.held -= p.p_amount
      tryClose()
    }
    return {}
  })
})

describe('ปิดบิลด่วน', () => {
  it('deposit bigger than the debt: delivered and back today, the deposit pays, the rest of it goes back in cash', async () => {
    state = { lines: [{ id: 'L1', remaining: 2, outstanding: 0 }, { id: 'L2', remaining: 0, outstanding: 3 }], owed: 1500, held: 2000, unpaidDeposit: 0, closed: false }
    const { quickCloseBill } = await import('@/features/bills/services/bill-service')
    const r = await quickCloseBill('bill-1', '2026-11-20')

    expect(names().filter((n) => n !== 'bill_refund_suggestion')).toEqual(['delivery_create', 'return_receive', 'bill_deposit_apply', 'bill_deposit_refund'])
    expect(args('delivery_create')[0]).toMatchObject({ p_lines: [{ bill_line_id: 'L1', quantity: 2 }], p_note: 'ปิดบิลด่วน' })
    // Delivered on the day of ปิดบิลด่วน (owner 2026-11-20), not the bill's start day
    expect(String(args('delivery_create')[0].p_delivered_at)).toContain('2026-11-20')
    expect(args('return_receive')[0].p_lines).toEqual([
      { bill_line_id: 'L1', quantity: 2, condition: 'NORMAL' },
      { bill_line_id: 'L2', quantity: 3, condition: 'NORMAL' },
    ])
    expect(String(args('return_receive')[0].p_returned_at)).toContain('2026-11-20')
    expect(args('bill_deposit_apply')[0]).toMatchObject({ p_amount: 1500, p_received_on: '2026-11-20' })
    expect(args('bill_deposit_refund')[0]).toMatchObject({ p_amount: 500, p_method: 'CASH' })
    expect(r).toMatchObject({ closed: true, deliveredQty: 2, returnedQty: 5, depositUsed: 1500, cashReceived: 0, depositBack: 500 })
  })

  it('debt bigger than the deposit: the deposit pays first, the rest is received in cash; nothing to give back', async () => {
    state = { lines: [{ id: 'L1', remaining: 0, outstanding: 0 }], owed: 1500, held: 1000, unpaidDeposit: 0, closed: false }
    const { quickCloseBill } = await import('@/features/bills/services/bill-service')
    const r = await quickCloseBill('bill-1', '2026-11-20')

    expect(names()).not.toContain('delivery_create')
    expect(names()).not.toContain('return_receive')
    expect(args('bill_deposit_apply')[0]).toMatchObject({ p_amount: 1000 })
    expect(args('payment_receive')[0].p_tenders).toEqual([{ method: 'CASH', amount: 500, reference: null }])
    expect(names()).not.toContain('bill_deposit_refund')
    expect(r).toMatchObject({ closed: true, depositUsed: 1000, cashReceived: 500, receiptNo: 'RC-1' })
  })

  it('a deposit agreed but never received is dropped, not collected and handed back', async () => {
    state = { lines: [{ id: 'L1', remaining: 0, outstanding: 1 }], owed: 800, held: 0, unpaidDeposit: 300, closed: false }
    const { quickCloseBill } = await import('@/features/bills/services/bill-service')
    const r = await quickCloseBill('bill-1', '2026-11-20')

    expect(args('bill_deposit_add')[0]).toMatchObject({ p_new_deposit_amount: 0 })
    expect(args('payment_receive')[0].p_tenders).toEqual([{ method: 'CASH', amount: 500, reference: null }])
    expect(names()).not.toContain('bill_deposit_refund')
    expect(r.closed).toBe(true)
  })
})
