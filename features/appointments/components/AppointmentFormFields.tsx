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

/* ---------------- ประเภทนัดหมาย: pick one or type a new name in the same box ---------------- */

export function AppointmentTypeCombobox({
  value,
  options,
  onSelect,
  onCreate,
}: {
  /** Selected type id */
  value: string
  options: AppointmentTypeOption[]
  onSelect: (type: AppointmentTypeOption) => void
  /** Saves a new type; rejects with a Thai message (empty / duplicate / not allowed). */
  onCreate: (name: string) => Promise<AppointmentTypeOption>
}) {
  const selected = options.find((o) => o.id === value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = React.useId()
  const { coords } = useFloatingPlacement(boxRef, open, { matchTriggerWidth: true, estimatedHeight: 240, offset: 4 })

  const close = React.useCallback(() => {
    setOpen(false)
    setQuery('')
    setError('')
  }, [])
  useClickOutside([boxRef, listRef], close, open)
  useEscape(open, close)

  const q = plainTypeName(query).toLocaleLowerCase()
  const shown = q ? options.filter((o) => plainTypeName(o.label).toLocaleLowerCase().includes(q)) : options
  const exact = q !== '' && options.some((o) => plainTypeName(o.label).toLocaleLowerCase() === q)

  const pick = (o: AppointmentTypeOption) => {
    onSelect(o)
    close()
  }
  const create = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      pick(await onCreate(query))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกประเภทนัดหมายไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-label="ประเภทนัดหมาย"
        aria-expanded={open}
        aria-controls={listId}
        value={open ? query : selected?.label ?? ''}
        placeholder={open ? selected?.label || 'พิมพ์ค้นหาหรือเพิ่มประเภทใหม่' : 'เลือกประเภทนัดหมาย'}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setError('')
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (exact) pick(shown.find((o) => plainTypeName(o.label).toLocaleLowerCase() === q)!)
          else if (q) void create()
        }}
        className={`${FIELD} pr-7`}
      />
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
      {open && (
        <ModalPortal>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            style={{
              position: 'fixed',
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight ?? 240,
              zIndex: 9999,
            }}
            className={`${POPOVER} overflow-y-auto space-y-0.5`}
          >
            {shown.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                onClick={() => pick(o)}
                className={`w-full text-left px-3 py-2 rounded-lg font-bold flex items-center justify-between gap-2 cursor-pointer ${
                  o.id === value
                    ? 'bg-slate-100 dark:bg-slate-700 text-emerald-700 dark:text-emerald-300'
                    : 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/80'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {o.id === value && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            ))}
            {q && !exact && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void create()}
                className="w-full text-left px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">เพิ่มประเภท &quot;{query.trim()}&quot;</span>
              </button>
            )}
            {shown.length === 0 && !q && <div className="px-3 py-2 text-center text-slate-400 text-[11px]">ยังไม่มีรายการ</div>}
            {error && <div className="px-3 py-1.5 text-[11px] font-bold text-red-600">{error}</div>}
          </div>
        </ModalPortal>
      )}
    </div>
  )
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
      on ? 'bg-emerald-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
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
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-emerald-600 cursor-pointer"
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
                <p className="px-1 py-0.5 text-[10px] font-bold text-slate-400 text-center">{col.title}</p>
                <div className="h-48 overflow-y-auto space-y-0.5 pr-0.5">
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
