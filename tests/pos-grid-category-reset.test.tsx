// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Product } from '@/lib/types/rental-pos'

// One dropdown per category (owner 2026-11-02): each is found by its category name; '' = not picked.
vi.mock('@/components/common/CustomSelect', () => ({
  CustomSelect: ({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) => (
    <select aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/features/pos/components/ProductCard', () => ({
  ProductCard: ({ product }: { product: Product }) => <div data-testid="card">{product.name}</div>,
}))

import { ProductGrid } from '@/features/pos/components/ProductGrid'
import { setCachedPolicies } from '@/lib/db/policies'

afterEach(cleanup)

const product = (id: string, name: string, category: string, productType: 'RENT' | 'SALE', listItem?: string): Product =>
  ({ id, name, code: id, category, listItem, productType, status: 'ACTIVE', rentPrice: 100, salePrice: 100 }) as unknown as Product

const cards = () => screen.getAllByTestId('card').map((c) => c.textContent)
const dropdown = (name: string) => screen.getByLabelText(name) as HTMLSelectElement

describe('POS: switching เช่า/ขาย (audit UX-32)', () => {
  const PRODUCTS = [
    product('R1', 'นั่งร้าน', 'นั่งร้าน', 'RENT'),
    product('S1', 'ตะปู', 'วัสดุสิ้นเปลือง', 'SALE'),
  ]

  it('a category picked in เช่า does not leave ขาย looking empty', () => {
    render(<ProductGrid products={PRODUCTS} onSelectProduct={() => {}} />)
    fireEvent.change(dropdown('นั่งร้าน'), { target: { value: 'ALL' } })
    expect(cards()).toEqual(['นั่งร้าน'])

    fireEvent.click(screen.getByText('ขายสินค้า'))
    expect(screen.queryByLabelText('นั่งร้าน')).toBeNull()
    expect(cards()).toEqual(['ตะปู'])
  })

  it('a mode changed by the page (not the switch) also falls back to every product', () => {
    const view = render(<ProductGrid products={PRODUCTS} onSelectProduct={() => {}} currentMode="RENT" />)
    fireEvent.change(dropdown('นั่งร้าน'), { target: { value: 'ALL' } })
    view.rerender(<ProductGrid products={PRODUCTS} onSelectProduct={() => {}} currentMode="SALE" />)
    expect(cards()).toEqual(['ตะปู'])
  })
})

describe('POS: one dropdown per category (owner 2026-11-02)', () => {
  // รายการ of แบบคาน as added in ตั้งค่าเสริม (test category cat-1 = แบบคาน)
  setCachedPolicies({ category_defaults: { 'cat-1': { items: [{ name: 'แบบคาน40' }, { name: 'แบบคาน50' }, { name: 'แบบคาน60' }] } } })
  const RENTALS = [
    product('K1', 'แบบคาน 40x0.50', 'แบบคาน', 'RENT', 'แบบคาน40'),
    product('K2', 'แบบคาน 50x1.00', 'แบบคาน', 'RENT', 'แบบคาน50'),
    product('P1', 'แบบเสา 15x15x2.00', 'แบบเสา', 'RENT'),
  ]

  it('shows every product first, with a dropdown named after each category', () => {
    render(<ProductGrid products={RENTALS} onSelectProduct={() => {}} />)
    expect(cards()).toHaveLength(3)
    expect(dropdown('แบบคาน').value).toBe('')
    expect(dropdown('แบบเสา').value).toBe('')
    expect(Array.from(dropdown('แบบคาน').options).map((o) => o.value)).toEqual(['', 'ALL', 'แบบคาน40', 'แบบคาน50', 'แบบคาน60'])
  })

  it('dropdowns follow the owner order: แบบคาน แบบเสา … whatever order the products come in', () => {
    render(<ProductGrid products={[...RENTALS].reverse()} onSelectProduct={() => {}} />)
    expect(screen.getAllByRole('combobox').map((el) => el.getAttribute('aria-label'))).toEqual(['แบบคาน', 'แบบเสา'])
  })

  it('ทั้งหมด or one รายการ narrows the products; another category clears the first', () => {
    render(<ProductGrid products={RENTALS} onSelectProduct={() => {}} />)
    fireEvent.change(dropdown('แบบคาน'), { target: { value: 'ALL' } })
    expect(cards()).toEqual(['แบบคาน 40x0.50', 'แบบคาน 50x1.00'])

    fireEvent.change(dropdown('แบบคาน'), { target: { value: 'แบบคาน50' } })
    expect(cards()).toEqual(['แบบคาน 50x1.00'])

    fireEvent.change(dropdown('แบบเสา'), { target: { value: 'ALL' } })
    expect(dropdown('แบบคาน').value).toBe('')
    expect(cards()).toEqual(['แบบเสา 15x15x2.00'])

    // Pressing the active เช่า/ขาย button again shows every product
    fireEvent.click(screen.getByText('เช่าสินค้า'))
    expect(cards()).toHaveLength(3)
  })
})
