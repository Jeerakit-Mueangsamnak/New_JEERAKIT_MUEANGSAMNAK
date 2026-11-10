// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CartPanel } from '@/features/pos/components/CartPanel'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import type { CartItem } from '@/features/pos/services/cart-storage'
import type { Customer } from '@/lib/types/rental-pos'

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'tester', fullName: 'Tester', role: 'USER' } }) }))
vi.mock('@/features/pos/components/CustomerUnifiedSelector', () => ({ CustomerUnifiedSelector: () => null }))
vi.mock('@/features/customers/components/NewCustomerModal', () => ({ NewCustomerModal: () => null }))

afterEach(cleanup)

const saleItem = {
  id: 'i1', product: { id: 'p1', name: 'สินค้า', rentalType: 'SALE', salePrice: 100 }, rentalType: 'SALE', itemType: 'SALE',
  quantity: 1, unitPrice: 100, usageCount: 1, lineTotal: 100,
} as unknown as CartItem

const customer = { id: 'c1', customerName: 'บริษัท ก', phone: '0811111111', address: 'กทม', taxId: '', status: 'ACTIVE' } as Customer

const mount = (props: Partial<React.ComponentProps<typeof CartPanel>> = {}) =>
  render(
    <SystemSettingsProvider>
      <CartPanel onCheckout={vi.fn()} items={[saleItem]} customer={customer} setCustomer={() => undefined} {...props} />
    </SystemSettingsProvider>
  )

describe('POS cart: fields moved to the payment page / contact phone', () => {
  it('a bill no longer has discount / shipping / deposit boxes in the cart (they are on the payment page)', () => {
    mount()
    expect(screen.queryByText('ส่วนลด (บาท)')).toBeNull()
    expect(screen.queryByText('ค่าขนส่ง (บาท)')).toBeNull()
    expect(screen.queryByText('เงินมัดจำ (บาท)')).toBeNull()
  })

  it('a quotation has none either: they are on สรุปใบเสนอราคา, the same central panel (owner 2026-11-04)', () => {
    mount({ isQuotationMode: true })
    expect(screen.queryByText('ส่วนลด (บาท)')).toBeNull()
    expect(screen.queryByText('ค่าขนส่ง (บาท)')).toBeNull()
    expect(screen.queryByText('เงินมัดจำ (บาท)')).toBeNull()
    expect(screen.getByRole('button', { name: 'สรุปใบเสนอราคา' })).toBeTruthy()
  })

  it('the contact phone starts as the customer phone, takes typing, and keeps digits only', () => {
    mount()
    const box = screen.getByLabelText('เบอร์โทรติดต่อ') as HTMLInputElement
    expect(box.value).toBe('0811111111')
    fireEvent.change(box, { target: { value: '081-222-3333 abc' } })
    expect(box.value).toBe('081-222-3333 ')
  })

  it('a customer with a second phone starts with both numbers (owner 2026-11-08)', () => {
    mount({ customer: { ...customer, phone2: '0822222222' } })
    const box = screen.getByLabelText('เบอร์โทรติดต่อ') as HTMLInputElement
    expect(box.value).toBe('0811111111, 0822222222')
    fireEvent.change(box, { target: { value: '0811111111, 0833333333' } })
    expect(box.value).toBe('0811111111, 0833333333')
  })

  it('a restored contact phone is not overwritten by the customer phone', () => {
    mount({ initialContactPhone: '0899999999' })
    expect((screen.getByLabelText('เบอร์โทรติดต่อ') as HTMLInputElement).value).toBe('0899999999')
  })

  it('a quotation has no contact phone box', () => {
    mount({ isQuotationMode: true })
    expect(screen.queryByLabelText('เบอร์โทรติดต่อ')).toBeNull()
  })
})

describe('POS cart: the dates must be picked for a bill (owner 2026-11-11)', () => {
  const dateRow = () => screen.getByRole('button', { name: 'วันที่เอกสาร วันเริ่มเช่า วันกำหนดคืน' })

  it('a new bill shows --/-- and ชำระเงิน makes the date row blink red instead of going on', () => {
    const onCheckout = vi.fn()
    mount({ onCheckout, initialDocumentType: 'ใบส่งของ/ใบเสร็จรับเงิน' })
    expect(dateRow().textContent).not.toMatch(/\d{2}\/\d{2}/)
    fireEvent.click(screen.getByRole('button', { name: /ชำระเงิน/ }))
    expect(onCheckout).not.toHaveBeenCalled()
    expect(dateRow().className).toContain('field-attention')
  })

  it('dates that came with the cart (held cart / quotation / draft) count as picked', () => {
    const onCheckout = vi.fn()
    mount({ onCheckout, initialDocumentType: 'ใบส่งของ/ใบเสร็จรับเงิน', initialDatesPicked: true })
    expect(dateRow().textContent).toMatch(/\d{2}\/\d{2}/)
    fireEvent.click(screen.getByRole('button', { name: /ชำระเงิน/ }))
    expect(onCheckout).toHaveBeenCalled()
  })

  it('a quotation does not need them', () => {
    mount({ isQuotationMode: true })
    expect(dateRow().textContent).toMatch(/\d{2}\/\d{2}/)
  })
})