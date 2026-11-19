// @vitest-environment jsdom
process.env.TZ = 'Asia/Bangkok'

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const fake = vi.hoisted(() => ({
  rpcCalls: [] as string[],
  rpcArgs: [] as Array<Record<string, unknown>>,
  cancelError: null as unknown,
  voids: 0,
}))

vi.mock('@/lib/db/rpc', async (orig) => ({
  ...(await orig<object>()),
  rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    fake.rpcCalls.push(fn)
    fake.rpcArgs.push(args)
    if (fn === 'payment_receive') return { receipt_no: 'RCPT-1', total_amount: 25 }
    return {}
  }),
}))
vi.mock('@/lib/db/pin-confirm', async (orig) => {
  const real = await orig<typeof import('@/lib/db/pin-confirm')>()
  return {
    ...real,
    // bill_cancel goes through here: the test decides how it ends
    withPinIfRequired: vi.fn(async () => {
      if (fake.cancelError) throw fake.cancelError
      return {}
    }),
    withPin: vi.fn(async (req: { action: string }, run: (t: string) => Promise<unknown>) => {
      if (req.action === 'BILL_VOID') fake.voids++
      return run('pin-token')
    }),
  }
})
vi.mock('@/features/bills/services/bill-storage', async (orig) => ({
  ...(await orig<object>()),
  refreshBillsCache: vi.fn(async () => []),
  fetchBillByIdFromSupabase: vi.fn(async () => null),
}))
vi.mock('@/features/products/services/product-storage', async (orig) => ({
  ...(await orig<object>()),
  syncStockFromSupabase: vi.fn(async () => []),
}))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/features/settings/api/settings-repository', () => ({
  fetchSharedSystemConfig: vi.fn(async () => null),
  saveSharedSystemConfig: vi.fn(async () => {}),
}))

import { cancelOrVoidBill, receivePayment } from '@/features/bills/services/bill-service'
import { PinCancelledError } from '@/lib/db/pin-confirm'
import { DbError } from '@/lib/db/rpc'
import { calculateBillTotals } from '@/lib/calculation-service'
import { DEFAULT_SYSTEM_CONFIG, setCachedSystemSettings } from '@/features/settings/services/settings-storage'
import { buildRevision } from '@/features/bills/components/BillRevisionView'
import { CartPanel } from '@/features/pos/components/CartPanel'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import { CartItem, loadActiveCart } from '@/features/pos/services/cart-storage'
import type { FullBill } from '@/lib/types/rental-return'

