// Money steps of the return / payment screen happen once (owner 2026-11-12, audit follow-up): within one save every
// step gets a fixed key, so pressing save again after a failure never makes a second fee, return, loss or refund.
// Fees (ค่าเช่ารอบเพิ่ม, ค่าเสียหาย, ค่าสูญหาย = money the customer pays) are created and confirmed in one call.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/db/rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/rpc')>()),
  rpc: (...args: unknown[]) => rpcMock(...args),
}))
vi.mock('@/features/bills/services/bill-storage', () => ({ refreshBillsCache: async () => [], fetchBillByIdFromSupabase: async () => null }))
vi.mock('@/features/products/services/product-storage', () => ({ syncProductsFromSupabase: async () => {} }))
vi.mock('@/features/finance/services/finance-storage', () => ({ refreshFinanceCache: async () => [] }))

// The damage cases of a return are read straight from the table.
const damageCases = [{ id: 'case-1', bill_line_id: 'line-1', quantity: 1 }]
vi.mock('@/lib/supabase/client', () => {
  const query: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'eq']) query[m] = () => query
  query.then = (resolve: (v: unknown) => unknown) => resolve({ data: damageCases, error: null })
  return { createClient: () => query }
})

const calls = (name: string) => rpcMock.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>)

beforeEach(() => {
  rpcMock.mockReset()
  rpcMock.mockImplementation(async (name: string) => {
    if (name === 'return_receive') return { return_id: 'ret-1', return_no: 'R-1', early_return_credit: 0 }
    if (name === 'bill_refund_suggestion') {
      return { suggested_refund: 30, balance_due: -30, payments: [{ payment_id: 'pay-1', method: 'CASH', amount: 100, refundable: 100 }] }
    }
    return {}
  })
})

describe('fixed keys within one save', () => {
  it('ค่าเช่ารอบเพิ่ม: one charge_add per line (create + confirm), key = save key + line', async () => {
    const { chargeExtraRounds } = await import('@/features/bills/services/bill-service')
    await chargeExtraRounds('bill-1', [{ lineId: 'line-1', rounds: 2, quantity: 3, fee: 60 }], 'op-1')
    expect(calls('charge_create')).toHaveLength(0)
    expect(calls('charge_confirm')).toHaveLength(0)
    expect(calls('charge_add')).toEqual([
      expect.objectContaining({ p_bill_id: 'bill-1', p_amount: 60, p_idempotency_key: 'op-1:xr:line-1', p_basis: { kind: 'EXTRA_ROUNDS', rounds: 2, quantity: 3 } }),
    ])
  })

  it('the same save pressed twice sends the same keys (the database returns the first answer)', async () => {
    const { processReturn } = await import('@/features/bills/services/bill-service')
    const save = () =>
      processReturn({
        opKey: 'op-2',
        billId: 'bill-1',
        returnedDay: '2026-11-12',
        items: [
          { lineId: 'line-1', normalQty: 0, damagedQty: 1, lostQty: 0, damageFeePerUnit: 200, lossFeePerUnit: 0 },
          { lineId: 'line-2', normalQty: 0, damagedQty: 0, lostQty: 2, damageFeePerUnit: 0, lossFeePerUnit: 150 },
        ],
      })
    await save()
    await save()
    const keys = (name: string) => calls(name).map((c) => c.p_idempotency_key)
    expect(keys('return_receive')).toEqual(['op-2:ret:2026-11-12', 'op-2:ret:2026-11-12'])
    expect(keys('charge_add')).toEqual(['op-2:dmg:case-1', 'op-2:dmg:case-1'])
    expect(keys('lost_add')).toEqual(['op-2:lost:line-2', 'op-2:lost:line-2'])
  })

  it('ค่าเสียหาย: created, confirmed and the case closed in one call; ค่าสูญหาย: lost + fee in one call', async () => {
    const { processReturn } = await import('@/features/bills/services/bill-service')
    await processReturn({
      opKey: 'op-3',
      billId: 'bill-1',
      items: [
        { lineId: 'line-1', normalQty: 0, damagedQty: 1, lostQty: 0, damageFeePerUnit: 200, lossFeePerUnit: 0 },
        { lineId: 'line-2', normalQty: 0, damagedQty: 0, lostQty: 2, damageFeePerUnit: 0, lossFeePerUnit: 150 },
      ],
    })
    expect(calls('charge_add')[0]).toMatchObject({
      p_charge_type: 'DAMAGE', p_amount: 200, p_incident_case_id: 'case-1', p_resolve_incident: true,
    })
    expect(calls('lost_add')[0]).toMatchObject({ p_bill_line_id: 'line-2', p_quantity: 2, p_amount: 300 })
    for (const old of ['charge_create', 'charge_confirm', 'incident_open', 'lost_record', 'incident_resolve']) {
      expect(calls(old)).toHaveLength(0)
    }
  })

  it('a damage with no fee closes the case without a charge (incident_waive, once)', async () => {
    const { processReturn } = await import('@/features/bills/services/bill-service')
    await processReturn({
      opKey: 'op-4',
      billId: 'bill-1',
      items: [{ lineId: 'line-1', normalQty: 0, damagedQty: 1, lostQty: 0, damageFeePerUnit: 0, lossFeePerUnit: 0 }],
    })
    expect(calls('charge_add')).toHaveLength(0)
    expect(calls('incident_waive')).toEqual([expect.objectContaining({ p_case_id: 'case-1', p_idempotency_key: 'op-4:dmg:case-1' })])
  })

  it('คืนเงินที่ชำระเกิน: key = save key + payment + amount', async () => {
    const { refundOverpayment } = await import('@/features/bills/services/bill-service')
    await refundOverpayment('bill-1', 'op-5')
    expect(calls('refund_pay')).toEqual([expect.objectContaining({ p_payment_id: 'pay-1', p_amount: 30, p_idempotency_key: 'op-5:ovp:pay-1:3000' })])
  })

  it('payment, deposit use, deposit back and เพิ่มมัดจำ take the given key', async () => {
    const svc = await import('@/features/bills/services/bill-service')
    await svc.receivePayment('bill-1', [{ method: 'CASH', amount: 10 }], '2026-11-12', 'op-6:pay')
    await svc.applyDepositToBill('bill-1', 5, '2026-11-12', 'op-6:dep-use')
    await svc.refundDeposit('bill-1', 5, 'CASH', 'op-6:dep-back')
    await svc.addDepositOnce('bill-1', 500, 'เพิ่มมัดจำ', 'op-6:dep-add')
    expect(calls('payment_receive')[0].p_idempotency_key).toBe('op-6:pay')
    expect(calls('bill_deposit_apply')[0].p_idempotency_key).toBe('op-6:dep-use')
    expect(calls('bill_deposit_refund')[0].p_idempotency_key).toBe('op-6:dep-back')
    expect(calls('bill_deposit_add')[0]).toMatchObject({ p_new_deposit_amount: 500, p_idempotency_key: 'op-6:dep-add' })
  })

  it('without a save key each call still gets its own fresh key (other screens keep working)', async () => {
    const { chargeExtraRounds } = await import('@/features/bills/services/bill-service')
    await chargeExtraRounds('bill-1', [{ lineId: 'line-1', rounds: 1, quantity: 1, fee: 10 }])
    expect(String(calls('charge_add')[0].p_idempotency_key)).not.toContain(':xr:')
  })
})
