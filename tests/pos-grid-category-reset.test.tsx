// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Product } from '@/lib/types/rental-pos'

vi.mock('@/components/common/CustomSelect', () => ({
  CustomSelect: ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
    <select aria-label="หมวดหมู่" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/features/pos/components/ProductCard', () => ({
  ProductCard: ({ product }: { product: Product }) => <div data-testid="card">{product.name}</div>,
}))

import { ProductGrid } from '@/features/pos/components/ProductGrid'

afterEach(cleanup)

const product = (id: string, name: string, category: string, productType: 'RENT' | 'SALE'): Product =>
  ({ id, name, code: id, category, productType, status: 'ACTIVE', rentPrice: 100, salePrice: 100 }) as unknown as Product

const PRODUCTS = [
  product('R1', 'นั่งร้าน', 'นั่งร้าน', 'RENT'),
  product('S1', 'ตะปู', 'วัสดุสิ้นเปลือง', 'SALE'),
]

describe('POS: switching เช่า/ขาย (audit UX-32)', () => {
  it('a category picked in เช่า does not leave ขาย looking empty', () => {
    render(<ProductGrid products={PRODUCTS} onSelectProduct={() => {}} />)
    fireEvent.change(screen.getByLabelText('หมวดหมู่'), { target: { value: 'นั่งร้าน' } })
    expect(screen.getAllByTestId('card').map((c) => c.textContent)).toEqual(['นั่งร้าน'])

    fireEvent.click(screen.getByText('ขายสินค้า'))
    expect((screen.getByLabelText('หมวดหมู่') as HTMLSelectElement).value).toBe('ALL')
    expect(screen.getAllByTestId('card').map((c) => c.textContent)).toEqual(['ตะปู'])
  })

  it('a mode changed by the page (not the switch) also falls back to every category', () => {
    const view = render(<ProductGrid products={PRODUCTS} onSelectProduct={() => {}} currentMode="RENT" />)
    fireEvent.change(screen.getByLabelText('หมวดหมู่'), { target: { value: 'นั่งร้าน' } })
    view.rerender(<ProductGrid products={PRODUCTS} onSelectProduct={() => {}} currentMode="SALE" />)
    expect(screen.getAllByTestId('card').map((c) => c.textContent)).toEqual(['ตะปู'])
  })
})
