import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Step 4 (Master v4.3.1): the app talks to the v4.3 schema only through RLS reads + RPCs.
 * These tests pin the pieces that run in the browser: mapping server rows onto screen models,
 * the PIN confirmation flow, Thai error messages, menu access and the return preview.
 * The money / stock rules themselves are tested on a real database in supabase/tests/.
 */

const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/rpc', async (orig) => {
  const real = await orig<typeof import('@/lib/db/rpc')>()
  return { ...real, rpc: rpcMock }
})

import { DbError, dbErrorMessage, isDbError } from '@/lib/db/rpc'
import { registerPinConfirmer, withPin, withPinIfRequired, isPinCancelled } from '@/lib/db/pin-confirm'
import { mapBill, rentalStatusOf, paymentStatusOf } from '@/features/bills/api/bill-repository'
import { mapProductRow, rentalTypeOf } from '@/features/products/api/product-repository'
import { composeAddress, mapCustomerRow } from '@/features/customers/api/customer-repository'
import { hasMenu, menuForPath, firstAllowedHref, isMenuCode, GRANTABLE_MENUS } from '@/features/auth/services/permissions'
import { computeReturnCalculation, computeItemRentalCalculation } from '@/features/bills/services/return-calculation'
import { toServerMethod } from '@/features/bills/services/bill-service'
import { expenseCategoryCode, channelCode } from '@/features/finance/api/finance-repository'
import { describePinRefusal, validatePinFormat } from '@/features/auth/services/pin-lock'
import type { ReturnInspectionItem } from '@/lib/types/rental-return'
import type { CurrentUser } from '@/lib/types/rental-pos'

describe('server errors are shown in plain Thai', () => {
  it('maps known tags and keeps the raw tag for code', () => {
    const e = new DbError('INSUFFICIENT_STOCK: line 1, available 0, ordered 2')
    expect(e.tag).toBe('INSUFFICIENT_STOCK')
    expect(e.message).toBe('สินค้าในสต็อกไม่พอ')
    expect(isDbError(e, 'INSUFFICIENT_STOCK')).toBe(true)
    expect(dbErrorMessage('REFUND_EXCEEDS_REFUNDABLE: refundable 45')).toBe('ยอดคืนเงินเกินยอดที่รับมาและยังไม่ได้คืน')
    expect(dbErrorMessage('FORBIDDEN: menu finance required')).toBe('บัญชีนี้ไม่มีสิทธิ์ใช้เมนูนี้')
    expect(dbErrorMessage('Failed to fetch')).toContain('รายการยังไม่ถูกบันทึก')
  })
})

describe('risky action PIN flow (Master §4.4: confirm → PIN → do it once)', () => {
  beforeEach(() => registerPinConfirmer(null))

  it('withPin asks the PIN first and passes the single-use token', async () => {
    const confirmer = vi.fn(async () => ({ token: 'tok-1' }))
    registerPinConfirmer(confirmer)
    const run = vi.fn(async (t: string) => `done ${t}`)
    await expect(withPin({ action: 'REFUND', title: 'x' }, run)).resolves.toBe('done tok-1')
    expect(confirmer).toHaveBeenCalledWith(expect.objectContaining({ action: 'REFUND' }))
  })

  it('withPinIfRequired runs plainly and only asks when the server says PIN_REQUIRED', async () => {
    const confirmer = vi.fn(async () => ({ token: 'tok-2', reason: 'ลูกค้าประจำ' }))
    registerPinConfirmer(confirmer)
    const plain = vi.fn(async () => 'ok')
    await expect(withPinIfRequired({ action: 'PRICE_OVERRIDE', title: 'x' }, plain)).resolves.toBe('ok')
    expect(confirmer).not.toHaveBeenCalled()

    const guarded = vi.fn(async (token?: string, reason?: string) => {
      if (!token) throw new DbError('PIN_REQUIRED: PRICE_OVERRIDE')
      return `${token}/${reason}`
    })
    await expect(withPinIfRequired({ action: 'PRICE_OVERRIDE', title: 'x', askReason: true }, guarded)).resolves.toBe('tok-2/ลูกค้าประจำ')
  })

  it('a stale token is retried once with a fresh PIN; cancelling stops the action', async () => {
    const confirmer = vi.fn().mockResolvedValueOnce({ token: 'old' }).mockResolvedValueOnce({ token: 'new' })
    registerPinConfirmer(confirmer)
    const run = vi.fn(async (t: string) => {
      if (t === 'old') throw new DbError('PIN_CONFIRMATION_INVALID: verify the PIN again')
      return t
    })
    await expect(withPin({ action: 'STOCK_ADJUST', title: 'x' }, run)).resolves.toBe('new')

    registerPinConfirmer(async () => null)
    const err = await withPin({ action: 'REFUND', title: 'x' }, vi.fn()).catch((e) => e)
    expect(isPinCancelled(err)).toBe(true)
  })

  it('PIN refusal text follows the iOS waits and the block', () => {
    expect(validatePinFormat('12345').isValid).toBe(false)
    expect(validatePinFormat('123456').isValid).toBe(true)
    const wait = describePinRefusal({ ok: false, token: null, failedAttempts: 4, lockedUntil: new Date(Date.now() + 60_000).toISOString(), blocked: false, recovery: null })
    expect(wait).toContain('ผิด 4 ครั้ง')
    expect(describePinRefusal({ ok: false, token: null, failedAttempts: 10, lockedUntil: null, blocked: true, recovery: 'OWNER_RESET' })).toContain('เจ้าของร้านล้าง PIN')
    expect(describePinRefusal({ ok: false, token: null, failedAttempts: 10, lockedUntil: null, blocked: true, recovery: 'REAUTHENTICATE' })).toContain('ลืม PIN')
  })
})

