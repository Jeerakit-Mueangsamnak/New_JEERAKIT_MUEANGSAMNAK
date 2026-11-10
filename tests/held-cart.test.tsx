// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CartItem } from '@/features/pos/services/cart-storage'
import type { Customer } from '@/lib/types/rental-pos'

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: '/bills' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }), usePathname: () => nav.pathname }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: toast }) }))
const auth = vi.hoisted(() => ({ user: { id: 'u1', fullName: 'Tester', role: 'USER' } as { id: string } | null }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))
vi.mock('@/features/pos/components/CustomerUnifiedSelector', () => ({ CustomerUnifiedSelector: () => null }))
vi.mock('@/features/customers/components/NewCustomerModal', () => ({ NewCustomerModal: () => null }))

import { HeldCartButton } from '@/features/pos/components/HeldCartButton'
import { CartPanel } from '@/features/pos/components/CartPanel'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import { clearAllCarts, loadActiveCart, loadHeldCart, saveActiveCart } from '@/features/pos/services/cart-storage'

const item = {
  id: 'i1', product: { id: 'p1', name: 'สินค้า', rentalType: 'SALE', salePrice: 100 }, rentalType: 'SALE', itemType: 'SALE',
  quantity: 1, unitPrice: 100, usageCount: 1, lineTotal: 100,
} as unknown as CartItem
const customer = { id: 'c1', customerName: 'ลูกค้า', phone: '0811111111', address: 'กทม', status: 'ACTIVE' } as Customer
const held = (over: object = {}) =>
  ({ customer, items: [item], discount: 0, shippingFee: 0, depositAmount: 0, taxRate: 0, shippingAddress: '', headerRentalDate: '2026-11-09',
     headerReturnDate: '2026-11-09', documentType: '', documentDate: '2026-11-09', subtotal: 100, tax: 0, grandTotal: 100, ownerId: 'u1', ...over }) as never

beforeEach(() => {
  clearAllCarts()
  nav.push.mockClear()
  toast.mockClear()
  auth.user = { id: 'u1' }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('held cart storage', () => {
  it('a bill cart and a quotation cart are kept apart', () => {
    saveActiveCart(held())
    saveActiveCart(held({ quotationMode: true, items: [item, item] }))
    expect(loadActiveCart('BILL')?.items).toHaveLength(1)
    expect(loadActiveCart('QUOTATION')?.items).toHaveLength(2)
  })
  it('another user on this device never gets the cart back; sign-out clears both', () => {
    saveActiveCart(held())
    expect(loadHeldCart('u1')).not.toBeNull()
    expect(loadHeldCart('u2')).toBeNull()
    clearAllCarts()
    expect(loadActiveCart('BILL')).toBeNull()
  })
})

describe('header cart icon', () => {
  it('no held cart: shown but cannot be pressed', () => {
    render(<HeldCartButton />)
    expect((screen.getByTestId('held-cart-button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a held cart blinks red; a double tap opens the POS', () => {
    saveActiveCart(held())
    render(<HeldCartButton />)
    const button = screen.getByTestId('held-cart-button') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('animate-pulse')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(nav.push).toHaveBeenCalledWith('/pos')
    expect(screen.queryByLabelText('ล้างตะกร้าสินค้า')).toBeNull()
  })

  it('a single tap shows the X; the X clears the cart (nothing else is saved)', () => {
    vi.useFakeTimers()
    saveActiveCart(held())
    render(<HeldCartButton />)
    fireEvent.click(screen.getByTestId('held-cart-button'))
    act(() => {
      vi.advanceTimersByTime(350)
    })
    expect(nav.push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('ล้างตะกร้าสินค้า'))
    expect(loadActiveCart('BILL')).toBeNull()
    expect((screen.getByTestId('held-cart-button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a quotation cart or someone else\'s cart does not light the icon', () => {
    saveActiveCart(held({ quotationMode: true }))
    saveActiveCart(held({ ownerId: 'u2' }))
    render(<HeldCartButton />)
    expect((screen.getByTestId('held-cart-button') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('POS cart keeps itself while switching menus', () => {
  const mount = (items: CartItem[], extra: Partial<React.ComponentProps<typeof CartPanel>> = {}) =>
    render(
      <SystemSettingsProvider>
        <CartPanel onCheckout={vi.fn()} items={items} customer={customer} setCustomer={() => undefined} setItems={() => undefined} {...extra} />
      </SystemSettingsProvider>
    )

  it('an empty cart at mount never removes a held cart (the page may restore it)', () => {
    saveActiveCart(held())
    mount([])
    expect(loadActiveCart('BILL')?.items).toHaveLength(1)
  })

  it('every change of a bill cart is kept with its owner; emptying it removes it', () => {
    const view = mount([item])
    expect(loadActiveCart('BILL')).toMatchObject({ ownerId: 'u1', customer: { id: 'c1' } })
    view.rerender(
      <SystemSettingsProvider>
        <CartPanel onCheckout={vi.fn()} items={[]} customer={customer} setCustomer={() => undefined} setItems={() => undefined} />
      </SystemSettingsProvider>
    )
    expect(loadActiveCart('BILL')).toBeNull()
  })

  it('quotation mode never touches the held bill cart', () => {
    saveActiveCart(held())
    mount([item, item], { isQuotationMode: true })
    expect(loadActiveCart('BILL')?.items).toHaveLength(1)
  })
})
