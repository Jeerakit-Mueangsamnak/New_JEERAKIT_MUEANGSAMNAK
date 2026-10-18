'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import {
  TAB_CONTAINER_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'
import { isBuddhistHolyDay } from '@/features/appointments/utils/thai-lunar'

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  backgroundColor: string
  borderColor: string
}

interface CalendarViewProps {
  events: CalendarEvent[]
  onEventClick?: (id: string) => void
  /** Day view body: the work list of that day (the page owns the columns and actions). */
  renderDay?: (date: Date) => React.ReactNode
  /** Header slot on the right of the toolbar (the page's add button). */
  actions?: React.ReactNode
  /** Reports the day the user is looking at (new appointments start on it). */
  onDateChange?: (date: Date) => void
}

type CalendarMode = 'DAY' | 'MONTH'

const MODES: { value: CalendarMode; label: string }[] = [
  { value: 'DAY', label: 'วัน' },
  { value: 'MONTH', label: 'เดือน' },
]

// Week starts on Sunday (owner's calendar design).
const WEEKDAY_LABELS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์']

const pad = (n: number) => String(n).padStart(2, '0')
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfWeek = (d: Date) => addDays(d, -d.getDay())
const eventTime = (iso: string) => iso.slice(11, 16)

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString('th-TH', opts)

const TODAY_DOT = 'bg-red-500 text-white font-bold'
const SELECTED_DOT = 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold'

