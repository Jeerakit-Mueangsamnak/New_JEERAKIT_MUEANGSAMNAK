// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Product } from '@/lib/types/rental-pos'
import { NutAccessoryModal, ScaffoldAccessoryModal } from '@/features/pos/components/AccessoryModals'
import { ProductGrid } from '@/features/pos/components/ProductGrid'
import { ProductCard } from '@/features/pos/components/ProductCard'
import {
  accessoryWindowFor,
  findNutProduct,
  findScaffoldPart,
  nutInches,
  nutTotal,
  scaffoldPartQuantities,
} from '@/features/pos/services/accessory-rules'

afterEach(cleanup)

// The shop's set-up on 2026-11-09: หมวด อื่นๆ › รายการ น็อต / อุปกรณ์นั่งร้าน, rentals without a charge.
const acc = (over: Partial<Product>): Product =>
  ({
    status: 'ACTIVE', isAccessory: true, isChargeable: false, availableQuantity: 1000, unit: 'ตัว', rentPrice: 0,
    category: 'อื่นๆ', productType: 'RENT', rentalType: 'NORMAL', calculationType: 'PER_ROUND', ...over,
  }) as Product
const products = [
  acc({ id: 'n12', code: 'ACC-NUT-0401', name: 'น็อต 12นิ้ว', listItem: 'น็อต' }),
  acc({ id: 'n14', code: 'ACC-NUT-0410', name: 'น็อต 14นิ้ว', listItem: 'น็อต' }),
  acc({ id: 'cross', name: 'กากบาท', listItem: 'อุปกรณ์นั่งร้าน', unit: 'คู่' }),
  acc({ id: 'cap', name: 'ครอบนั่งร้าน', listItem: 'อุปกรณ์นั่งร้าน' }),
  acc({ id: 'joint', name: 'ข้อต่อ', listItem: 'อุปกรณ์นั่งร้าน' }),
  acc({ id: 'old-cross', name: 'กากบาท (หมวดนั่งร้าน)', category: 'นั่งร้าน', listItem: 'กากบาท(2ตัว)' }),
  acc({ id: 'col', name: 'แบบเสา 15x15x3.00', category: 'แบบเสา', isAccessory: false, isChargeable: true, rentPrice: 15 }),
]

describe('accessory formulas and set-up (owner 2026-11-09)', () => {
  it('nuts: columns × nuts per column; the size is read from the name inside รายการ "น็อต"', () => {
    expect(nutTotal(14, 50)).toBe(700)
    expect(nutInches('น็อต 16นิ้ว')).toBe(16)
    expect(findNutProduct(products, 12)?.id).toBe('n12')
    expect(findNutProduct(products, 16)).toBeNull()
  })
  it('scaffold set = 1 กากบาท, 1 ครอบ, 4 ข้อต่อ, taken only from หมวด อื่นๆ › อุปกรณ์นั่งร้าน', () => {
    expect(scaffoldPartQuantities(26)).toEqual({ CROSS: 26, CAP: 26, JOINT: 104 })
    expect(findScaffoldPart(products, 'CROSS')?.id).toBe('cross')
    expect(findScaffoldPart(products.filter((p) => p.id !== 'cross'), 'CROSS')).toBeNull()
  })
  it('only the two รายการ of หมวด อื่นๆ open the windows', () => {
    expect(accessoryWindowFor(products[0])).toBe('NUT')
    expect(accessoryWindowFor(products[2])).toBe('SCAFFOLD')
    expect(accessoryWindowFor(products[5])).toBeNull()
    expect(accessoryWindowFor(products[6])).toBeNull()
  })
})

describe('POS cards', () => {
  it('each accessory รายการ is ONE card; tapping it hands over a product of that รายการ', () => {
    const onSelect = vi.fn()
    render(<ProductGrid products={products} onSelectProduct={onSelect} />)
    expect(screen.queryByText('น็อต 12นิ้ว', { selector: 'h4' })).toBeNull()
    const nutCard = screen.getByRole('heading', { name: 'น็อต' }).closest('[role="button"]') as HTMLElement
    expect(nutCard.textContent).toContain('ไม่คิดเงิน')
    fireEvent.click(nutCard)
    expect(onSelect).toHaveBeenCalledWith(products[0], 'RENT')
    expect(screen.getByRole('heading', { name: 'อุปกรณ์นั่งร้าน' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'แบบเสา 15x15x3.00' })).toBeDefined()
  })

  it('น็อต is the last card of หมวด แบบเสา, อุปกรณ์นั่งร้าน the last of หมวด นั่งร้าน (owner 2026-11-11)', () => {
    render(<ProductGrid products={products} onSelectProduct={vi.fn()} />)
    const names = ['แบบเสา 15x15x3.00', 'น็อต', 'กากบาท (หมวดนั่งร้าน)', 'อุปกรณ์นั่งร้าน']
    const order = screen
      .getAllByRole('heading')
      .map((h) => h.textContent?.trim() || '')
      .filter((t) => names.includes(t))
    expect(order).toEqual(names)
    expect(screen.queryByTestId('pinned-accessory-cards')).toBeNull()
  })

  it('a no-charge rental card says ไม่คิดเงิน instead of "ราคา 0" / รายรอบ', () => {
    render(<ProductCard product={products[5]} onClick={vi.fn()} />)
    expect(screen.getAllByText('ไม่คิดเงิน').length).toBeGreaterThan(0)
    expect(screen.queryByText(/ราคา 0/)).toBeNull()
    expect(screen.queryByText('รายรอบ')).toBeNull()
  })
})

