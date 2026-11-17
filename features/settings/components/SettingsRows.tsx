'use client'
/**
 * Settings list look (owner 2026-11-17, from the reference "Connection logging" screen): a title above one bordered
 * card; inside, one row per setting — name (and its line under it, where the page already had one) on the left, the
 * controls and the switch on the right — rows split by lines, the save buttons in the last row of the same card.
 * Used by ตั้งค่าระบบ › การแจ้งเตือนของร้าน, ตั้งค่าส่วนตัว › การตั้งค่า, LINE › ตั้งค่า › แจ้งพนักงาน / เตือนลูกค้า /
 * เชื่อมต่อ LINE. Text fields in a row (owner 2026-11-18, "First name | [Jeerakit]" reference) use SETTINGS_ROW_INPUT.
 */
import React from 'react'

/** The switch of the settings pages (one look everywhere). */
export function SwitchKnob({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`w-10 h-6 rounded-full p-0.5 flex shrink-0 transition ${checked ? 'bg-[var(--ref-accent,#2563eb)] justify-end' : 'bg-slate-300 dark:bg-slate-600 justify-start'}`}
    >
      <span className="w-5 h-5 rounded-full bg-white shadow" />
    </span>
  )
}

/** A switch on its own (the row's name is its label for screen readers). */
export function SettingsSwitch({
  checked,
  onChange,
  label,
  disabled,
  onFocus,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  onFocus?: () => void
}) {
  return (
    <label className={`shrink-0 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <SwitchKnob checked={checked} />
    </label>
  )
}

/** Two columns only when the space beside the card can hold two rows side by side. */
const TWO_COLUMN_MIN_WIDTH = 880

const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/** The element that scrolls the work area (or null = the window). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}

/**
 * Title above the card + the card with its rows; `footer` = the save buttons, inside the card at the bottom.
 * Layout (owner 2026-11-18): few rows → one column in the middle of the work area; rows that would not fit the
 * work area's height → two columns (only where the work area is wide enough).
 */
export function SettingsRowsCard({
  title,
  icon: Icon,
  footer,
  className = '',
  children,
}: {
  title?: string
  icon?: React.ComponentType<{ className?: string }>
  footer?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const sectionRef = React.useRef<HTMLElement>(null)
  const rowsRef = React.useRef<HTMLDivElement>(null)
  const [twoColumns, setTwoColumns] = React.useState(false)

  useIsoLayoutEffect(() => {
    const section = sectionRef.current
    const rows = rowsRef.current
    if (!section || !rows) return
    const measure = () => {
      const width = section.parentElement?.clientWidth ?? 0
      // Height of the card as one column: the rows stacked, plus the title / footer around them.
      const rowsHeight = Array.from(rows.children).reduce((sum, r) => sum + (r as HTMLElement).offsetHeight, 0)
      const needed = section.offsetHeight - rows.offsetHeight + rowsHeight
      const scroller = scrollParent(section)
      const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight
      const available = bottom - section.getBoundingClientRect().top - 12
      setTwoColumns(width >= TWO_COLUMN_MIN_WIDTH && needed > available)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(rows)
    if (section.parentElement) observer?.observe(section.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <section ref={sectionRef} className={`text-xs flex flex-col gap-2 min-w-0 w-full mx-auto ${twoColumns ? '' : 'max-w-3xl'} ${className}`.trim()}>
      {title && (
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-[var(--ref-accent)] dark:text-blue-400 shrink-0" />}
          <span>{title}</span>
        </h3>
      )}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
        <div
          ref={rowsRef}
          className={
            twoColumns
              ? // each row draws its own lines; the last line sits under the card edge / footer line
                'grid grid-cols-2 -mb-px [&>*]:border-b [&>*:nth-child(odd)]:border-r [&>*]:border-slate-200 dark:[&>*]:border-slate-700'
              : 'divide-y divide-slate-200 dark:divide-slate-700'
          }
        >
          {children}
        </div>
        {footer && <div className="px-4 py-2.5 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700">{footer}</div>}
      </div>
    </section>
  )
}

/** One setting: name (+ its line under it) on the left, controls on the right. */
export function SettingsRow({
  label,
  description,
  icon: Icon,
  active = false,
  onMouseEnter,
  children,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  /** Highlight (e.g. the row shown in a preview) */
  active?: boolean
  onMouseEnter?: () => void
  children?: React.ReactNode
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      className={`px-4 py-2.5 flex items-center justify-between gap-3 ${active ? 'bg-slate-50 dark:bg-slate-700/40' : ''}`}
    >
      <div className="min-w-0 flex items-center gap-2.5">
        {Icon && <Icon className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />}
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{label}</div>
          {description && <div className="text-[11px] text-slate-600 dark:text-slate-400">{description}</div>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  )
}

/** Small number box used inside a row (e.g. "แจ้งล่วงหน้า [1] วัน"). */
export const SETTINGS_ROW_NUMBER =
  'w-14 h-7 px-1.5 py-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-center font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50'
export const SETTINGS_ROW_UNIT = 'text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap'
/** Text field on the right of a row (name on the left): fixed width, so every row's field lines up. */
export const SETTINGS_ROW_INPUT =
  'w-64 max-w-[45vw] h-[30px] px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-xs font-bold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'
