'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Clock, Plus } from 'lucide-react'
import { useClickOutside } from '@/lib/hooks/useClickOutside'
import { useFloatingPlacement } from '@/lib/hooks/useFloatingPlacement'
import { ModalPortal } from '@/components/common/ModalPortal'
import { plainTypeName, type AppointmentTypeOption } from '@/features/appointments/services/appointment-types'

const FIELD =
  'w-full h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none'
const POPOVER =
  'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1 text-xs font-medium'

/** Esc closes only the open list, not the panel or dialog around it. */
function useEscape(open: boolean, close: () => void) {
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
}
/* ---------------- เวลา: type HH:MM or pick hour / minute (24 hours) ---------------- */

const pad = (n: number) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i))
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i))

/** "9" → 09:00, "930" / "9.30" / "9:30" → 09:30; anything else (or past 23:59) → null. */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim().replace(/[.\s]/g, ':')
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (h > 23 || min > 59) return null
  return `${pad(h)}:${pad(min)}`
}

export function TimeField({ value, onChange, label }: { value: string; onChange: (time: string) => void; label: string }) {
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const { coords } = useFloatingPlacement(boxRef, open, { estimatedHeight: 220, estimatedWidth: 150, offset: 4 })

  useEffect(() => setDraft(value), [value])
  const close = React.useCallback(() => setOpen(false), [])
  useClickOutside([boxRef, popRef], close, open)
  useEscape(open, close)

  // Keep the chosen hour / minute in view when the list opens
  useEffect(() => {
    if (!open) return
    popRef.current?.querySelectorAll<HTMLElement>('[data-selected="true"]').forEach((el) => el.scrollIntoView?.({ block: 'center' }))
  }, [open])

  const commit = () => {
    const t = normalizeTime(draft)
    if (t) onChange(t)
    else setDraft(value)
  }
  const [h, m] = (normalizeTime(draft) ?? value).split(':')
  const cell = (on: boolean) =>
    `w-full py-1 rounded-md font-mono font-bold cursor-pointer ${
      on ? 'bg-emerald-700 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
    }`

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        placeholder="HH:MM"
        maxLength={5}
        value={draft}
        onClick={() => setOpen(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            setOpen(false)
          }
        }}
        className={`${FIELD} font-mono pr-8`}
      />
      <button
        type="button"
        aria-label={`เลือก${label}`}
        onClick={() => setOpen((v) => !v)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-600 dark:text-slate-400 hover:text-emerald-600 cursor-pointer"
      >
        <Clock className="w-4 h-4" />
      </button>
      {open && (
        <ModalPortal>
          <div
            ref={popRef}
            role="dialog"
            aria-label={label}
            style={{ position: 'fixed', top: coords.top, bottom: coords.bottom, left: coords.left, zIndex: 9999 }}
            className={`${POPOVER} w-[150px] grid grid-cols-2 gap-1`}
          >
            {[
              { title: 'ชั่วโมง', list: HOURS, on: h, set: (v: string) => onChange(`${v}:${m}`) },
              { title: 'นาที', list: MINUTES, on: m, set: (v: string) => (onChange(`${h}:${v}`), setOpen(false)) },
            ].map((col) => (
              <div key={col.title} role="group" aria-label={col.title} className="min-w-0">
                <p className="px-1 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-400 text-center">{col.title}</p>
                {/* Scrolls by wheel / touch / keyboard; the scroll bar itself is hidden */}
                <div className="h-48 overflow-y-auto no-scrollbar space-y-0.5">
                  {col.list.map((v) => (
                    <button key={v} type="button" data-selected={v === col.on} onClick={() => col.set(v)} className={cell(v === col.on)}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ModalPortal>
      )}
    </div>
  )
}