describe('น็อตเสา window', () => {
  it('section + height + columns → one nut line (picture: 15×15, 3.50 ม., 50 → 12 นิ้ว 700 ตัว)', () => {
    const onAdd = vi.fn(() => true)
    const onClose = vi.fn()
    render(<NutAccessoryModal products={products} onAdd={onAdd} onClose={onClose} />)
    expect((screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'เสา 15×15' }))
    fireEvent.click(screen.getByRole('button', { name: '3.50 ม.' }))
    fireEvent.click(screen.getByRole('button', { name: '50' }))
    expect(screen.getByTestId('nut-size').textContent).toBe('12 นิ้ว')
    expect(screen.getByTestId('nut-result').textContent).toBe('700 ตัว')
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }))
    expect(onAdd).toHaveBeenCalledWith([{ product: products[0], quantity: 700 }])
    expect(onClose).toHaveBeenCalled()
  })

  it('a second tap on the quick number adds at once', () => {
    const onAdd = vi.fn(() => true)
    render(<NutAccessoryModal products={products} onAdd={onAdd} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'เสา 20×20' }))
    fireEvent.click(screen.getByRole('button', { name: '1.00 ม.' }))
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    expect(onAdd).toHaveBeenCalledWith([{ product: products[1], quantity: 12 }])
  })

  it('no nut of that size in รายการ "น็อต": says so and cannot add', () => {
    render(<NutAccessoryModal products={products} onAdd={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'เสา 25×25' }))
    fireEvent.click(screen.getByRole('button', { name: '2.00 ม.' }))
    expect(screen.getByRole('alert').textContent).toContain('16 นิ้ว')
    expect((screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('more than the free stock is refused on a bill, only warned on a quotation', () => {
    const low = [acc({ id: 'n12', name: 'น็อต 12นิ้ว', listItem: 'น็อต', availableQuantity: 30 })]
    const pick = () => {
      fireEvent.click(screen.getByRole('button', { name: 'เสา 15×15' }))
      fireEvent.click(screen.getByRole('button', { name: '3.00 ม.' }))
      fireEvent.click(screen.getByRole('button', { name: '10' }))
    }
    render(<NutAccessoryModal products={low} onAdd={vi.fn()} onClose={vi.fn()} />)
    pick()
    expect(screen.getByRole('alert').textContent).toContain('สต็อกพร้อมใช้มี 30')
    expect((screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    render(<NutAccessoryModal products={low} onAdd={vi.fn()} onClose={vi.fn()} allowOverStock />)
    pick()
    expect((screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('อุปกรณ์นั่งร้าน window', () => {
  it('sets work out every part (26 → 26 / 26 / 104); a part can be changed, 0 leaves it out', () => {
    const onAdd = vi.fn(() => true)
    render(<ScaffoldAccessoryModal products={products} onAdd={onAdd} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '26' }))
    expect((screen.getByLabelText('กากบาท (คู่)') as HTMLInputElement).value).toBe('26')
    expect((screen.getByLabelText('ครอบนั่งร้าน (ตัว)') as HTMLInputElement).value).toBe('26')
    expect((screen.getByLabelText('ข้อต่อ (ตัว)') as HTMLInputElement).value).toBe('104')
    fireEvent.change(screen.getByLabelText('ครอบนั่งร้าน (ตัว)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }))
    expect(onAdd).toHaveBeenCalledWith([
      { product: products[2], quantity: 26 },
      { product: products[4], quantity: 104 },
    ])
  })

  it('a part not yet in หมวด อื่นๆ › อุปกรณ์นั่งร้าน blocks the add and says which', () => {
    render(<ScaffoldAccessoryModal products={products.filter((p) => p.id !== 'joint')} onAdd={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('ข้อต่อ')
    expect((screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the add button works once (no double add)', () => {
    const onAdd = vi.fn(() => true)
    render(<ScaffoldAccessoryModal products={products} onAdd={onAdd} onClose={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
})

describe('สินค้า/สต็อก › คอลัมน์ราคาเช่า (owner 2026-11-09)', () => {
  it('a no-charge rental shows ไม่คิดเงิน instead of "0/รอบ"; a charged one keeps its price', async () => {
    Element.prototype.scrollTo = vi.fn() as never // jsdom has no scrollTo
    const { ProductListView } = await import('@/features/products/components/ProductListView')
    const noop = () => {}
    const fees = { defaultDamageFee: 0, defaultLossFee: 0, totalQuantity: 10, availableQuantity: 10 }
    const rows = [{ ...products[0], ...fees }, { ...products[6], ...fees }] as Product[]
    render(
      <ProductListView
        products={rows} paginatedProducts={rows} isLoading={false} searchTerm="" setSearchTerm={noop}
        categoryFilter="" setCategoryFilter={noop} statusFilter="" setStatusFilter={noop}
        activeViewTab="ALL" setActiveViewTab={noop} categories={[]} damagedProductsCount={0}
        onRestoreDamaged={noop} onTransformDamaged={noop} onOpenHistory={noop} onEditProduct={noop}
        onDeleteProduct={noop} onReactivateProduct={noop} onHardDeleteProduct={noop}
      />,
    )
    const nutRow = screen.getByText('น็อต 12นิ้ว').closest('tr')!
    expect(nutRow.textContent).toContain('ไม่คิดเงิน')
    expect(nutRow.textContent).not.toContain('0/รอบ')
    expect(screen.getByText('แบบเสา 15x15x3.00').closest('tr')!.textContent).toContain('15/รอบ')
  })
})
