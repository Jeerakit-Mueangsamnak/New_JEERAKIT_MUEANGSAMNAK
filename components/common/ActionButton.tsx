'use client'

import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'active' | 'primary' | 'neutral' | 'ghost' | 'dashed' | 'secondary' | 'outline' | 'utility' | 'danger' | 'info'
  icon?: React.ReactNode
  badge?: React.ReactNode
}

/** Standard control height (36px) — buttons, selects, date pickers, tab bars, header controls. */
export const CONTROL_HEIGHT_CLASS = 'h-9'
/** Square control of the standard height (icon-only buttons). */
export const CONTROL_SQUARE_CLASS = 'h-9 w-9'

/**
 * Size of every ordinary command button in the app (owner 2026-11-07, from the bills toolbar):
 * 32px high, 12px bold text, 14×14 icon, 8px side padding, 4px icon gap, 8px corners.
 * Raw <button>s that act as commands use it too, so the size lives in one place.
 */
export const COMMAND_BUTTON_SIZE_CLASSES =
  'h-8 px-2 py-0 gap-1 rounded-lg text-xs font-bold [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:shrink-0'

/** Standard Action/Toolbar Button base style (the command size + layout and states). */
export const ACTION_BUTTON_BASE_CLASSES =
  `${COMMAND_BUTTON_SIZE_CLASSES} whitespace-nowrap inline-flex items-center justify-center transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed`

/*
 * App header + sidebar ("app chrome") — Master §39.11. One place for height, colour, padding and
 * the header controls, so TopHeader, Sidebar, NotificationBell, QuickActionLauncher, LiveClockBadge
 * and AppLockButton always match.
 */
/** Height of the app header bar (the sidebar logo row is taller since 2026-11-10). */
export const APP_HEADER_HEIGHT_CLASS = 'h-14'
/** Same side padding as the page content (p-2), so header controls line up with the cards below. */
export const APP_HEADER_PADDING_X_CLASS = 'px-2'
/** Background of the header bar and the sidebar. */
export const APP_CHROME_BG_CLASSES = 'bg-[#d6e4ff] dark:bg-slate-900'
/** Bottom/side border colour of the header bar and the sidebar. */
export const APP_CHROME_BORDER_CLASSES = 'border-slate-300 dark:border-slate-800'

const HEADER_CONTROL_SHAPE = `${CONTROL_HEIGHT_CLASS} inline-flex items-center shrink-0 rounded-xl border shadow-xs`
const HEADER_CONTROL_SURFACE = 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700'
/** Non-button header pieces (page title, date/time). */
export const HEADER_CONTROL_CLASSES = `${HEADER_CONTROL_SHAPE} ${HEADER_CONTROL_SURFACE}`
/** Icon-only header buttons (menu, lock, notifications, quick actions); add OPEN or IDLE. */
export const HEADER_ICON_BUTTON_CLASSES = `${HEADER_CONTROL_SHAPE} ${CONTROL_SQUARE_CLASS} relative justify-center transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500`
export const HEADER_ICON_BUTTON_IDLE_CLASSES = `${HEADER_CONTROL_SURFACE} text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700`
export const HEADER_ICON_BUTTON_OPEN_CLASSES = 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 text-blue-600 dark:text-blue-400'

/*
 * Shared sizes for every menu except POS (owner 2026-11-07: the size most pages already use becomes
 * the one value every page reads from here).
 */
/** Colour of every table line and of the lines between a table and its bars (owner 2026-11-11: #acacad). */
export const TABLE_LINE_COLOUR_CLASSES = 'border-[#acacad] dark:border-[#acacad]'
/** Table toolbar above a list: padding, gap between controls, bottom line. Add the layout (flex …). */
export const TABLE_TOOLBAR_CLASSES = `p-2 gap-2 border-b ${TABLE_LINE_COLOUR_CLASSES} shrink-0`
/** Bar under a table/form (same spacing as the toolbar, line on top). Add the layout (flex …). */
export const TABLE_FOOTER_CLASSES = `p-2 gap-2 border-t ${TABLE_LINE_COLOUR_CLASSES} shrink-0`
/**
 * ย้อนกลับ / ถัดไป of a step-by-step screen (owner 2026-11-11, the "NEXT >" picture): black, a thin white
 * line inside the edge, white bold text, the standard command height. Use StepNavButton.
 */
