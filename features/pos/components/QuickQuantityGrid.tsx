'use client'

import React from 'react'

interface QuickQuantityGridProps {
  /** Number shown as picked (null = none). */
  selected: number | null
  /** First tap picks a number; a second tap on the same number confirms it (`onConfirm`). */
  onPick: (num: number) => void
  onConfirm: (num: number) => void
  /** The picked number was tapped once already (waiting for the confirming tap). */
  pendingConfirm: boolean
}

/** "เลือกจำนวนแบบเร็ว (1–50)" grid shared by the POS quantity and accessory windows. */
export function QuickQuantityGrid({ selected, onPick, onConfirm, pendingConfirm }: QuickQuantityGridProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
          เลือกจำนวนแบบเร็ว (1-50) — <span className="text-blue-600 dark:text-blue-400">กดครั้งที่ 2 เพื่อยืนยันทันที</span>
        </span>
      </div>
      <div className="grid grid-cols-5 sm:grid-cols-10 gap-1 max-h-44 overflow-y-auto p-1 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
        {Array.from({ length: 50 }, (_, i) => i + 1).map((num) => {
          const isSelected = selected === num
          return (
            <button
              key={num}
              type="button"
              onClick={() => (isSelected && pendingConfirm ? onConfirm(num) : onPick(num))}
              className={`py-1.5 rounded-lg font-bold text-xs transition-all duration-150 ${
                isSelected
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500 shadow-md scale-105'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
              }`}
            >
              {num}
            </button>
          )
        })}
      </div>
    </div>
  )
}
