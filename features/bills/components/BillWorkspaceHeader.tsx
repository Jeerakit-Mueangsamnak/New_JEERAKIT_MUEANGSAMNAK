'use client'

import { TAB_BAR_SURFACE_CLASSES, TAB_BUTTON_BASE_CLASSES, TAB_BUTTON_ACTIVE_CLASSES, TAB_BUTTON_INACTIVE_CLASSES } from '@/components/common/ActionButton'
import React from 'react'

export type BillWorkspaceTab = 'RETURN' | 'DOCS' | 'HISTORY'

const TABS: { tab: BillWorkspaceTab; label: string }[] = [
  { tab: 'RETURN', label: 'รับคืนสินค้า' },
  { tab: 'DOCS', label: 'เอกสาร' },
  { tab: 'HISTORY', label: 'ประวัติรายการ' },
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
      {/* owner 2026-11-07: the three tabs sit in a coloured strip, like the customer page tabs */}
      <div
        role="tablist"
        aria-label="งานของบิล"
        className={`${TAB_BAR_SURFACE_CLASSES} grid min-w-0 flex-1 grid-cols-3`}
      >
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
              className={`${TAB_BUTTON_BASE_CLASSES} min-w-0 truncate ${active ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