describe('bill rows → bill screen (server numbers only)', () => {
  const baseBill = {
    id: 'b1', bill_no: 'BL-2026-000001', status: 'ACTIVE', payment_status: 'PARTIALLY_REFUNDED', customer_id: 'c1',
    quotation_id: null, parent_bill_id: null, original_bill_id: null, note: null, sale_subtotal: 0, rental_subtotal: 260,
    bill_discount_amount: 10, delivery_fee: 0, installation_fee: 0, service_fee: 0, vat_amount: 0, grand_total: 250,
    charge_total: 150, adjustment_net: -120, paid_amount: 250, refunded_amount: 0, write_off_total: 0, balance_due: 30,
    deposit_amount: 500, deposit_note: 'เงินสด', due_date: null, is_credit_bill: false, confirmed_at: '2026-10-02T03:00:00Z',
    closed_at: null, cancelled_at: null, cancel_reason: null, voided_at: null, void_reason: null, created_at: '2026-10-02T02:00:00Z',
  }
  const line = (over: Record<string, unknown>) => ({
    id: 'l1', bill_id: 'b1', line_no: 1, product_id: 'p1', line_mode: 'RENTAL', ordered_qty: 2, unit_price: 15,
    line_discount_amount: 0, extended_amount: 210, rental_calculation_type: 'PER_DAY', period_count: 7,
    rental_start_at: '2026-10-02T00:00:00Z', rental_end_at: '2026-10-08T16:59:59Z', actual_return_at: null,
    rental_status: 'ACTIVE', return_status: 'NOT_RETURNED', fulfillment_status: 'DELIVERED', delivered_qty: 2,
    cancelled_qty: 0, physical_returned_qty: 0, approved_lost_qty: 0, carried_forward_qty: 0, obligation_held_here: 2,
    ...over,
  })
  const ctx = {
    products: new Map([['p1', { id: 'p1', sku: 'NR-001', name: 'นั่งร้าน', default_damage_fee: 0, default_loss_fee: 0, unit_id: 'u1' }]]),
    units: new Map([['u1', 'ชุด']]),
    customers: new Map([['c1', { id: 'c1', name: 'สมชาย', phone: '081', address: 'บางพลี' }]]),
    payments: [], refunds: [], charges: [],
  }

  it('money: deposit is shown but never part of the total; balance and refund come from the server', () => {
    const b = mapBill(baseBill as never, [line({}) as never], ctx)
    expect(b.grandTotal).toBe(250 + 150 - 120)
    expect(b.heldDepositAmount).toBe(500)
    expect(b.depositApplied).toBe(0)
    expect(b.outstandingAmount).toBe(30)
    expect(b.refundDue).toBe(0)
    const overpaid = mapBill({ ...baseBill, balance_due: -60 } as never, [line({}) as never], ctx)
    expect(overpaid.outstandingAmount).toBe(0)
    expect(overpaid.refundDue).toBe(60)
  })

  it('items keep the day / round meaning and the customer comes from the customer row', () => {
    const b = mapBill(baseBill as never, [line({}) as never], ctx)
    expect(b.customerName).toBe('สมชาย')
    expect(b.items[0]).toMatchObject({ productCode: 'NR-001', rentalType: 'DAILY', usageCount: 7, outstandingQty: 2, unit: 'ชุด', status: 'RENTING' })
  })

  it('status: goods back → RETURNED, part back → PARTIAL_RETURNED, payment status names', () => {
    expect(rentalStatusOf({ status: 'ACTIVE' }, [line({ return_status: 'RETURNED', obligation_held_here: 0, physical_returned_qty: 2 }) as never])).toBe('RETURNED')
    expect(rentalStatusOf({ status: 'ACTIVE' }, [line({ physical_returned_qty: 1, obligation_held_here: 1 }) as never])).toBe('PARTIAL_RETURNED')
    expect(rentalStatusOf({ status: 'DRAFT' }, [])).toBe('DRAFT')
    expect(paymentStatusOf('PARTIALLY_PAID')).toBe('PARTIAL')
    expect(paymentStatusOf('PARTIALLY_REFUNDED')).toBe('REFUND_PARTIAL')
  })

  it('a draft shows a temporary label until the server gives the number', () => {
    expect(mapBill({ ...baseBill, bill_no: null, status: 'DRAFT' } as never, [], ctx).billNo).toMatch(/^ร่าง-/)
  })
})

