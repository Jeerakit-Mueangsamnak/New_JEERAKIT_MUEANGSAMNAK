'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import thLocale from '@fullcalendar/core/locales/th'
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
}

type CalendarMode = 'DAY' | 'WEEK' | 'MONTH' | 'LIST'

const MODES: { value: CalendarMode; label: string }[] = [
  { value: 'DAY', label: 'วัน' },
  { value: 'WEEK', label: 'สัปดาห์' },
  { value: 'MONTH', label: 'เดือน' },
  { value: 'LIST', label: 'รายการ' },
]

// Week starts on Monday (same as the Thai FullCalendar locale used before).
const WEEKDAY_LABELS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.']

const pad = (n: number) => String(n).padStart(2, '0')
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))
const eventTime = (iso: string) => iso.slice(11, 16)

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString('th-TH', opts)

// Sunday = red header/date; วันพระ = orange background (Thai lunar calendar).
const SUNDAY_TEXT = '!text-red-600 dark:!text-red-400 [&_a]:!text-red-600 dark:[&_a]:!text-red-400'
const HOLY_BG = '!bg-orange-100 dark:!bg-orange-950/40'
// Today in day/week view = blue date badge in the header (same as month view), no column tint,
// so it can't be mistaken for the วันพระ orange.
const TODAY_BADGE =
  '[&_.fc-col-header-cell-cushion]:!bg-blue-600 [&_.fc-col-header-cell-cushion]:!text-white [&_.fc-col-header-cell-cushion]:rounded-full [&_.fc-col-header-cell-cushion]:!px-2.5'
const timeGridDayClasses = (date: Date, isToday: boolean, isHeader: boolean) => {
  const cls: string[] = []
  if (isHeader && isToday) cls.push(TODAY_BADGE)
  else if (date.getDay() === 0) cls.push(SUNDAY_TEXT)
  if (isBuddhistHolyDay(date)) cls.push(HOLY_BG)
  return cls
}

