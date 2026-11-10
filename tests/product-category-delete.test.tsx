// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Product, Unit } from '@/lib/types/rental-pos'
import { DbError } from '@/lib/db/rpc'

const mocks = vi.hoisted(() => ({
  deleteCategory: vi.fn(async (_id: string) => undefined),
  saveCategory: vi.fn(async (c: { id?: string }) => c.id ?? 'new'),
  deleteUnit: vi.fn(async (_id: string) => undefined),
}))
vi.mock('@/features/products/api/product-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/products/api/product-repository')>()),
  deleteCategoryFromSupabase: mocks.deleteCategory,
  saveCategoryToSupabase: mocks.saveCategory,
  deleteUnitFromSupabase: mocks.deleteUnit,
}))

import { ProductSettingsView } from '@/features/products/components/ProductSettingsView'
import { ConfirmDialogProvider } from '@/components/common/ConfirmDialogProvider'
import { setCachedCategories, type CategoryCompositeRule, type ProductCategoryItem } from '@/lib/category-rules-storage'
import { setCachedUnits } from '@/lib/unit-storage'

const categories: ProductCategoryItem[] = [
  { id: 'c-used', name: 'แบบเสา', isActive: true },
  { id: 'c-empty', name: 'เทส1', isActive: true },
  { id: 'c-off', name: 'หมวดเก่า', isActive: false },
]
const units: Unit[] = [{ id: 'u-rule', name: 'ต้น', isActive: true }]
// Every category has its own default row in ตารางประกอบข้อมูล; one row uses the unit ต้น.
const compositeRules: CategoryCompositeRule[] = categories.map((c) => ({
  id: `comp-${c.id}`, categoryId: c.id, calculationType: 'PER_ROUND', unitId: c.id === 'c-used' ? 'u-rule' : undefined,
}))
const products = [{ id: 'p1', name: 'แบบเสา 20x20x3.00', category: 'แบบเสา', categoryId: 'c-used' }] as unknown as Product[]

function mount(onShowToast = vi.fn()) {
  setCachedCategories(categories)
  setCachedUnits(units)
  render(
    <ConfirmDialogProvider>
      <ProductSettingsView
        categories={categories}
        setCategories={vi.fn()}
        compositeRules={compositeRules}
        setCompositeRules={vi.fn()}
        masterUnits={units}
        setMasterUnits={vi.fn()}
        allProducts={products}
        onShowToast={onShowToast}
      />
    </ConfirmDialogProvider>
  )
  return onShowToast
}

const rowOf = (name: string) => screen.getAllByTitle(name).find((el) => el.closest('tr'))!.closest('tr')!

describe('ตั้งค่าสินค้า: ลบ / ระงับ หมวดหมู่และหน่วยนับ', () => {
  beforeEach(() => {
    mocks.deleteCategory.mockReset().mockResolvedValue(undefined)
    mocks.saveCategory.mockClear()
    mocks.deleteUnit.mockClear()
  })
  afterEach(() => cleanup())

  it('a category no product uses is deleted for real after "ลบถาวร"', async () => {
    const toast = mount()
    fireEvent.click(within(rowOf('เทส1')).getByTitle('ลบ'))
    fireEvent.click(await screen.findByRole('button', { name: 'ลบถาวร' }))
    await waitFor(() => expect(mocks.deleteCategory).toHaveBeenCalledWith('c-empty'))
    expect(toast).toHaveBeenCalledWith('ลบหมวดหมู่สำเร็จ', expect.any(String), 'SUCCESS')
  })

  it('a category with products is blocked by the server; "เปลี่ยนเป็นระงับการใช้งาน" suspends it', async () => {
    mocks.deleteCategory.mockRejectedValueOnce(new DbError('CATEGORY_IN_USE: 1'))
    const toast = mount()
    fireEvent.click(within(rowOf('แบบเสา')).getByTitle('ลบ'))
    fireEvent.click(await screen.findByRole('button', { name: 'ลบถาวร' }))
    expect(await screen.findByText(/พบในสินค้าจำนวน 1 รายการ/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นระงับการใช้งาน' }))
    await waitFor(() => expect(mocks.saveCategory).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-used', isActive: false })))
    expect(toast).toHaveBeenCalledWith('ระงับหมวดหมู่แล้ว', expect.any(String), 'SUCCESS')
  })

  it('a suspended category is listed with a tag and can be switched on again', async () => {
    mount()
    const row = rowOf('หมวดเก่า')
    expect(within(row).getByText('ระงับ')).toBeDefined()
    fireEvent.click(within(row).getByTitle('เปิดใช้งาน'))
    await waitFor(() => expect(mocks.saveCategory).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-off', isActive: true })))
  })

  it('a unit used in ตารางประกอบข้อมูล is blocked without asking the server', async () => {
    mount()
    fireEvent.click(within(rowOf('ต้น')).getByTitle('ลบ'))
    fireEvent.click(await screen.findByRole('button', { name: 'ลบถาวร' }))
    expect(await screen.findByText(/พบในตารางประกอบข้อมูลจำนวน 1 รายการ/)).toBeDefined()
    expect(mocks.deleteUnit).not.toHaveBeenCalled()
  })
})
