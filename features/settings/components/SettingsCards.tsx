'use client'
/**
 * Settings laid out as cards (owner 2026-11-12, from the shop's reference screens): each card has a title and its
 * own save button.
 */
import React from 'react'
import { COMMAND_BUTTON_SIZE_CLASSES, TABLE_LINE_COLOUR_CLASSES } from '@/components/common/ActionButton'
import { Save, RotateCcw } from 'lucide-react'

/** Brown buttons of the page (accent from .settings-ref in globals.css). */
/**
 * Settings buttons = the shared command size and the system colours (owner 2026-11-13): save = emerald-700 like the
 * other menus' save buttons; the second button = their cancel button (grey line, white).
 */
export const REF_BUTTON = `${COMMAND_BUTTON_SIZE_CLASSES} px-3 text-white bg-emerald-700 hover:bg-emerald-800 shadow-md shadow-emerald-600/20 disabled:opacity-45 disabled:hover:bg-emerald-700 disabled:shadow-none flex items-center`
export const REF_BUTTON_QUIET = `${COMMAND_BUTTON_SIZE_CLASSES} px-3 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 flex items-center`

export function SettingsCard({
  title,
  icon: Icon,
  action,
  footer,
  className = '',
  bodyClassName = '',
  children,
}: {
  /** No title = no title row (owner 2026-11-13: the tab already names it) */
  title?: string
  icon?: React.ComponentType<{ className?: string }>
  action?: React.ReactNode
  footer?: React.ReactNode
  /** Extra layout classes, e.g. flex-1 to fill the work area */
  className?: string
  /** Extra classes for the content area, e.g. a flex column so a table fills the card */
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section className={`text-xs flex flex-col ${className}`.trim()}>
      {/* Same as the customers menu (owner 2026-11-13): title row with a line under it, no box around */}
      {title ? (
        <header className={`pb-1.5 border-b ${TABLE_LINE_COLOUR_CLASSES} flex items-center justify-between gap-2`}>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              {Icon && <Icon className="w-4 h-4 text-[var(--ref-accent)] dark:text-blue-400 shrink-0" />}
              <span>{title}</span>
            </h3>
          </div>
          {action}
        </header>
      ) : null}
      {/* the content takes the free height, so the save buttons sit at the bottom of a section that fills the work area */}
      <div className={`flex-1 ${bodyClassName}`.trim()}>
        {children}
      </div>
      {footer && <footer className={`pt-2 border-t ${TABLE_LINE_COLOUR_CLASSES} flex justify-end gap-2`}>{footer}</footer>}
    </section>
  )
}

/** Save / undo for a card that saves one settings section. */
export function CardSaveButtons({
  label,
  dirty,
  saving,
  onSave,
  onCancel,
}: {
  label: string
  dirty: boolean
  saving: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={onCancel}
        disabled={!dirty || saving}
        className={REF_BUTTON_QUIET}
      >
        <RotateCcw className="w-4 h-4" />
        <span>คืนค่าที่บันทึกไว้</span>
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className={REF_BUTTON}
      >
        <Save className="w-4 h-4" />
        <span>{saving ? 'กำลังบันทึก…' : label}</span>
      </button>
    </>
  )
}
