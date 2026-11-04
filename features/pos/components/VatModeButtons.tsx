'use client'

import React from 'react'
import { Info } from 'lucide-react'

export type VatMode = 'INCLUSIVE' | 'EXCLUSIVE'

interface VatModeButtonsProps {
  /** The pressed button; null = none pressed = no VAT on this document. */
  mode: VatMode | null
  /** Pressing the chosen button again cancels it (parent decides). */
  onToggle: (mode: VatMode) => void
  /** The shop's VAT rate (%) from Settings; null / 0 = not set yet → buttons are disabled. */
  vatRate: number | null | undefined
  disabled?: boolean
}

const OPTIONS: ReadonlyArray<readonly [VatMode, string]> = [
  ['INCLUSIVE', 'รวม VAT'],
  ['EXCLUSIVE', 'ไม่รวม VAT'],
]

/** รวม VAT / ไม่รวม VAT of ONE document (bill on the payment page, quotation in the POS cart).
 *  Owner 2026-11-04: the rate comes only from Settings; the way it is priced is chosen here. */
export function VatModeButtons({ mode, onToggle, vatRate, disabled = false }: VatModeButtonsProps) {
  const configured = vatRate != null && vatRate > 0
  return (
    <div className="shrink-0">
      <div className={`flex items-center gap-2 text-xs ${configured ? '' : 'opacity-60'}`}>
        <span className="flex shrink-0 items-center gap-1 font-bold text-slate-900 dark:text-slate-100">
          {configured ? `VAT ${vatRate}%` : 'VAT'}
          <span
            role="img"
            aria-label="รวม VAT / ไม่รวม VAT คืออะไร"
            title="รวม VAT = ราคาสินค้ามี VAT รวมอยู่แล้ว (ยอดไม่เพิ่ม) · ไม่รวม VAT = บวก VAT เพิ่มจากยอด · ไม่กดปุ่มใด = ไม่คิด VAT (กดปุ่มที่เลือกอยู่ซ้ำเพื่อยกเลิก)"
            className="text-slate-500 dark:text-slate-400"
          >
            <Info className="h-4 w-4" />
          </span>
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:gap-2">
          {OPTIONS.map(([value, label]) => {
            const selected = configured && mode === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                disabled={!configured || disabled}
                onClick={() => onToggle(value)}
                className={`min-h-[36px] min-w-0 truncate rounded-xl border-2 px-2 py-1.5 text-xs font-bold transition-all disabled:cursor-not-allowed ${
                  selected
                    ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/50'
                } ${configured ? 'cursor-pointer' : ''}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
      {!configured && (
        <span className="mt-0.5 block text-[11px] text-slate-600 dark:text-slate-400">เจ้าของร้านยังไม่ได้ตั้งอัตรา VAT</span>
      )}
    </div>
  )
}
