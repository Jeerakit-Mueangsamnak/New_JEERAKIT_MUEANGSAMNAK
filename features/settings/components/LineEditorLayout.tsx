'use client'

import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { TABLE_LINE_COLOUR_CLASSES } from '@/components/common/ActionButton'

/**
 * One layout for every LINE work page (owner 2026-11-17: the LINE menu fits the screen, no page scroll):
 * [list] | work area | LINE preview. Each column scrolls on its own on wide screens; narrow screens stack.
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
        <aside className={`min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r ${TABLE_LINE_COLOUR_CLASSES} bg-slate-50 dark:bg-slate-900/40`}>
          {(listTitle || listAction) && (
            <div className={`shrink-0 h-11 px-2 flex items-center justify-between gap-2 border-b ${TABLE_LINE_COLOUR_CLASSES}`}>
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{listTitle}</span>
              {listAction}
            </div>
          )}
          <ul className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5 max-h-48 lg:max-h-none">{list}</ul>
        </aside>
      )}
      <div className="min-w-0 min-h-0 lg:overflow-y-auto p-3 flex flex-col gap-3">{children}</div>
      <aside
        aria-label="ตัวอย่างใน LINE"
        className={`min-h-0 lg:overflow-y-auto border-t lg:border-t-0 lg:border-l ${TABLE_LINE_COLOUR_CLASSES} bg-slate-50 dark:bg-slate-900/40 p-3`}
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
