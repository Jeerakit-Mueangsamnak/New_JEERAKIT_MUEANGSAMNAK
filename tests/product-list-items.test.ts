import { beforeEach, describe, expect, it, vi } from 'vitest'

// settings_update answers with the merged policies, like the server does.
const rpcMock = vi.fn(async (_fn: string, args: { p_patch: { policies: Record<string, unknown> } }) => ({
  policies: { ...currentPolicies, ...args.p_patch.policies },
}))
let currentPolicies: Record<string, unknown> = {}
vi.mock('@/lib/db/rpc', () => ({ rpc: (fn: string, args: never) => rpcMock(fn, args) }))

import { setCachedPolicies, getCategoryDefaults, saveCategoryDefault } from '@/lib/db/policies'
import {
  listItemOptions,
  sortCategoryNames,
  findCategoryListItem,
  addCategoryListItemAsync,
  renameCategoryListItemAsync,
  deleteCategoryListItemAsync,
} from '@/features/products/utils/list-items'

// Test categories (lib/category-rules-storage DEFAULT_CATEGORIES): cat-1 แบบคาน, cat-2 แบบเสา
function usePolicies(p: Record<string, unknown>) {
  currentPolicies = p
  setCachedPolicies(p)
}

beforeEach(() => {
  rpcMock.mockClear()
  usePolicies({ category_defaults: { 'cat-1': { calculationType: 'PER_ROUND', items: [{ name: 'แบบคาน40' }, { name: 'แบบคาน50', unitId: 'u-1' }] } } })
})

describe('รายการ of a category (owner 2026-11-02)', () => {
  it('lists the items added for the category, then items already used by its products', () => {
    expect(listItemOptions('แบบคาน')).toEqual(['แบบคาน40', 'แบบคาน50'])
    expect(listItemOptions('แบบคาน', [
      { category: 'แบบคาน', listItem: 'แบบคาน70' },
      { category: 'แบบคาน', listItem: 'แบบคาน70' },
      { category: 'แบบเสา', listItem: 'แบบคาน80' },
    ])).toEqual(['แบบคาน40', 'แบบคาน50', 'แบบคาน70'])
    expect(listItemOptions('แบบเสา')).toEqual([])
    expect(listItemOptions('')).toEqual([])
    expect(findCategoryListItem('cat-1', 'แบบคาน50')).toEqual({ name: 'แบบคาน50', unitId: 'u-1' })
  })

  it('adds an item to the chosen category and keeps its pricing defaults', async () => {
    await addCategoryListItemAsync('cat-1', ' แบบคาน60 ')
    const saved = rpcMock.mock.calls[0][1].p_patch.policies.category_defaults as Record<string, { calculationType?: string; items: unknown[] }>
    expect(saved['cat-1'].items).toEqual([{ name: 'แบบคาน40' }, { name: 'แบบคาน50', unitId: 'u-1' }, { name: 'แบบคาน60' }])
    expect(saved['cat-1'].calculationType).toBe('PER_ROUND')
  })

  it('refuses a duplicate name, and renaming / deleting an item a product uses', async () => {
    await expect(addCategoryListItemAsync('cat-1', 'แบบคาน40')).rejects.toThrow('มีอยู่ในหมวดหมู่นี้แล้ว')
    await expect(renameCategoryListItemAsync('cat-1', 'แบบคาน40', 'แบบคาน45', true)).rejects.toThrow('มีสินค้าใช้อยู่')
    await expect(deleteCategoryListItemAsync('cat-1', 'แบบคาน40', true)).rejects.toThrow('มีสินค้าใช้อยู่')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('saving a category pricing default keeps its items', async () => {
    await saveCategoryDefault('cat-1', { calculationType: 'PER_DAY', unitId: 'u-2' })
    expect(getCategoryDefaults()['cat-1']).toEqual({
      calculationType: 'PER_DAY',
      unitId: 'u-2',
      items: [{ name: 'แบบคาน40' }, { name: 'แบบคาน50', unitId: 'u-1' }],
    })
  })
})

describe('category order (owner 2026-11-02)', () => {
  it('แบบคาน แบบเสา แบบข้าง นั่งร้าน อื่นๆ first, any other category after in its own order', () => {
    expect(sortCategoryNames(['อื่นๆ', 'อุปกรณ์เสริม', 'นั่งร้าน', 'แบบเสา', 'ทั่วไป', 'แบบข้าง', 'แบบคาน']))
      .toEqual(['แบบคาน', 'แบบเสา', 'แบบข้าง', 'นั่งร้าน', 'อื่นๆ', 'อุปกรณ์เสริม', 'ทั่วไป'])
  })
})