describe('product rows → product screen (stock from the ledger balances)', () => {
  const row = {
    id: 'p1', sku: 'BK-001', name: 'แบบคาน', category_id: 'c1', unit_id: 'u1', item_type: 'QUANTITY', calculation_type: 'PER_PERIOD',
    sale_price: null, rental_price: 10, reorder_point: 5, can_sell: false, can_rent: true, is_accessory: false,
    is_rent_chargeable: true, requires_return: true, default_damage_fee: 150, default_loss_fee: 900, active: true,
    created_at: '', updated_at: '',
  }
  it('quantities come from stock_balances per state', () => {
    const p = mapProductRow(row, {
      categories: new Map([['c1', 'แบบคาน']]),
      units: new Map([['u1', 'แผ่น']]),
      balances: new Map([['p1', { AVAILABLE: 17, RESERVED: 1, RENTED_OUT: 2, DAMAGED: 1, LOST: 1 }]]),
      costs: new Map(),
    })
    expect(p).toMatchObject({ availableQuantity: 17, reservedQuantity: 1, rentedQuantity: 2, damagedQuantity: 1, lostQuantity: 1, totalQuantity: 21 })
    expect(p).toMatchObject({ unit: 'แผ่น', category: 'แบบคาน', rentalType: 'NORMAL', productType: 'RENT', defaultDamageFee: 150, minimumStock: 5 })
    expect(p.costPrice).toBeUndefined()
  })
  it('PER_DAY = รายวัน, sale-only = SALE', () => {
    expect(rentalTypeOf({ calculation_type: 'PER_DAY', can_rent: true, can_sell: false })).toBe('DAILY')
    expect(rentalTypeOf({ calculation_type: 'PER_UNIT', can_rent: false, can_sell: true })).toBe('SALE')
  })
})

describe('customers', () => {
  it('builds the printable address from the structured parts and keeps them', () => {
    expect(composeAddress({ id: '', customerName: 'a', phone: '1', houseNo: '12', moo: '3', subDistrict: 'บางพลี', province: 'สมุทรปราการ' }))
      .toBe('12 หมู่ 3 ต.บางพลี จ.สมุทรปราการ')
    const c = mapCustomerRow({
      id: 'c1', customer_code: null, name: 'บริษัท ก', phone: '02', address: 'กทม', customer_type: 'COMPANY', tax_id: null,
      email: null, contact_person: null, note: null, active: false, account_status: 'NORMAL', created_at: '',
      contact_details: { lineId: 'abc', houseNo: '9' },
    })
    expect(c).toMatchObject({ customerType: 'CORPORATE', isSuspended: true, lineId: 'abc', houseNo: '9' })
  })
})