export const STEP_NAV_BUTTON_CLASSES = `${COMMAND_BUTTON_SIZE_CLASSES} px-3 inline-flex items-center justify-center whitespace-nowrap bg-slate-950 text-white border border-slate-950 shadow-[inset_0_0_0_2px_#020617,inset_0_0_0_3px_#ffffff] hover:opacity-90 transition-opacity cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed`
/** Icon-only action button inside a table row (the bills table style). Add the icon colour + hover colour. */
export const ROW_ICON_BUTTON_CLASSES =
  'inline-flex h-[22px] w-[22px] sm:h-6 sm:w-6 lg:h-7 lg:w-7 items-center justify-center rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
/** Search box in a toolbar: wrap it in `relative`, put SEARCH_ICON_CLASSES on the <Search> icon. */
export const SEARCH_INPUT_CLASSES =
  'w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors'
export const SEARCH_ICON_CLASSES =
  'w-4 h-4 text-slate-600 dark:text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none'

/** Tab bar look (height, inner padding, colour, border). TAB_CONTAINER_CLASSES adds the row layout; full-width bars add `grid grid-cols-N`. */
// items-center + content-center keep the 28px buttons vertically centred whether the bar is flex or grid
// (a grid bar used to sit them at the top: 4px gap above, 2px below — owner 2026-11-10).
export const TAB_BAR_SURFACE_CLASSES =
  'h-9 p-1 gap-1 items-center content-center rounded-xl bg-slate-200/80 dark:bg-slate-700/80 border border-slate-300/60 dark:border-slate-600/60'

export const TAB_CONTAINER_CLASSES =
  `${TAB_BAR_SURFACE_CLASSES} inline-flex items-center shrink-0 overflow-x-auto overflow-y-hidden no-scrollbar`

export const TAB_BUTTON_BASE_CLASSES =
  'h-7 px-3.5 py-0 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap select-none shrink-0'

export const TAB_BUTTON_ACTIVE_CLASSES =
  'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200/80 dark:border-slate-600/80'

export const TAB_BUTTON_INACTIVE_CLASSES =
  'bg-transparent border border-transparent text-slate-600 dark:text-slate-300 font-medium hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/40 dark:hover:bg-slate-800/40'

export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  (
    {
      variant = 'neutral',
      icon,
      badge,
      className = '',
      children,
      type = 'button',
      ...props
    },
    ref
  ) => {
    let variantClasses = ''
    switch (variant) {
      case 'active':
        variantClasses = 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
        break
      case 'primary':
        variantClasses = 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs'
        break
      case 'danger':
        variantClasses = 'bg-red-600 hover:bg-red-700 text-white shadow-xs'
        break
      case 'info':
        variantClasses = 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
        break
      case 'neutral':
        variantClasses =
          'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-xs'
        break
      case 'ghost':
      case 'utility':
        variantClasses =
          'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80'
        break
      case 'dashed':
      case 'secondary':
        variantClasses =
          'border border-dashed border-slate-300 dark:border-slate-600 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400'
        break
      case 'outline':
        variantClasses =
          'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
        break
    }

    return (
      <button
        ref={ref}
        type={type}
        className={`${ACTION_BUTTON_BASE_CLASSES} ${variantClasses} ${className}`}
        {...props}
      >
        {icon}
        {children && <span>{children}</span>}
        {badge}
      </button>
    )
  }
)

ActionButton.displayName = 'ActionButton'

export interface StepNavButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** back = "< ย้อนกลับ", next = "ถัดไป >" (the text can be changed with children). */
  direction: 'back' | 'next'
}

/** The one ย้อนกลับ / ถัดไป button of step-by-step screens (owner 2026-11-11). */
export function StepNavButton({ direction, children, className = '', type = 'button', ...props }: StepNavButtonProps) {
  const label = children ?? (direction === 'back' ? 'ย้อนกลับ' : 'ถัดไป')
  return (
    <button type={type} className={`${STEP_NAV_BUTTON_CLASSES} ${className}`.trim()} {...props}>
      {direction === 'back' && <ChevronLeft aria-hidden="true" />}
      <span className="truncate">{label}</span>
      {direction === 'next' && <ChevronRight aria-hidden="true" />}
    </button>
  )
}