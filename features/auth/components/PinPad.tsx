'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Delete } from 'lucide-react'

const REVEAL_MS = 450

interface PinPadProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  length?: number
}

/**
 * Six PIN boxes centred above a phone-style keypad (1–9, ล้าง 0 ลบ). The newest digit shows
 * for ~450 ms and then turns into ●. No "show PIN" toggle. Number keys / Backspace / Escape
 * on a hardware keyboard work too.
 */
export function PinPad({ value, onChange, disabled = false, length = 6 }: PinPadProps) {
  const [revealIndex, setRevealIndex] = useState<number | null>(null)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopReveal = () => {
    if (revealTimer.current) clearTimeout(revealTimer.current)
    revealTimer.current = null
    setRevealIndex(null)
  }
  useEffect(() => () => { if (revealTimer.current) clearTimeout(revealTimer.current) }, [])
  // The parent may reset the value (wrong PIN, next step): never leave a digit showing.
  useEffect(() => { if (revealIndex !== null && revealIndex >= value.length) setRevealIndex(null) }, [value, revealIndex])

  const press = (digit: string) => {
    if (disabled || value.length >= length) return
    // Briefly reveal only the digit just added, then show it as ●.
    if (revealTimer.current) clearTimeout(revealTimer.current)
    setRevealIndex(value.length)
    revealTimer.current = setTimeout(() => setRevealIndex(null), REVEAL_MS)
    onChange(value + digit)
  }
  const back = () => { if (!disabled) { stopReveal(); onChange(value.slice(0, -1)) } }
  const clear = () => { if (!disabled) { stopReveal(); onChange('') } }

  // Hardware keyboard: digits, Backspace, Escape (latest handlers via ref, one listener).
  const handlers = useRef({ press, back, clear })
  handlers.current = { press, back, clear }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) handlers.current.press(e.key)
      else if (e.key === 'Backspace') handlers.current.back()
      else if (e.key === 'Escape') {
        // Clears the PIN only; a modal behind the PIN dialog stays open
        e.preventDefault()
        handlers.current.clear()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const keyClass =
    'w-16 h-16 rounded-full bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 active:bg-blue-600 active:text-white border border-slate-300 dark:border-slate-700/80 text-slate-900 dark:text-white font-black text-2xl flex items-center justify-center mx-auto transition-all active:scale-95 disabled:opacity-40 select-none'
  const sideKeyClass =
    'w-16 h-16 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-bold flex items-center justify-center mx-auto transition-colors disabled:opacity-40 select-none'

  return (
    <div className="flex flex-col items-center w-full">
      <div className="flex items-center justify-center gap-3" aria-label="PIN" role="group">
        {Array.from({ length }).map((_, i) => {
          const filled = i < value.length
          return (
            <div
              key={i}
              className={`w-11 h-12 rounded-xl border-2 flex items-center justify-center font-mono font-black text-xl transition-all duration-150 ${
                filled
                  ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-white'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60'
              }`}
            >
              {filled ? (i === revealIndex ? value[i] : '●') : ''}
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-3 gap-x-6 gap-y-4 mt-7">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => press(d)} className={keyClass} aria-label={`ตัวเลข ${d}`}>
            {d}
          </button>
        ))}
        <button type="button" disabled={disabled || value.length === 0} onClick={clear} className={sideKeyClass}>
          ล้าง
        </button>
        <button type="button" disabled={disabled} onClick={() => press('0')} className={keyClass} aria-label="ตัวเลข 0">
          0
        </button>
        <button type="button" disabled={disabled || value.length === 0} onClick={back} className={sideKeyClass} aria-label="ลบตัวเลข">
          <Delete className="w-6 h-6" />
        </button>
      </div>
    </div>
  )
}