export function CalendarView({ events, onEventClick, renderDay, actions, onDateChange }: CalendarViewProps) {
  const [mounted, setMounted] = useState(false)
  const [mode, setMode] = useState<CalendarMode>('MONTH')
  const [anchor, setAnchor] = useState<Date>(() => new Date())

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    onDateChange?.(anchor)
  }, [anchor, onDateChange])

  const todayKey = toKey(new Date())

  // Events grouped by date (YYYY-MM-DD), sorted by start time
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    events.forEach((ev) => {
      const key = ev.start.slice(0, 10)
      const list = map.get(key) ?? []
      list.push(ev)
      map.set(key, list)
    })
    map.forEach((list) => list.sort((a, b) => a.start.localeCompare(b.start)))
    return map
  }, [events])

  const shiftMonth = (delta: number) => {
    const target = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
    const now = new Date()
    const sameMonth = target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth()
    setAnchor(sameMonth ? now : target)
  }

  const goPrev = () => (mode === 'DAY' ? setAnchor(addDays(anchor, -1)) : shiftMonth(-1))
  const goNext = () => (mode === 'DAY' ? setAnchor(addDays(anchor, 1)) : shiftMonth(1))
  const goToday = () => setAnchor(new Date())
  const openDay = (day: Date) => {
    setAnchor(day)
    setMode('DAY')
  }

  if (!mounted) {
    return (
      <div className="h-full min-h-0 flex items-center justify-center text-slate-400 font-bold animate-pulse">
        กำลังโหลดปฏิทินนัดหมาย...
      </div>
    )
  }

  const navButtonClasses =
    'h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer'

  return (
    <div className="w-full h-full min-h-0 min-w-0 flex flex-col gap-2 text-xs">
      {/* Toolbar: month title | วัน / เดือน | prev / today / next | page actions */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <h2 className="min-w-0 truncate text-lg font-black text-slate-900 dark:text-slate-100">
          {fmt(anchor, { month: 'long', year: 'numeric' })}
        </h2>
        <div className={TAB_CONTAINER_CLASSES}>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`${TAB_BUTTON_BASE_CLASSES} ${mode === m.value ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <button type="button" onClick={goPrev} className={navButtonClasses} title="ก่อนหน้า">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="h-7 px-3 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            วันนี้
          </button>
          <button type="button" onClick={goNext} className={navButtonClasses} title="ถัดไป">
            <ChevronRight className="w-4 h-4" />
          </button>
          {actions}
        </div>
      </div>

      {mode === 'MONTH' ? (
        <MonthView anchor={anchor} todayKey={todayKey} eventsByDate={eventsByDate} onOpenDay={openDay} onEventClick={onEventClick} />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          <WeekStrip anchor={anchor} todayKey={todayKey} eventsByDate={eventsByDate} onSelect={setAnchor} />
          <div className="flex-1 min-h-0 flex flex-col">{renderDay?.(anchor)}</div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Day: week strip (selected day in the work list below) ---------------- */

function WeekStrip({
  anchor,
  todayKey,
  eventsByDate,
  onSelect,
}: {
  anchor: Date
  todayKey: string
  eventsByDate: Map<string, CalendarEvent[]>
  onSelect: (d: Date) => void
}) {
  const selectedKey = toKey(anchor)
  const start = startOfWeek(anchor)
  return (
    <div className="grid grid-cols-7 shrink-0 border-b border-slate-200 dark:border-slate-700">
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => {
        const key = toKey(day)
        const isToday = key === todayKey
        const isSelected = key === selectedKey
        const weekend = day.getDay() === 0 || day.getDay() === 6
        const count = eventsByDate.get(key)?.length ?? 0
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(day)}
            className={`py-1.5 flex items-center justify-center gap-1.5 text-[13px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 ${
              weekend ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100 font-semibold'
            }`}
          >
            <span>{WEEKDAY_LABELS[day.getDay()]}</span>
            <span
              className={`min-w-6 h-6 px-1 rounded-full inline-flex items-center justify-center ${
                isToday ? TODAY_DOT : isSelected ? SELECTED_DOT : ''
              }`}
            >
              {day.getDate()}
            </span>
            {count > 0 && <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">({count})</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- Month (full grid; a day opens the day view) ---------------- */

function MonthView({
  anchor,
  todayKey,
  eventsByDate,
  onOpenDay,
  onEventClick,
}: {
  anchor: Date
  todayKey: string
  eventsByDate: Map<string, CalendarEvent[]>
  onOpenDay: (d: Date) => void
  onEventClick?: (id: string) => void
}) {
  const month = anchor.getMonth()
  const gridStart = startOfWeek(new Date(anchor.getFullYear(), month, 1))
  const lastOfMonth = new Date(anchor.getFullYear(), month + 1, 0)
  const weeks = Math.ceil(((lastOfMonth.getTime() - gridStart.getTime()) / 86400000 + 1) / 7)
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i))

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="grid grid-cols-7 shrink-0 border-b border-slate-200 dark:border-slate-700">
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={label}
            className={`py-1 text-right pr-2 text-[11px] font-bold ${
              i === 0 || i === 6 ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {days.map((day) => {
          const key = toKey(day)
          const inMonth = day.getMonth() === month
          const isToday = key === todayKey
          const weekend = day.getDay() === 0 || day.getDay() === 6
          const dayEvents = eventsByDate.get(key) ?? []
          const isHolyDay = isBuddhistHolyDay(day)
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onOpenDay(day)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpenDay(day)
              }}
              title={isHolyDay ? 'วันพระ' : undefined}
              className={`min-h-0 overflow-hidden flex flex-col gap-0.5 p-1 border-r border-b border-slate-100 dark:border-slate-700/60 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 ${
                weekend ? 'bg-slate-50 dark:bg-slate-900/40' : ''
              } ${isHolyDay ? '!bg-orange-50 dark:!bg-orange-950/30' : ''}`}
            >
              <span
                className={`self-end min-w-6 h-6 px-1 rounded-full inline-flex items-center justify-center text-[13px] ${
                  isToday
                    ? TODAY_DOT
                    : !inMonth
                      ? 'text-slate-300 dark:text-slate-600'
                      : weekend
                        ? 'text-slate-400 dark:text-slate-500'
                        : 'text-slate-800 dark:text-slate-100 font-semibold'
                }`}
              >
                {day.getDate()}
              </span>
              {dayEvents.slice(0, 2).map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEventClick?.(ev.id)
                  }}
                  className="w-full truncate text-left px-1 rounded text-[10px] font-semibold text-white cursor-pointer"
                  style={{ backgroundColor: ev.backgroundColor }}
                  title={`${eventTime(ev.start)} ${ev.title}`}
                >
                  {eventTime(ev.start)} {ev.title}
                </button>
              ))}
              {dayEvents.length > 2 && (
                <span className="px-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">+{dayEvents.length - 2} งาน</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