describe('menu access (Master §4.2)', () => {
  const user = (role: 'OWNER' | 'USER', menus: string[], status: 'ACTIVE' | 'PENDING' = 'ACTIVE') =>
    ({ role, status, menus } as unknown as CurrentUser)
  it('OWNER opens everything; USER only granted menus; members is owner-only', () => {
    expect(hasMenu(user('OWNER', []), 'members')).toBe(true)
    expect(hasMenu(user('USER', ['pos']), 'pos')).toBe(true)
    expect(hasMenu(user('USER', ['pos']), 'finance')).toBe(false)
    expect(hasMenu(user('USER', ['members']), 'members')).toBe(false)
    expect(hasMenu(user('USER', ['pos'], 'PENDING'), 'pos')).toBe(false)
    expect(GRANTABLE_MENUS.map((m) => m.code)).not.toContain('members')
    expect(isMenuCode('settings')).toBe(true)
  })
  it('pages map to menus; a USER lands on the first allowed page', () => {
    expect(menuForPath('/finance/statement')).toBe('finance')
    expect(menuForPath('/owner-permissions')).toBe('members')
    expect(menuForPath('/forgot-pin')).toBeNull()
    // Settings → Security (own PIN) is open to every member, the rest of Settings is not
    expect(menuForPath('/settings/security')).toBeNull()
    expect(menuForPath('/settings')).toBe('settings')
    expect(firstAllowedHref(user('USER', ['customers', 'bills']))).toBe('/bills')
  })
})

describe('return preview mirrors the server rules (no late fee, early return pro-rata, deposit not deducted)', () => {
  const item = (over: Partial<ReturnInspectionItem>): ReturnInspectionItem => ({
    rentalBillItemId: 'l1', productId: 'p1', productName: 'x', totalQtyInBill: 1, outstandingQty: 1, returnQty: 1,
    normalQty: 1, damagedQty: 0, lostQty: 0, dailyRate: 100, repairFeePerUnit: 0, replacementFeePerUnit: 0,
    totalDamageFee: 0, rentalType: 'DAILY', usageCount: 7, ...over,
  })
  it('owner example: 7 days 700, used 3, paid 700 → refund 400 suggested', () => {
    const r = computeReturnCalculation('2026-10-01', '2026-10-07', '2026-10-03', [item({})], 500, true, 0, undefined,
      { grandTotal: 700, paidAmount: 700, outstandingAmount: 0 })
    expect(r.rentalFeeDelta).toBe(-400)
    expect(r.netAmount).toBe(-400)
    expect(r.netRefundAmount).toBe(400)
    expect(r.deductFromDeposit).toBe(false)
    expect(r.lateFeeTotal).toBe(0)
  })
  it('per-round items: an early return changes nothing; late return has no fee', () => {
    const r = computeReturnCalculation('2026-10-01', '2026-10-07', '2026-10-03', [item({ rentalType: 'NORMAL', usageCount: 1 })], 0, false, 0, undefined,
      { grandTotal: 100, paidAmount: 100, outstandingAmount: 0 })
    expect(r.rentalFeeDelta).toBe(0)
    const late = computeReturnCalculation('2026-10-01', '2026-10-07', '2026-10-12', [item({})], 0, false, 0, undefined,
      { grandTotal: 700, paidAmount: 700, outstandingAmount: 0 })
    expect(late.lateDays).toBe(5)
    expect(late.lateFeeTotal).toBe(0)
    expect(late.netAmount).toBe(0)
  })
  it('damage and lost fees are what staff confirm', () => {
    const r = computeReturnCalculation('2026-10-01', '2026-10-07', '2026-10-07',
      [item({ normalQty: 0, damagedQty: 1, lostQty: 1, repairFeePerUnit: 150, replacementFeePerUnit: 900, outstandingQty: 2 })], 0, false, 0, undefined,
      { grandTotal: 700, paidAmount: 700, outstandingAmount: 0 })
    expect(r.totalDamageFee).toBe(1050)
    expect(r.netAmount).toBe(1050)
    expect(computeItemRentalCalculation(item({}), { rentalStartDate: '2026-10-01', actualReturnDate: '2026-10-03' }).actualRentalDays).toBe(3)
  })
})

describe('payment channels and expense categories map to the server lists', () => {
  it('maps app channels to tender methods', () => {
    expect(toServerMethod('CASH')).toBe('CASH')
    expect(toServerMethod('PROMPTPAY')).toBe('QR')
    expect(toServerMethod('CHEQUE')).toBe('OTHER')
    expect(channelCode('เงินสด')).toBe('CASH')
    expect(channelCode('โอนเงิน')).toBe('TRANSFER')
    expect(expenseCategoryCode('ค่าน้ำมัน')).toBe('FUEL')
    expect(expenseCategoryCode('ซ่อมรถ')).toBe('REPAIR')
    expect(expenseCategoryCode('อื่น ๆ')).toBe('GENERAL')
  })
})
