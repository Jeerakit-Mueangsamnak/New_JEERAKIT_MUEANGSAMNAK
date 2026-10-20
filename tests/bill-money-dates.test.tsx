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
  syncProductsFromSupabase: vi.fn(async () => []),
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
import { correctionDelta } from '@/features/bills/components/BillRevisionView'
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

describe('P1-B7 a correction that changes nothing keeps the total', () => {
  // 2 boards × 3 days × ฿20 = 120, 1 sale ฿100, discount 20, delivery 50 → base 250, VAT 7% → 267.50; deposit 500 held apart
  const bill = {
    billAmount: 267.5,
    grandTotal: 267.5,
    heldDepositAmount: 500,
    discountAmount: 20,
    shippingFee: 50,
    items: [
      { rentalBillItemId: 'L1', rentalType: 'DAILY', dailyRate: 20, quantity: 2, usageCount: 3, lineTotal: 120 },
      { rentalBillItemId: 'L2', rentalType: 'SALE', dailyRate: 100, quantity: 1, lineTotal: 100 },
    ],
  } as unknown as FullBill
  const lines = (p1 = 20, p2 = 100) => [
    { rentalBillItemId: 'L1', unitPrice: p1, action: 'UPDATE' as const },
    { rentalBillItemId: 'L2', unitPrice: p2, action: 'UPDATE' as const },
  ]

  it('nothing edited → 0 (no adjustment, deposit not involved)', () => {
    expect(correctionDelta(bill, lines(), 20, 50)).toBe(0)
  })
  it('price change uses the billed days and the bill\'s own VAT', () => {
    // +5 × 2 × 3 days = 30 base → ×1.07 = 32.10
    expect(correctionDelta(bill, lines(25), 20, 50)).toBe(32.1)
  })
  it('more discount lowers the total by discount + its VAT', () => {
    expect(correctionDelta(bill, lines(), 30, 50)).toBe(-10.7)
  })
  it('a bill without VAT (or VAT included in prices) changes by the base amount only', () => {
    const noVat = { ...bill, billAmount: 250, grandTotal: 250 } as unknown as FullBill
    expect(correctionDelta(noVat, lines(), 20, 50)).toBe(0)
    expect(correctionDelta(noVat, lines(), 20, 70)).toBe(20)
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