export function CalendarView({ events, onEventClick }: CalendarViewProps) {
  const [mounted, setMounted] = useState(false)
  const [mode, setMode] = useState<CalendarMode>('MONTH')
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const calendarRef = useRef<FullCalendar | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const todayKey = toKey(new Date())
  const anchorKey = toKey(anchor)

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

  // Keep the time grid (week/day) in sync with the shared toolbar
  useEffect(() => {
    if (mode !== 'WEEK' && mode !== 'DAY') return
    const timer = setTimeout(() => {
      const api = calendarRef.current?.getApi()
      api?.changeView(mode === 'WEEK' ? 'timeGridWeek' : 'timeGridDay', anchorKey)
      api?.scrollToTime('08:00:00')
    }, 0)
    return () => clearTimeout(timer)
  }, [mode, anchorKey])

  const shiftMonth = (delta: number) => {
    const target = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
    const now = new Date()
    const sameMonth = target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth()
    setAnchor(sameMonth ? now : target)
  }

  const goPrev = () => {
    if (mode === 'DAY') setAnchor(addDays(anchor, -1))
    else if (mode === 'WEEK') setAnchor(addDays(anchor, -7))
    else shiftMonth(-1)
  }
  const goNext = () => {
    if (mode === 'DAY') setAnchor(addDays(anchor, 1))
    else if (mode === 'WEEK') setAnchor(addDays(anchor, 7))
    else shiftMonth(1)
  }
  const goToday = () => setAnchor(new Date())

  const title = (() => {
    if (mode === 'DAY') return fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    if (mode === 'WEEK') {
      const from = startOfWeek(anchor)
      const to = addDays(from, 6)
      return `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    return fmt(anchor, { month: 'long', year: 'numeric' })
  })()

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
      {/* Toolbar: view switch | title | prev / today / next */}
      <div className="flex items-center justify-between gap-2 shrink-0 min-w-0">
        <div className={TAB_CONTAINER_CLASSES}>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`${TAB_BUTTON_BASE_CLASSES} ${
                mode === m.value ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <h2 className="flex-1 min-w-0 truncate text-center text-sm font-bold text-slate-900 dark:text-slate-100">
          {title}
        </h2>

        <div className="flex items-center gap-1 shrink-0">
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
        </div>
      </div>

      {mode === 'MONTH' && (
        <MonthView
          anchor={anchor}
          todayKey={todayKey}
          eventsByDate={eventsByDate}
          onSelect={setAnchor}
          onEventClick={onEventClick}
        />
      )}

      {mode === 'LIST' && (
        <AgendaView anchor={anchor} todayKey={todayKey} eventsByDate={eventsByDate} onEventClick={onEventClick} />
      )}

      {(mode === 'WEEK' || mode === 'DAY') && (
        <div className="flex-1 min-h-0 min-w-0 [&_.fc]:[--fc-today-bg-color:transparent]">
          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin, interactionPlugin]}
            initialView={mode === 'WEEK' ? 'timeGridWeek' : 'timeGridDay'}
            initialDate={anchorKey}
            locale={thLocale}
            headerToolbar={false}
            allDaySlot={false}
            nowIndicator
            scrollTime="08:00:00"
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            dayHeaderFormat={mode === 'WEEK' ? { weekday: 'short', day: 'numeric' } : { weekday: 'long', day: 'numeric' }}
            navLinks={mode === 'WEEK'}
            navLinkDayClick={(date) => {
              setAnchor(date)
              setMode('DAY')
            }}
            dayHeaderClassNames={(arg) => timeGridDayClasses(arg.date, arg.isToday, true)}
            dayCellClassNames={(arg) => timeGridDayClasses(arg.date, arg.isToday, false)}
            events={events}
            eventClick={(info) => {
              if (onEventClick) {
                onEventClick(info.event.id)
              }
            }}
            height="100%"
          />
        </div>
      )}
    </div>
  )
}

/* ---------------- Month (iOS-style grid + selected-day list) ---------------- */

function MonthView({
  anchor,
  todayKey,
  eventsByDate,
  onSelect,
  onEventClick,
}: {
  anchor: Date
  todayKey: string
  eventsByDate: Map<string, CalendarEvent[]>
  onSelect: (d: Date) => void
  onEventClick?: (id: string) => void
}) {
  const selectedKey = toKey(anchor)
  const month = anchor.getMonth()
  const gridStart = startOfWeek(new Date(anchor.getFullYear(), month, 1))
  const lastOfMonth = new Date(anchor.getFullYear(), month + 1, 0)
  const weeks = Math.ceil(((lastOfMonth.getTime() - gridStart.getTime()) / 86400000 + 1) / 7)
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i))
  const selectedEvents = eventsByDate.get(selectedKey) ?? []

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={label}
              className={`py-1 text-center text-[11px] font-bold ${
                i === 6
                  ? 'text-red-600 dark:text-red-400'
                  : i === 5
                    ? 'text-slate-400 dark:text-slate-500'
                    : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = toKey(day)
            const inMonth = day.getMonth() === month
            const isToday = key === todayKey
            const isSelected = key === selectedKey
            const dayEvents = eventsByDate.get(key) ?? []
            const isSunday = day.getDay() === 0
            const isHolyDay = isBuddhistHolyDay(day)

            let numberClasses = inMonth
              ? isSunday
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-800 dark:text-slate-100'
              : isSunday
                ? 'text-red-300 dark:text-red-900'
                : 'text-slate-300 dark:text-slate-600'
            if (isToday) numberClasses = 'text-blue-600 dark:text-blue-400 font-black'
            if (isSelected) {
              numberClasses = isToday
                ? 'bg-blue-600 text-white font-black'
                : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold'
            }

            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(day)}
                title={[isHolyDay ? 'วันพระ' : '', dayEvents.length ? `${dayEvents.length} นัดหมาย` : ''].filter(Boolean).join(' · ') || undefined}
                className={`h-11 flex flex-col items-center justify-start gap-0.5 pt-1 border-t border-slate-100 dark:border-slate-700/60 first:border-t-0 [&:nth-child(-n+7)]:border-t-0 transition-colors cursor-pointer ${
                  isHolyDay
                    ? `bg-orange-100 dark:bg-orange-950/40 hover:bg-orange-200/70 dark:hover:bg-orange-900/40${inMonth ? '' : ' opacity-60'}`
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full inline-flex items-center justify-center text-[13px] font-semibold ${numberClasses}`}
                >
                  {day.getDate()}
                </span>
                <span className="h-1.5 flex items-center gap-0.5">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <span
                      key={ev.id}
                      className={`w-1.5 h-1.5 rounded-full ${inMonth ? '' : 'opacity-40'}`}
                      style={{ backgroundColor: ev.backgroundColor }}
                    />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Appointments of the selected day */}
      <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between gap-2 shrink-0">
          <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
            {fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">{selectedEvents.length} นัดหมาย</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {selectedEvents.length === 0 ? (
            <div className="h-full min-h-16 flex items-center justify-center text-slate-400 font-bold">
              ไม่มีนัดหมายในวันนี้
            </div>
          ) : (
            selectedEvents.map((ev) => <EventRow key={ev.id} event={ev} onEventClick={onEventClick} />)
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- List (agenda of the visible month) ---------------- */

function AgendaView({
  anchor,
  todayKey,
  eventsByDate,
  onEventClick,
}: {
  anchor: Date
  todayKey: string
  eventsByDate: Map<string, CalendarEvent[]>
  onEventClick?: (id: string) => void
}) {
  const monthPrefix = toKey(anchor).slice(0, 7)
  const dateKeys = Array.from(eventsByDate.keys())
    .filter((key) => key.startsWith(monthPrefix))
    .sort()

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
      {dateKeys.length === 0 ? (
        <div className="h-full flex items-center justify-center text-slate-400 font-bold">ไม่มีนัดหมายในเดือนนี้</div>
      ) : (
        dateKeys.map((key) => (
          <section key={key}>
            <div
              className={`sticky top-0 z-10 px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-bold ${
                key === todayKey ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {fmt(fromKey(key), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {key === todayKey && <span className="ml-1.5 font-medium">(วันนี้)</span>}
            </div>
            {(eventsByDate.get(key) ?? []).map((ev) => (
              <EventRow key={ev.id} event={ev} onEventClick={onEventClick} />
            ))}
          </section>
        ))
      )}
    </div>
  )
}

function EventRow({ event, onEventClick }: { event: CalendarEvent; onEventClick?: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onEventClick?.(event.id)}
      className="w-full flex items-center gap-3 px-3 py-2 text-left border-b border-slate-100 dark:border-slate-700/60 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors cursor-pointer"
    >
      <span className="w-24 shrink-0 whitespace-nowrap tabular-nums text-slate-500 dark:text-slate-400">
        {eventTime(event.start)} – {eventTime(event.end)}
      </span>
      <span className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: event.backgroundColor }} />
      <span className="flex-1 min-w-0 truncate font-semibold text-slate-800 dark:text-slate-100">{event.title}</span>
    </button>
  )
}
