// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// รายการนอกร้าน (owner 2026-11-11): a line typed in at the counter — no product, no stock.
const db = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/db/rpc', async (orig) => ({ ...(await orig<typeof import('@/lib/db/rpc')>()), rpc: db.rpc }))
vi.mock('@/lib/db/pin-confirm', async (orig) => ({
  ...(await orig<typeof import('@/lib/db/pin-confirm')>()),
  withPinIfRequired: (_opts: unknown, run: (token: null, reason: null) => unknown) => run(null, null),
}))

import { customCartItem, cartLineUnitPriceForServer, validateCartCustomer } from '@/features/pos/services/cart-storage'
import { CustomItemModal } from '@/features/pos/components/CustomItemModal'
import { saveBillDraft } from '@/features/bills/services/bill-service'

afterEach(cleanup)

describe('typed-in cart line', () => {
  it('rental per round: quantity × price × rounds, always sends its price', () => {
    const item = customCartItem({ name: 'ค้ำยันเหล็ก', unit: 'ต้น', quantity: 20, unitPrice: 5, count: 3, rentalType: 'NORMAL' })
    expect(item.isCustom).toBe(true)
    expect(item.lineTotal).toBe(300)
    expect(item.usageCount).toBe(3)
    expect(item.requiresReturn).toBe(false)
    expect(item.product.name).toBe('ค้ำยันเหล็ก')
    expect(item.product.unit).toBe('ต้น')
    expect(cartLineUnitPriceForServer(item)).toBe(5)
  })

  it('per day counts days; a sale counts once', () => {
    const daily = customCartItem({ name: 'เครื่องตัด', unit: 'เครื่อง', quantity: 2, unitPrice: 100, count: 4, rentalType: 'DAILY' })
    expect(daily.billableDays).toBe(4)
    expect(daily.lineTotal).toBe(800)
    const sale = customCartItem({ name: 'ตะปู', unit: 'กล่อง', quantity: 3, unitPrice: 15, count: 9, rentalType: 'SALE' })
    expect(sale.itemType).toBe('SALE')
    expect(sale.lineTotal).toBe(45)
  })
})

describe('รายการนอกร้าน window', () => {
  it('editing a line: one row, shows the amount, returns what was typed', () => {
    const onAdd = vi.fn()
    render(
      <CustomItemModal
        initial={{ name: 'ค้ำยันเหล็ก', quantity: 20, unit: 'ต้น', unitPrice: 5, count: 3, rentalType: 'NORMAL' }}
        onAdd={onAdd}
        onClose={() => undefined}
      />,
    )
    expect(screen.queryByLabelText('ชื่อรายการ แถว 2')).toBeNull()
    expect(screen.getByLabelText('จำนวนเงิน แถว 1').textContent).toBe('300.00')
    fireEvent.change(screen.getByLabelText('ราคา แถว 1'), { target: { value: '6' } })
    expect(screen.getByLabelText('จำนวนเงิน แถว 1').textContent).toBe('360.00')
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }))
    expect(onAdd).toHaveBeenCalledWith([{ name: 'ค้ำยันเหล็ก', quantity: 20, unit: 'ต้น', unitPrice: 6, count: 3, rentalType: 'NORMAL' }])
  })

  it('a new window has 5 rows; only rows with a name are added, each must be complete', () => {
    const onAdd = vi.fn()
    render(<CustomItemModal onAdd={onAdd} onClose={() => undefined} />)
    const add = screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement
    expect(screen.getByLabelText('ชื่อรายการ แถว 5')).toBeTruthy()
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('ชื่อรายการ แถว 2'), { target: { value: 'ตะปู' } })
    fireEvent.change(screen.getByLabelText('จำนวน แถว 2'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('ราคา แถว 2'), { target: { value: '15' } })
    expect(add.disabled).toBe(true) // no unit yet
  })
})

describe('bill draft with a typed-in line', () => {
  it('sends no product id, its own name and unit, and its price', async () => {
    db.rpc.mockResolvedValueOnce({ id: 'bill-1' })
    await saveBillDraft({
      customerId: 'c1',
      lines: [
        { productId: null, productName: 'ค้ำยันเหล็ก', unitName: 'ต้น', mode: 'RENTAL', quantity: 20, unitPrice: 5, calc: 'PER_PERIOD', periods: 3, startAt: '2026-11-11T00:00:00.000Z', endAt: '2026-11-14T00:00:00.000Z' },
        { productId: 'p1', mode: 'SALE', quantity: 1 },
      ],
    } as Parameters<typeof saveBillDraft>[0])
    const sent = db.rpc.mock.calls[0][1].p_data.lines
    expect(sent[0]).toMatchObject({ product_id: null, product_name: 'ค้ำยันเหล็ก', unit_name: 'ต้น', unit_price: 5, period_count: 3, line_mode: 'RENTAL' })
    expect(sent[1]).toMatchObject({ product_id: 'p1' })
    expect(sent[1]).not.toHaveProperty('product_name')
  })
})

describe('rental bill customer (owner 2026-11-11: only the name is required)', () => {
  const rent = [{ itemType: 'RENT' as const }]
  it('a customer with only a name can be billed', () => {
    expect(() => validateCartCustomer(rent, { customerName: 'ลูกค้า ชื่ออย่างเดียว', phone: '', address: '' })).not.toThrow()
  })
  it('no customer, or no name, is still refused', () => {
    expect(() => validateCartCustomer(rent, null)).toThrow()
    expect(() => validateCartCustomer(rent, { customerName: '  ', phone: '0811111111', address: 'x' })).toThrow()
  })
})
