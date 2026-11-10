'use client'

import React from 'react'
import { Layers } from 'lucide-react'
import type { Product } from '@/lib/types/rental-pos'

interface AccessoryGroupCardProps {
  /** รายการ shown as one card (e.g. น็อต, อุปกรณ์นั่งร้าน). */
  title: string
  products: Product[]
  onClick: () => void
  allowOutOfStock?: boolean
}

const free = (p: Product) => {
  const n = Number(p.availableQuantity ?? p.available_qty ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** One POS card for a whole accessory รายการ (owner 2026-11-09): the window picks the size / parts. */
export function AccessoryGroupCard({ title, products, onClick, allowOutOfStock = false }: AccessoryGroupCardProps) {
  const outOfStock = products.every((p) => free(p) <= 0)
  const canPick = allowOutOfStock || !outOfStock
  const borderStyle = outOfStock
    ? `border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/60 ${allowOutOfStock ? 'opacity-70 hover:border-amber-400' : 'opacity-50 cursor-not-allowed'}`
    : 'border-emerald-200 dark:border-emerald-900 bg-white dark:bg-slate-800 hover:border-emerald-500 hover:shadow-lg'

  return (
    <div
      role="button"
      tabIndex={canPick ? 0 : -1}
      aria-disabled={!canPick}
      onClick={() => canPick && onClick()}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (canPick) onClick()
      }}
      className={`relative group min-h-[132px] rounded-xl p-2.5 md:p-3 border transition-all duration-200 cursor-pointer flex flex-col justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${borderStyle}`}
    >
      <div>
        <div className="flex items-center justify-between gap-1.5 mb-1.5">
          <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 tracking-wide">{products.length} รายการ</span>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            <Layers className="w-3 h-3" /> ไม่คิดเงิน
          </span>
        </div>
        <h4 className="text-xs md:text-sm font-bold leading-snug text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition-colors line-clamp-2">
          {title}
        </h4>
      </div>
      <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-700/50 space-y-0.5">
        {products.map((p) => (
          <div key={p.id} className={`text-[10px] md:text-[11px] font-bold truncate ${free(p) > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
            {p.name} คงเหลือ {free(p)} {p.unit_name || p.unit || 'ชิ้น'}
          </div>
        ))}
      </div>
    </div>
  )
}
