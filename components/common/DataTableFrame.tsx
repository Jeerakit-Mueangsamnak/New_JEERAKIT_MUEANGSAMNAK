'use client'

import React from 'react'

export interface DataTableFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  header?: React.ReactNode
  footer?: React.ReactNode
  empty?: boolean
  emptyState?: React.ReactNode
  bodyClassName?: string
  containerClassName?: string
  /** Fill the parent's height (scroll inside) instead of the fixed 320–380px box. */
  fill?: boolean
  /** Total rows; renders the sticky row-count bar (same as the product list). */
  rowCount?: number
  /** Rows currently rendered when loading incrementally (defaults to rowCount). */
  shownCount?: number
  /** Ref on the rows' scroll area (e.g. useAutoFitPageSize().containerRef for incremental rows). */
  scrollRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}

export const DATA_TABLE_FRAME_HEIGHT_CLASSES = 'min-h-[320px] max-h-[380px]'
export const DATA_TABLE_THEAD_CLASSES = 'sticky top-0 z-20 bg-[#E3E3E3] dark:bg-slate-800 font-bold'
export const DATA_TABLE_TH_CLASSES = 'py-2 font-bold whitespace-nowrap'
export const DATA_TABLE_TD_CLASSES = 'py-1.5'

/**
 * Shared standard table class based on StockReportView:
 * Full width, table-auto (browser distributes column widths automatically),
 * border-collapse, and left-aligned.
 */
export const DATA_TABLE_CLASSES = 'w-full text-left border-collapse table-auto'
export const DATA_TABLE_AUTO_CLASSES = DATA_TABLE_CLASSES
export const DATA_TABLE_LAYOUT_CLASSES = DATA_TABLE_CLASSES

/**
 * DataTableFrame: Source of truth for full data tables (same pattern as the product list).
 * Only the rows scroll: the thead is sticky at the top and the header/footer/row-count bar sit
 * outside the scroll area. `fill` takes the remaining height of the parent; otherwise the rows
 * area is a fixed 320–380px box so the page never grows with the row count.
 */
export function DataTableFrame({
  header,
  footer,
  empty,
  emptyState,
  className = '',
  bodyClassName = '',
  containerClassName = '',
  fill = false,
  rowCount,
  shownCount,
  scrollRef,
  children,
  ...props
}: DataTableFrameProps) {
  const baseCard = className.includes('rounded-')
    ? className
    : `p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs ${className}`
  // Padded cards pull the row-count bar out to the card edges, like the product list footer.
  const padded = /(^|\s)p-2(\s|$)/.test(baseCard)

  return (
    <div
      className={`flex flex-col min-h-0 overflow-hidden ${baseCard}`.trim()}
      {...props}
    >
      {header && <div className="shrink-0">{header}</div>}

      {/* Padded cards: the table area is full-bleed (thead, rows and count bar share the card edges). */}
      <div
        className={`flex-1 min-h-0 overflow-hidden ${padded ? `-mx-2 ${!footer && rowCount === undefined ? '-mb-2' : ''}` : ''} ${containerClassName}`.trim()}
      >
        <div
          ref={scrollRef}
          className={`overflow-y-auto overflow-x-auto ${fill ? 'h-full' : DATA_TABLE_FRAME_HEIGHT_CLASSES} [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20 [&_thead]:bg-[#E3E3E3] dark:[&_thead]:bg-slate-800 [&_thead]:font-bold [&_thead]:shadow-xs [&_th]:py-2 [&_th]:font-bold [&_th]:whitespace-nowrap [&_td]:py-1.5 ${bodyClassName}`.trim()}
        >
          {empty && emptyState ? emptyState : children}
        </div>
      </div>

      {/* Row-count bar sits right under the rows (no gap); a custom footer goes below it. */}
      {rowCount !== undefined && (
        <div
          className={`shrink-0 px-2 py-1.5 bg-slate-100/70 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 truncate ${padded ? `-mx-2 ${footer ? '' : '-mb-2'}` : ''}`.trim()}
        >
          {rowCount > 0
            ? `แสดง ${Math.min(shownCount ?? rowCount, rowCount)} จากทั้งหมด ${rowCount} รายการ`
            : '0 รายการ'}
        </div>
      )}

      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  )
}
