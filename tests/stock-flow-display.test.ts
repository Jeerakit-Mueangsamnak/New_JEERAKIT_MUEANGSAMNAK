import { describe, expect, it } from 'vitest'
import { rentalStatusOf } from '@/features/bills/api/bill-repository'
import { mapProductRow } from '@/features/products/api/product-repository'
import { isLowStock } from '@/features/products/utils/low-stock'
import { getBillPaymentPresentation, isExtensionBill, isOwingBill } from '@/features/bills/utils/bill-list-presentation'

// Stock-flow check 2026-10-17: the screens must read the same figures the server keeps.

const line = (over: Record<string, unknown>) =>
  ({
    line_mode: 'RENTAL', ordered_qty: 3, delivered_qty: 0, cancelled_qty: 0, carried_in_qty: 0,
    physical_returned_qty: 0, approved_lost_qty: 0, carried_forward_qty: 0, obligation_held_here: 0,
    return_status: 'NOT_RETURNED', ...over,
  }) as never

describe('bill status from stock lines', () => {
  it('a paid (ACTIVE) bill with nothing handed over is still "confirmed", not "returned"', () => {
    expect(rentalStatusOf({ status: 'ACTIVE' }, [line({})])).toBe('CONFIRMED')
  })
  it('a continuation bill holding carried-in goods is renting', () => {
    expect(rentalStatusOf({ status: 'ACTIVE' }, [line({ ordered_qty: 2, carried_in_qty: 2, obligation_held_here: 2 })])).toBe('RENTING')
  })
  it('a parent bill whose goods all moved to the continuation bill is "extended", not "returned"', () => {
    expect(rentalStatusOf({ status: 'ACTIVE' }, [line({ ordered_qty: 2, delivered_qty: 2, carried_forward_qty: 2 })])).toBe('EXTENDED')
  })
  it('goods all back after delivery = returned', () => {
    expect(rentalStatusOf({ status: 'ACTIVE' }, [line({ delivered_qty: 3, physical_returned_qty: 3, return_status: 'RETURNED' })])).toBe('RETURNED')
  })
})

describe('product figures from stock_balances', () => {
  const lookups = (balances: Record<string, number>) => ({
    categories: new Map(), units: new Map(), costs: new Map(), balances: new Map([['p1', balances]]),
  })
  const row = { id: 'p1', sku: 'X', name: 'X', unit_id: 'u', can_rent: true, can_sell: false, active: true, reorder_point: 5 } as never

  it('goods left in REPAIR / INSPECTION stay in the damaged figure and are counted once in the total', () => {
    const p = mapProductRow(row, lookups({ AVAILABLE: 10, RESERVED: 2, RENTED_OUT: 3, DAMAGED: 1, INSPECTION: 1, REPAIR: 1, LOST: 4 }))
    expect(p.damagedQuantity).toBe(3)
    expect(p.totalQuantity).toBe(10 + 2 + 3 + 3)
    expect(p.stockStates?.DAMAGED).toBe(1)
    expect(p.stockStates?.REPAIR).toBe(1)
  })
  it('low stock = available at or below the product reorder point (0 = never)', () => {
    expect(isLowStock({ availableQuantity: 5, minimumStock: 5 })).toBe(true)
    expect(isLowStock({ availableQuantity: 0, minimumStock: 0 })).toBe(false)
  })
})

describe('bill list: cancelled / void bills and the เช่าต่อ filter', () => {
  const bill = (over: Record<string, unknown>) =>
    ({ paymentStatus: 'UNPAID', rentalStatus: 'RENTING', serverStatus: 'ACTIVE', refundDueAmount: 0, refundedAmount: 0, items: [], ...over }) as never

  it('a cancelled bill owes nothing and shows "-"', () => {
    const b = bill({ rentalStatus: 'CANCELLED', serverStatus: 'CANCELLED' })
    expect(isOwingBill(b)).toBe(false)
    expect(getBillPaymentPresentation(b).label).toBe('-')
  })
  it('a void bill with money not yet paid back shows "รอคืนเงิน"', () => {
    expect(getBillPaymentPresentation(bill({ rentalStatus: 'VOID', serverStatus: 'VOID', paymentStatus: 'PAID', refundDueAmount: 30 })).label).toBe('รอคืนเงิน')
  })
  it('an open unpaid bill still shows "ค้างชำระ"', () => {
    expect(isOwingBill(bill({}))).toBe(true)
    expect(getBillPaymentPresentation(bill({})).label).toBe('ค้างชำระ')
  })
  it('เช่าต่อ filter finds the parent and the continuation bill', () => {
    expect(isExtensionBill(bill({ rentalStatus: 'EXTENDED' }))).toBe(true)
    expect(isExtensionBill(bill({ items: [{ carriedInQty: 2 }] }))).toBe(true)
    expect(isExtensionBill(bill({ items: [{ carriedInQty: 0 }] }))).toBe(false)
  })
})
