'use client'

import React, { RefObject, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Delete } from 'lucide-react'
import { useFloatingPlacement } from '@/lib/hooks/useFloatingPlacement'

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'backspace'

const PANEL_WIDTH = 264
const PANEL_HEIGHT = 236
const ARROW = 10

/** True on touch-first screens (iPad / phone), where the on-screen number pad replaces the device keyboard. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(pointer: coarse)')
    const update = () => setCoarse(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])
  return coarse
}

interface NumericKeypadPopoverProps {
  anchorRef: RefObject<HTMLInputElement | null>
  allowDecimal: boolean
  onKey: (key: KeypadKey) => void
  /** Called on a tap outside both the input and the pad. */
  onDismiss: () => void
}

/**
 * Small number pad (1–9, ., 0, ⌫) that floats above the focused input with a pointer arrow,
 * flipping below when there is no room. Keys never take focus, so the input keeps its caret.
 */
export function NumericKeypadPopover({ anchorRef, allowDecimal, onKey, onDismiss }: NumericKeypadPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { coords, placement } = useFloatingPlacement(anchorRef, true, {
    align: 'center',
    prefer: 'top',
    offset: ARROW + 2,
    estimatedWidth: PANEL_WIDTH,
    estimatedHeight: PANEL_HEIGHT,
  })

  // iOS Safari does not blur an input when empty space is tapped: close the pad ourselves.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    const listener = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      dismissRef.current()
    }
    document.addEventListener('pointerdown', listener, true)
    return () => document.removeEventListener('pointerdown', listener, true)
  }, [anchorRef])

  if (typeof document === 'undefined') return null

  const rect = anchorRef.current?.getBoundingClientRect()
  const arrowLeft = rect
    ? Math.min(Math.max(rect.left + rect.width / 2 - coords.left, 24), PANEL_WIDTH - 24)
    : PANEL_WIDTH / 2

  const keys: Array<KeypadKey | null> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? '.' : null, '0', 'backspace']

  const keyClass = (key: KeypadKey) =>
    `h-12 rounded-xl text-2xl font-normal text-slate-900 dark:text-slate-100 select-none flex items-center justify-center transition-colors ${
      key === '.' || key === 'backspace'
        ? 'active:bg-white/70 dark:active:bg-slate-700/70'
        : 'bg-white dark:bg-slate-700 shadow-sm active:bg-slate-200 dark:active:bg-slate-600'
    }`

  return createPortal(
    <div
      ref={panelRef}
      role="group"
      aria-label="แป้นตัวเลข"
      data-numeric-keypad=""
      className="fixed z-[1000] rounded-3xl border border-slate-200/80 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/95 backdrop-blur-xl shadow-2xl p-3"
      style={{ left: coords.left, top: coords.top, bottom: coords.bottom, width: PANEL_WIDTH }}
      // Keep focus (and the caret) in the input while tapping keys.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="grid grid-cols-3 gap-2">
        {keys.map((key, i) =>
          key === null ? (
            <span key={`blank-${i}`} aria-hidden="true" />
          ) : (
            <button
              key={key}
              type="button"
              tabIndex={-1}
              aria-label={key === 'backspace' ? 'ลบ' : key}
              className={keyClass(key)}
              onClick={() => onKey(key)}
            >
              {key === 'backspace' ? <Delete className="w-7 h-7" strokeWidth={1.75} /> : key}
            </button>
          )
        )}
      </div>
      <span
        aria-hidden="true"
        className={`absolute w-4 h-4 rotate-45 bg-slate-100 dark:bg-slate-800 border-slate-200/80 dark:border-slate-700 ${
          placement === 'top' ? '-bottom-2 border-r border-b' : '-top-2 border-l border-t'
        }`}
        style={{ left: arrowLeft - 8 }}
      />
    </div>,
    document.body
  )
}