beforeEach(() => {
  fake.rpcCalls = []
  fake.rpcArgs = []
  fake.cancelError = null
  fake.voids = 0
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('P1-B5 a cancelled PIN ends the cancel — no Void afterwards', () => {
  const bill = { id: 'b1', serverStatus: 'CONFIRMED' as const }

  it('PIN cancelled on "ยกเลิกบิล": stops, no Void PIN, no Void call', async () => {
    fake.cancelError = new PinCancelledError()
    await expect(cancelOrVoidBill(bill, 'ลูกค้ายกเลิก')).rejects.toBeInstanceOf(PinCancelledError)
    expect(fake.voids).toBe(0)
    expect(fake.rpcCalls).not.toContain('bill_void')
  })

  it('server says the bill has transactions: moves on to Void (unchanged)', async () => {
    fake.cancelError = new DbError('BILL_HAS_TRANSACTIONS: use bill_void')
    await cancelOrVoidBill(bill, 'ลูกค้ายกเลิก')
    expect(fake.voids).toBe(1)
    expect(fake.rpcCalls).toContain('bill_void')
  })

  it('any other error (even with "ยกเลิก"/"สถานะบิล" in its text) is shown, not turned into a Void', async () => {
    fake.cancelError = new DbError('BILL_NOT_OPEN')
    await expect(cancelOrVoidBill(bill, 'x')).rejects.toBeInstanceOf(DbError)
    fake.cancelError = new Error('ยกเลิกไม่ได้ สถานะบิลไม่ถูกต้อง')
    await expect(cancelOrVoidBill(bill, 'x')).rejects.toThrow()
    expect(fake.voids).toBe(0)
  })
})

describe('bill payment receipt response', () => {
  it('sends the selected receive day and returns the server receipt number', async () => {
    const result = await receivePayment('bill-1', [{ method: 'CASH', amount: 25 }], '2026-10-05')

    expect(fake.rpcArgs[0]).toMatchObject({
      p_bill_id: 'bill-1',
      p_received_on: '2026-10-05',
    })
    expect(result).toMatchObject({ receiptNo: 'RCPT-1', totalAmount: 25 })
  })
})

describe('P1-B4 checkout shows the discount the server charges', () => {
  const settings = {
    ...DEFAULT_SYSTEM_CONFIG,
    taxDiscount: { ...DEFAULT_SYSTEM_CONFIG.taxDiscount, discountLimitEnabled: true, discountLimitPercent: 10 },
  }
  it('a discount over the limit is kept (PIN at save), not cut, and flagged', () => {
    const t = calculateBillTotals({ settings, items: [{ lineTotal: 1000 }], discount: 300 })
    expect(t.discountAmount).toBe(300)
    expect(t.grandTotal).toBe(700)
    expect(t.isDiscountExceeded).toBe(true)
  })
  it('within the limit nothing changes', () => {
    const t = calculateBillTotals({ settings, items: [{ lineTotal: 1000 }], discount: 50 })
    expect(t).toMatchObject({ discountAmount: 50, grandTotal: 950, isDiscountExceeded: false })
  })
  it('VAT is computed on the full discount the server uses', () => {
    const vat = { ...settings, taxDiscount: { ...settings.taxDiscount, vatRate: 7, vatMode: 'EXCLUSIVE' as const } }
    const t = calculateBillTotals({ settings: vat, items: [{ lineTotal: 1000 }], discount: 300, enableVat: true })
    expect(t.vatAmount).toBe(49)
    expect(t.grandTotal).toBe(749)
  })
})

describe('แก้ไขบิล sends only what changed (bill_revise)', () => {
  const bill = {
    rentalStartDate: '2026-11-16',
    scheduledReturnDate: '2026-11-19',
    discountAmount: 20,
    billDiscountAmount: 20,
    shippingFee: 50,
    items: [
      { rentalBillItemId: 'L1', rentalType: 'NORMAL', dailyRate: 20, quantity: 2, usageCount: 1, lineTotal: 40, rentalStartDate: '2026-11-16', scheduledReturnDate: '2026-11-19' },
      { rentalBillItemId: 'L2', rentalType: 'SALE', dailyRate: 100, quantity: 1, lineTotal: 100 },
    ],
  } as unknown as FullBill
  const header = { start: '2026-11-16', end: '2026-11-19' }
  const line = (id: string, over: Record<string, unknown> = {}) => ({
    rentalBillItemId: id, productId: 'p', rentalType: id === 'L2' ? ('SALE' as const) : ('NORMAL' as const),
    quantity: id === 'L2' ? 1 : 2, unitPrice: id === 'L2' ? 100 : 20, usageCount: 1,
    dailyStartDate: '2026-11-16', dailyEndDate: '2026-11-19', action: 'UPDATE' as const, ...over,
  })

  it('nothing edited → every line by id only, discount and fees as on the bill', () => {
    expect(buildRevision(bill, [line('L1'), line('L2')], header, 20, 50)).toEqual({
      billDiscountAmount: 20, feesTotal: 50, lines: [{ line_id: 'L1' }, { line_id: 'L2' }],
    })
  })
  it('a removed line is not sent; changed quantity and price are', () => {
    const r = buildRevision(bill, [line('L1', { quantity: 3, unitPrice: 25 }), line('L2', { action: 'REMOVE' })], header, 20, 50)
    expect(r.lines).toEqual([{ line_id: 'L1', ordered_qty: 3, unit_price: 25 }])
  })
  it('an added rental line carries its own terms', () => {
    const r = buildRevision(bill, [line('L1'), line('L2'), { ...line('', { usageCount: 2 }), rentalBillItemId: undefined, action: 'ADD' as const }], header, 20, 50)
    expect(r.lines[2]).toMatchObject({ product_id: 'p', line_mode: 'RENTAL', ordered_qty: 2, unit_price: 20, rental_calculation_type: 'PER_PERIOD', period_count: 2 })
  })
})
describe('P1-B3 picked dates stay on the local day', () => {
  it('cart dates before 07:00 Bangkok time are not moved back a day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T01:30:00+07:00')) // = 2026-10-06T18:30Z
    setCachedSystemSettings(DEFAULT_SYSTEM_CONFIG)
    const item: CartItem = {
      id: 's', product: { id: 'p', code: 'p', name: 'p', rentalType: 'SALE' } as CartItem['product'],
      itemType: 'SALE', rentalType: 'SALE', unitPrice: 10, quantity: 1, usageCount: 1, lineTotal: 10,
    }
    render(<SystemSettingsProvider><CartPanel onCheckout={() => {}} items={[item]} /></SystemSettingsProvider>)
    fireEvent.click(screen.getByRole('button', { name: /ชำระเงิน/ }))
    expect(loadActiveCart()).toMatchObject({
      headerRentalDate: '2026-10-07',
      headerReturnDate: '2026-10-07',
      documentDate: '2026-10-07',
    })
  })
})
