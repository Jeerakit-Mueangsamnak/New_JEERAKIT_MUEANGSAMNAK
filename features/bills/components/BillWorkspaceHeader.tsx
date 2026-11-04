'use client'

import React from 'react'

export type BillWorkspaceTab = 'RETURN' | 'DOCS' | 'HISTORY'

const TABS: { tab: BillWorkspaceTab; label: string; activeClass: string }[] = [
  { tab: 'RETURN', label: 'รับคืนสินค้า', activeClass: 'bg-emerald-700 border-emerald-600 text-white shadow-sm' },
  { tab: 'DOCS', label: 'เอกสาร', activeClass: 'bg-slate-700 border-slate-700 text-white shadow-sm' },
  { tab: 'HISTORY', label: 'ประวัติรายการ', activeClass: 'bg-slate-700 border-slate-700 text-white shadow-sm' },
]

interface BillWorkspaceHeaderProps {
  tab: BillWorkspaceTab
  onTab: (tab: BillWorkspaceTab) => void
  /** Cancelled / void bills hold no goods: nothing to take back. */
  returnDisabled?: boolean
}

/** The tabs of the bill workspace (no bill summary card and no back arrow: owner 2026-11-04). */
export function BillWorkspaceHeader({ tab, onTab, returnDisabled = false }: BillWorkspaceHeaderProps) {
  return (
    <div className="shrink-0 flex items-center gap-2">
      <div role="tablist" aria-label="งานของบิล" className="grid min-w-0 flex-1 grid-cols-3 gap-1.5 sm:gap-2">
        {TABS.map((t) => {
          const active = tab === t.tab
          const disabled = t.tab === 'RETURN' && returnDisabled
          return (
            <button
              key={t.tab}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              title={disabled ? 'บิลยกเลิก/โมฆะ รับคืนสินค้าไม่ได้' : undefined}
              onClick={() => onTab(t.tab)}
              className={`py-1.5 sm:py-2 px-2 rounded-xl text-center text-xs font-bold transition-all truncate whitespace-nowrap min-w-0 border ${
                active
                  ? t.activeClass
                  : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
