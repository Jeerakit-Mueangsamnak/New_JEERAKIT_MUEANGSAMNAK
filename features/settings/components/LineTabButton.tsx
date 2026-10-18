'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'
import { ModalPortal } from '@/components/common/ModalPortal'
import { useClickOutside } from '@/lib/hooks/useClickOutside'
import { useFloatingPlacement } from '@/lib/hooks/useFloatingPlacement'

/** The LINE tab of Settings: a tab with a dropdown of its own sub-sections. */
export function LineTabButton<V extends string>({
  active,
  dirty,
  icon,
  label,
  views,
  view,
  onSelect,
}: {
  active: boolean
  dirty: boolean
  icon: ReactNode
  label: string
  views: ReadonlyArray<{ id: V; label: string }>
  view: V
  onSelect: (view: V) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { coords } = useFloatingPlacement(btnRef, open, { estimatedHeight: 170, estimatedWidth: 190, offset: 4 })
  const close = useCallback(() => setOpen(false), [])
  useClickOutside([btnRef, menuRef], close, open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])

  const current = views.find((v) => v.id === view)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${TAB_BUTTON_BASE_CLASSES} ${active ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
      >
        {icon}
        <span>{active && current ? `${label} · ${current.label}` : label}</span>
        {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-label="ยังไม่บันทึก" />}
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>
      {open && (
        <ModalPortal>
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            style={{ position: 'fixed', top: coords.top, bottom: coords.bottom, left: coords.left, zIndex: 9999 }}
            className="min-w-[190px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1 text-xs"
          >
            {views.map((v) => {
              const on = active && v.id === view
              return (
                <button
                  key={v.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelect(v.id)
                    close()
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg font-bold flex items-center justify-between gap-2 cursor-pointer ${
                    on
                      ? 'bg-slate-100 dark:bg-slate-700 text-emerald-700 dark:text-emerald-300'
                      : 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/80'
                  }`}
                >
                  <span>{v.label}</span>
                  {on && <Check className="w-3.5 h-3.5" />}
                </button>
              )
            })}
          </div>
        </ModalPortal>
      )}
    </>
  )
}
