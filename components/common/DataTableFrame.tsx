'use client'

import React from 'react'
import { TABLE_LINE_COLOUR_CLASSES } from '@/components/common/ActionButton'

export interface DataTableFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  header?: React.ReactNode
  footer?: React.ReactNode
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
  /** Controls inside the row-count bar (e.g. ย้อนกลับ / ถัดไป): left and right, the count then sits in the middle. */
  countBarStart?: React.ReactNode
  countBarEnd?: React.ReactNode
  children: React.ReactNode
}

export const DATA_TABLE_FRAME_HEIGHT_CLASSES = 'min-h-[320px] max-h-[380px]'
// System table colour #749bfc for every table header and row-count bar, light and dark (owner 2026-11-10).
// Dark text keeps WCAG AA contrast on it.
const TABLE_BAR_COLOUR_CLASSES = 'bg-[#749bfc] text-slate-900'
// Every line inside a table (row lines, header line, cell borders) is #acacad (owner 2026-11-11). `!` wins over
// the colour each table puts on its own rows (divide-* / border-*), so the colour lives only here.
const TABLE_INNER_LINE_CLASSES = '[&_thead]:!border-[#acacad] [&_tr]:!border-[#acacad] [&_th]:!border-[#acacad] [&_td]:!border-[#acacad]'
export const DATA_TABLE_THEAD_CLASSES = `sticky top-0 z-20 ${TABLE_BAR_COLOUR_CLASSES} font-bold`
export const DATA_TABLE_TH_CLASSES = 'py-2 font-bold whitespace-nowrap'
/**
 * Shared standard table class based on StockReportView:
 * Full width, table-auto (browser distributes column widths automatically),
 * border-collapse, and left-aligned.
 */
export const DATA_TABLE_CLASSES = 'w-full text-left border-collapse table-auto'
/**
 * DataTableFrame: Source of truth for full data tables (same pattern as the product list).
 * Only the rows scroll: the thead is sticky at the top and the header/footer/row-count bar sit
 * outside the scroll area. `fill` takes the remaining height of the parent; otherwise the rows
 * area is a fixed 320–380px box so the page never grows with the row count. The table rows and
 * header keep their natural size; the scroll area uses any remaining workspace space.
 * With no rows the table still shows its header (owner 2026-11-06: no empty-state text).
 */
export function DataTableFrame({
  header,
  footer,
  className = '',
  bodyClassName = '',
  containerClassName = '',
  fill = false,
  rowCount,
  shownCount,
  scrollRef,
  countBarStart,
  countBarEnd,
  children,
  ...props
}: DataTableFrameProps) {
  const countText = rowCount === undefined ? '' : rowCount > 0 ? `แสดง ${Math.min(shownCount ?? rowCount, rowCount)} จากทั้งหมด ${rowCount} รายการ` : '0 รายการ'
  const barControls = countBarStart !== undefined || countBarEnd !== undefined
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
          className={`overflow-y-auto overflow-x-auto ${fill ? 'h-full' : DATA_TABLE_FRAME_HEIGHT_CLASSES} [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20 [&_thead]:bg-[#749bfc] dark:[&_thead]:bg-[#749bfc] [&_thead]:text-slate-900 dark:[&_thead]:text-slate-900 [&_thead]:font-bold [&_thead]:shadow-xs [&_th]:py-2 [&_th]:font-bold [&_th]:whitespace-nowrap [&_td]:py-1.5 ${TABLE_INNER_LINE_CLASSES} ${bodyClassName}`.trim()}
        >
          {children}
        </div>
      </div>

      {/* Row-count bar sits right under the rows (no gap); a custom footer goes below it. */}
      {rowCount !== undefined && !barControls && (
        <div
          className={`shrink-0 px-2 py-1.5 ${TABLE_BAR_COLOUR_CLASSES} border-t ${TABLE_LINE_COLOUR_CLASSES} text-xs truncate ${padded ? `-mx-2 ${footer ? '' : '-mb-2'}` : ''}`.trim()}
        >
          {countText}
        </div>
      )}
      {rowCount !== undefined && barControls && (
        <div
          className={`shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 py-1.5 ${TABLE_BAR_COLOUR_CLASSES} border-t ${TABLE_LINE_COLOUR_CLASSES} text-xs ${padded ? `-mx-2 ${footer ? '' : '-mb-2'}` : ''}`.trim()}
        >
          <div className="flex justify-start min-w-0">{countBarStart}</div>
          <span className="truncate text-center">{countText}</span>
          <div className="flex justify-end min-w-0">{countBarEnd}</div>
        </div>
      )}

      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  )
}
