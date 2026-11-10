// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PaymentMethodType } from '@/features/pos/components/payment/PaymentMethodSelector'

vi.mock('@/components/common/ConfirmDialogProvider', () => ({ useConfirm: () => async () => true }))

const rpcMock = vi.fn()
vi.mock('@/lib/db/rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/rpc')>()),
  rpc: (...args: unknown[]) => rpcMock(...args),
}))
vi.mock('@/features/bills/services/bill-storage', () => ({ refreshBillsCache: async () => [] }))
vi.mock('@/features/products/services/product-storage', () => ({ syncProductsFromSupabase: async () => {} }))

afterEach(cleanup)

// Owner 2026-11-09: every payment button works on its own — 1st press chooses it, 2nd press un-chooses it.
describe('payment buttons', () => {
  const setup = async (start: PaymentMethodType | null = null) => {
    const { useSplitPayment } = await import('@/features/pos/hooks/useSplitPayment')
    return renderHook(() => {
      const [method, setMethod] = useState<PaymentMethodType | null>(start)
      const [cash, setCash] = useState('')
      const pay = useSplitPayment({ due: 1000, method, setMethod, cashInput: cash, setCashInput: setCash, unpaidKeepsPart: true })
      return { method, cash, setCash, pay }
    })
  }

  it.each(['CASH', 'QR', 'UNPAID'] as const)('%s: press = chosen, press again = not chosen', async (m) => {
    const { result } = await setup()
    expect(result.current.pay.selectedMethods).toEqual([])
    act(() => result.current.pay.selectMethod(m))
    expect(result.current.pay.selectedMethods).toEqual([m])
    act(() => result.current.pay.selectMethod(m))
    expect(result.current.method).toBeNull()
    expect(result.current.pay.selectedMethods).toEqual([])
  })

  it('un-choosing cash empties the cash box', async () => {
    const { result } = await setup()
    act(() => result.current.pay.selectMethod('CASH'))
    act(() => result.current.setCash('400'))
    act(() => result.current.pay.selectMethod('CASH'))
    expect(result.current.cash).toBe('')
  })

  it('เงินสด + QR Code: both lit; pressing one of them again takes only that one out', async () => {
    const { result } = await setup()
    act(() => result.current.pay.selectMethod('CASH'))
    act(() => result.current.pay.selectMethod('QR'))
    expect(result.current.pay.selectedMethods).toEqual(['CASH', 'QR'])
    act(() => result.current.pay.selectMethod('QR'))
    expect(result.current.pay.selectedMethods).toEqual(['CASH'])
    act(() => result.current.pay.selectMethod('CASH'))
    expect(result.current.pay.selectedMethods).toEqual([])
  })
})

// Owner 2026-11-09: the system works out what was paid too much; ออกบิล records it as given back.
describe('refundOverpayment', () => {
  beforeEach(() => rpcMock.mockReset())

  it('gives back the overpaid amount from the newest payment first, deposit receipts last', async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'bill_refund_suggestion') {
        return {
          suggested_refund: 250,
          balance_due: -250,
          payments: [
            { payment_id: 'old-cash', method: 'CASH', amount: 1000, refundable: 1000 },
            { payment_id: 'deposit', method: 'OTHER', amount: 500, refundable: 500 },
            { payment_id: 'new-qr', method: 'QR', amount: 100, refundable: 100 },
          ],
        }
      }
      return {}
    })
    const { refundOverpayment } = await import('@/features/bills/services/bill-service')
    const r = await refundOverpayment('b1')
    expect(r.amount).toBe(250)
    const refunds = rpcMock.mock.calls.filter((c) => c[0] === 'refund_pay').map((c) => [c[1].p_payment_id, c[1].p_amount])
    expect(refunds).toEqual([['new-qr', 100], ['old-cash', 150]])
  })

  it('nothing paid too much: nothing is recorded', async () => {
    rpcMock.mockResolvedValueOnce({ suggested_refund: 0, balance_due: 0, payments: [] })
    const { refundOverpayment } = await import('@/features/bills/services/bill-service')
    expect((await refundOverpayment('b1')).amount).toBe(0)
    expect(rpcMock.mock.calls.some((c) => c[0] === 'refund_pay')).toBe(false)
  })
})
