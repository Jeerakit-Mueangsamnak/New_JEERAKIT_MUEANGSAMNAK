'use client'

import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { TABLE_LINE_COLOUR_CLASSES } from '@/components/common/ActionButton'

/**
 * One layout for every LINE work page (owner 2026-11-17: the LINE menu fits the screen, no page scroll):
 * [list] | work area | LINE preview. Each column scrolls on its own on wide screens; narrow screens stack
 * and the whole page scrolls. min-h-0 only from lg: on a stacked (fixed-height) grid it let the rows shrink
 * below their content, so the parts drew over each other (iPad portrait, owner 2026-11-20).
 */
export function LineEditorLayout({
  list,
  listTitle,
  listAction,
  children,
  preview,
}: {
  /** Left column (e.g. the saved items); leave out for work area + preview only */
  list?: ReactNode
  listTitle?: string
  listAction?: ReactNode
  children: ReactNode
  preview: ReactNode
}) {
  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto lg:overflow-hidden grid grid-cols-1 ${
        list ? 'lg:grid-cols-[220px_minmax(0,1fr)_300px]' : 'lg:grid-cols-[minmax(0,1fr)_300px]'
      }`}
    >
      {list && (
        <aside className={`lg:min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r ${TABLE_LINE_COLOUR_CLASSES} bg-slate-50 dark:bg-slate-900/40`}>
          {(listTitle || listAction) && (
            <div className={`shrink-0 h-11 px-2 flex items-center justify-between gap-2 border-b ${TABLE_LINE_COLOUR_CLASSES}`}>
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{listTitle}</span>
              {listAction}
            </div>
          )}
          <ul className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5 max-h-48 lg:max-h-none">{list}</ul>
        </aside>
      )}
      <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto p-3 flex flex-col gap-3">{children}</div>
      <aside
        aria-label="ตัวอย่างใน LINE"
        className={`lg:min-h-0 lg:overflow-y-auto border-t lg:border-t-0 lg:border-l ${TABLE_LINE_COLOUR_CLASSES} bg-slate-50 dark:bg-slate-900/40 p-3`}
      >
        {preview}
      </aside>
    </div>
  )
}

/** A row of the left list: a name, a short line under it, optional colour dot and delete button. */
export function LineListItem({
  title,
  sub,
  subTone = 'muted',
  active,
  dot,
  onSelect,
  onDelete,
  deleteLabel,
  disabled,
}: {
  title: string
  sub?: string
  subTone?: 'muted' | 'accent'
  active: boolean
  dot?: string
  onSelect: () => void
  onDelete?: () => void
  deleteLabel?: string
  disabled?: boolean
}) {
  return (
    <li
      className={`flex items-center gap-1 rounded-lg ${
        active ? 'bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700' : 'hover:bg-white/60 dark:hover:bg-slate-800/60'
      }`}
    >
      <button type="button" aria-current={active} onClick={onSelect} className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer">
        {dot && <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: dot }} />}
        <span className="min-w-0">
          <span className={`block text-xs truncate ${active ? 'font-bold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>{title}</span>
          {sub && (
            <span className={`block text-[10px] font-semibold truncate ${subTone === 'accent' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
              {sub}
            </span>
          )}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          aria-label={deleteLabel}
          className="w-7 h-7 mr-1 shrink-0 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  )
}

/**
 * A message of the library as a card (owner 2026-11-25, line.html "คลังข้อความ"): name, the start of the text that is
 * sent, who gets it, and whether the shop changed it. The open one has the green edge and กำลังแสดงตัวอย่าง.
 */
export function LineTemplateCard({
  title,
  text,
  to,
  custom,
  active,
  onSelect,
}: {
  title: string
  text: string
  to: string
  custom: boolean
  active: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active}
        onClick={onSelect}
        className={`w-full text-left rounded-xl border-2 p-2 transition-colors cursor-pointer ${
          active
            ? 'border-emerald-700 dark:border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30'
            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
        }`}
      >
        <span className="flex items-start justify-between gap-1">
          <span className={`text-xs leading-snug ${active ? 'font-bold text-slate-900 dark:text-slate-100' : 'font-semibold text-slate-800 dark:text-slate-200'}`}>{title}</span>
          {active && <span className="shrink-0 h-4 px-1.5 rounded-full text-[9px] font-bold inline-flex items-center bg-emerald-700 text-white">กำลังแสดงตัวอย่าง</span>}
        </span>
        <span className="mt-1 block text-[10px] leading-relaxed text-slate-600 dark:text-slate-400 line-clamp-2 whitespace-pre-line">{text}</span>
        <span className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-[10px] font-semibold">
          <span className="text-slate-500 dark:text-slate-400">ถึง{to}</span>
          <span className={custom ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>{custom ? 'แก้แล้ว' : 'มาตรฐาน'}</span>
        </span>
      </button>
    </li>
  )
}

/** Empty left list. */
export function LineListEmpty({ text }: { text: string }) {
  return <li className="px-2.5 py-6 text-center text-xs text-slate-500 dark:text-slate-400">{text}</li>
}

/** Title line of a block inside the work area (same look as the settings card titles). */
export function LineBlockTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`shrink-0 pb-1.5 border-b ${TABLE_LINE_COLOUR_CLASSES} flex items-center justify-between gap-2`}>
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 min-w-0">{children}</h3>
      {action}
    </div>
  )
}
