'use client'

import React, { useState, useMemo } from 'react'
import { ProductCard } from './ProductCard'
import { Product } from '@/lib/types/rental-pos'
import { getProductType } from '@/features/products/services/product-storage'
import { CustomSelect } from '@/components/common/CustomSelect'
import { listItemOptions, sortCategoryNames } from '@/features/products/utils/list-items'
import { loadCategories } from '@/lib/category-rules-storage'
import { PackageX, RefreshCw, ShoppingCart } from 'lucide-react'

interface ProductGridProps {
  products: Product[]
  onSelectProduct: (product: Product, mode?: 'RENT' | 'SALE') => void
  currentMode?: 'RENT' | 'SALE'
  onModeChange?: (mode: 'RENT' | 'SALE') => void
  /** Quotation mode: out-of-stock products stay selectable. */
  allowOutOfStock?: boolean
}

/** One dropdown per category; its options are ทั้งหมด + the รายการ of that category (owner 2026-11-02). */
const ALL_ITEMS = 'ALL'

export function ProductGrid({
  products = [],
  onSelectProduct,
  currentMode,
  onModeChange,
  allowOutOfStock = false,
}: ProductGridProps) {
  const [internalMode, setInternalMode] = useState<'RENT' | 'SALE'>('RENT')
  const posMode = currentMode ?? internalMode

  // Nothing picked = every product. Picking in one category dropdown clears the others.
  const [selection, setSelection] = useState<{ category: string; item: string } | null>(null)

  // Switching เช่า/ขาย (or pressing the active one again) starts again from every product.
  const handleSetMode = (m: 'RENT' | 'SALE') => {
    setInternalMode(m)
    setSelection(null)
    if (onModeChange) onModeChange(m)
  }

  // Filter products by mode: RENT shows RENT + BOTH; SALE shows SALE + BOTH
  const modeProducts = useMemo(() => {
    return products.filter((p) => {
      if (p.status !== 'ACTIVE') return false
      const pType = getProductType(p)
      if (posMode === 'RENT') {
        if (pType === 'SALE') return false
        // RENT + BOTH: supports 0-baht items with requiresReturn or rental pricing
        const hasRentPrice = (p.rentPrice !== undefined && p.rentPrice !== null) || p.normalPrice !== undefined || p.dailyPrice !== undefined
        return hasRentPrice || p.requiresReturn !== false
      } else {
        if (pType === 'RENT') return false
        // SALE + BOTH: supports sale pricing
        const hasSalePrice = (p.salePrice !== undefined && p.salePrice !== null) || p.rentalType === 'SALE'
        return hasSalePrice
      }
    })
  }, [products, posMode])

  // Categories that have products in this mode: แบบคาน แบบเสา แบบข้าง นั่งร้าน อื่นๆ first (owner),
  // then any other category in the order of สินค้า › ตั้งค่าเสริม.
  const categoryNames = useMemo(() => {
    const present = new Set(modeProducts.map((p) => p.category).filter(Boolean) as string[])
    const ordered = loadCategories().map((c) => c.name).filter((name) => present.has(name))
    for (const name of present) if (!ordered.includes(name)) ordered.push(name)
    return sortCategoryNames(ordered)
  }, [modeProducts])

  // A category the current mode has no products in counts as "nothing picked".
  const active = selection && categoryNames.includes(selection.category) ? selection : null

  const dropdowns = useMemo(
    () =>
      categoryNames.map((name) => {
        const inCategory = modeProducts.filter((p) => p.category === name)
        const items = listItemOptions(name, inCategory)
        return {
          name,
          options: [
            { value: ALL_ITEMS, label: `ทั้งหมด (${inCategory.length})` },
            ...items.map((item) => ({
              value: item,
              label: `${item} (${inCategory.filter((p) => p.listItem === item).length})`,
            })),
          ],
        }
      }),
    [categoryNames, modeProducts]
  )

  const filteredProducts = useMemo(() => {
    if (!active) return modeProducts
    return modeProducts.filter(
      (p) => p.category === active.category && (active.item === ALL_ITEMS || p.listItem === active.item)
    )
  }, [modeProducts, active])

  // Products separated by หมวดหมู่ › รายการ (same order as the dropdowns); no รายการ = last in its category.
  const groups = useMemo(() => {
    const result: { key: string; category: string; item: string; products: Product[] }[] = []
    for (const d of dropdowns) {
      const inCategory = filteredProducts.filter((p) => p.category === d.name)
      if (inCategory.length === 0) continue
      const itemNames = d.options.map((o) => String(o.value)).filter((v) => v !== ALL_ITEMS)
      for (const item of [...itemNames, '']) {
        const list = inCategory.filter((p) => (p.listItem || '') === item)
        if (list.length > 0) result.push({ key: `${d.name}\u0000${item}`, category: d.name, item, products: list })
      }
    }
    // Products without a category still show (after the categories), as before.
    const known = new Set(dropdowns.map((d) => d.name))
    const rest = filteredProducts.filter((p) => !known.has(p.category))
    if (rest.length > 0) result.push({ key: '\u0000rest', category: 'ไม่ระบุหมวดหมู่', item: '', products: rest })
    return result
  }, [dropdowns, filteredProducts])

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 max-w-full space-y-2 overflow-hidden">
      {/* Header controls: Mode Switcher -> one dropdown per category (no search box, owner 2026-11-02) */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs shrink-0 min-w-0 max-w-full">
        {/* Mode Toggle: [ เช่าสินค้า ] [ ขายสินค้า ] */}
        <div className="flex items-center h-9 p-0.5 sm:p-1 gap-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0 w-auto">
          <button
            type="button"
            onClick={() => handleSetMode('RENT')}
            className={`h-7 w-auto px-2 sm:px-3 py-0 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer ${
              posMode === 'RENT'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>เช่าสินค้า</span>
          </button>
          <button
            type="button"
            onClick={() => handleSetMode('SALE')}
            className={`h-7 w-auto px-2 sm:px-3 py-0 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer ${
              posMode === 'SALE'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
            <span>ขายสินค้า</span>
          </button>
        </div>

        {/* Category dropdowns: as many as fit next to เช่า/ขาย (each at least 6.5rem); the rest wrap to
            a 2nd line of the same box — never wider than the panel, no sideways scrolling */}
        {dropdowns.map((d) => {
          const isActive = active?.category === d.name
          return (
            <div key={d.name} className="flex-1 basis-[6.5rem] min-w-[6.5rem] max-w-[11rem]">
              <CustomSelect
                ariaLabel={d.name}
                value={isActive ? active.item : ''}
                onChange={(val) => setSelection({ category: d.name, item: String(val) })}
                options={d.options}
                placeholder={d.name}
                placeholderClassName="font-bold"
                buttonClassName={`h-9 px-2 sm:px-2.5 py-0 text-xs rounded-xl ${
                  isActive ? '!border-blue-500 ring-1 ring-blue-500' : ''
                }`}
              />
            </div>
          )
        })}
      </div>

      {/* Grid view */}
      {filteredProducts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          <PackageX className="w-12 h-12 text-slate-300 dark:text-slate-400 mb-3" />
          <h4 className="font-bold text-slate-700 dark:text-slate-300">
            {posMode === 'RENT' ? 'ไม่พบสินค้าสำหรับเช่า' : 'ไม่พบสินค้าสำหรับขาย'}
          </h4>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">ลองเลือกหมวดหมู่หรือรายการอื่น</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar pr-0.5 pb-2 space-y-3">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 content-start">
                {g.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    mode={posMode}
                    allowOutOfStock={allowOutOfStock}
                    onClick={() => onSelectProduct(product, posMode)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
