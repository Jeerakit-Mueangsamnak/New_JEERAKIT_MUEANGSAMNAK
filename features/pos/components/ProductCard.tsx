'use client'

import React from 'react'
import { Product } from '@/lib/types/rental-pos'
import { Clock, RefreshCw, AlertCircle, ShoppingCart } from 'lucide-react'
import { isLowStock as isBelowReorderPoint } from '@/features/products/utils/low-stock'

interface ProductCardProps {
  product: Product
  mode?: 'RENT' | 'SALE'
  onClick: (product: Product) => void
  /** Quotation mode: an out-of-stock product can still be quoted (shown dimmed, not locked). */
  allowOutOfStock?: boolean
}

export function ProductCard({ product, mode = 'RENT', onClick, allowOutOfStock = false }: ProductCardProps) {
  const stockValue = Number(product.availableQuantity ?? product.available_qty ?? 0)
  const available = Number.isFinite(stockValue) && stockValue > 0 ? stockValue : 0
  const isOutOfStock = available <= 0
  const isLowStock = !isOutOfStock && isBelowReorderPoint({ availableQuantity: available, minimumStock: product.minimumStock })

  let borderStyle = 'border-emerald-200 dark:border-emerald-900 bg-white dark:bg-slate-800 hover:border-emerald-500 hover:shadow-lg'
  if (isOutOfStock && allowOutOfStock) {
    borderStyle = 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/60 opacity-70 hover:border-amber-400'
  } else if (isOutOfStock) {
    borderStyle = 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/60 opacity-50 cursor-not-allowed'
  } else if (isLowStock) {
    borderStyle = 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 hover:border-amber-500 hover:shadow-md'
  }

  const isSaleMode = mode === 'SALE' || (mode !== 'RENT' && product.rentalType === 'SALE')
  const isDaily = product.calculationType === 'PER_DAY' || product.rentalType === 'DAILY'

  const price = isSaleMode
    ? (product.salePrice ?? product.sale_price ?? 0)
    : (product.rentPrice !== undefined && product.rentPrice !== null
        ? product.rentPrice
        : isDaily
          ? (product.daily_price ?? product.dailyPrice ?? 0)
          : (product.normal_price ?? product.normalPrice ?? 0))

  // A rental the shop does not charge for (สินค้า › วิธีคิดราคา "ไม่คิดเงิน"): no price, no per-round label.
  const noCharge = !isSaleMode && product.isChargeable === false

  const typeBadge = noCharge
    ? {
        classes: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
        icon: <RefreshCw className="w-3 h-3" />,
        label: 'ไม่คิดเงิน',
      }
    : isSaleMode
    ? {
        classes: 'bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300',
        icon: <ShoppingCart className="w-3 h-3" />,
        label: 'ขาย',
      }
    : isDaily
      ? {
          classes: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
          icon: <Clock className="w-3 h-3" />,
          label: 'รายวัน',
        }
      : {
          classes: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
          icon: <RefreshCw className="w-3 h-3" />,
          label: 'รายรอบ',
        }

  return (
    <div
      role="button"
      tabIndex={allowOutOfStock || !isOutOfStock ? 0 : -1}
      aria-disabled={!(allowOutOfStock || !isOutOfStock)}
      onClick={() => (allowOutOfStock || !isOutOfStock) && onClick(product)}
      // Keyboard: Enter / Space picks the product, like a tap
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (allowOutOfStock || !isOutOfStock) onClick(product)
      }}
      className={`relative group min-h-[132px] rounded-xl p-2.5 md:p-3 border transition-all duration-200 cursor-pointer flex flex-col justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${borderStyle}`}
    >
      <div>
        <div className="flex items-center justify-between gap-1.5 mb-1.5">
          <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 tracking-wide">
            {product.product_code || product.code}
          </span>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${typeBadge.classes}`}>
            {typeBadge.icon} {typeBadge.label}
          </span>
        </div>

        <h4 className="text-xs md:text-sm font-bold leading-snug text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition-colors line-clamp-2">
          {product.product_name || product.name}
        </h4>
      </div>

      <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-700/50 space-y-1">
        <div className="font-bold text-[10px] md:text-xs whitespace-nowrap">
          {isOutOfStock ? (
            <span className="text-red-700 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 shrink-0" /> สินค้าหมด
            </span>
          ) : isLowStock ? (
            <span className="text-amber-700 dark:text-amber-400">
              คงเหลือ {available} {product.unit_name || product.unit || 'ชิ้น'}
            </span>
          ) : (
            <span className="text-emerald-700 dark:text-emerald-400">
              คงเหลือ {available} {product.unit_name || product.unit || 'ชิ้น'}
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-1 text-xs text-slate-700 dark:text-slate-300">
          {noCharge ? (
            <span className="font-semibold">ไม่คิดเงิน</span>
          ) : (
            <>
              <span className="font-semibold">ราคา {price.toLocaleString('th-TH')}</span>
              <span className="text-slate-600 dark:text-slate-400 font-medium">/ {product.unit_name || product.unit || 'ชิ้น'}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
