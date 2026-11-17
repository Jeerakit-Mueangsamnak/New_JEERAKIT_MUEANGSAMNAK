'use client'

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const DURATION_MS = 700

function canAnimate(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    typeof window.requestAnimationFrame === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const defaultFormat = (n: number) => n.toLocaleString()

/**
 * A stat-card number that runs up to its value (owner 2026-11-16): from 0 when the card first shows,
 * then from the old value to the new one when the data changes. Without motion support (reduced
 * motion, tests) it shows the value at once. `format` prints the number exactly as the card did before.
 */
export function CountUp({ value, format = defaultFormat }: { value: number; format?: (n: number) => string }) {
  const target = Number.isFinite(value) ? value : 0
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)
  const started = useRef(false)

  useIsoLayoutEffect(() => {
    const show = (n: number) => {
      shownRef.current = n
      setShown(n)
    }
    if (!canAnimate()) {
      show(target)
      return
    }
    const from = started.current ? shownRef.current : 0
    started.current = true
    if (from === target) {
      show(target)
      return
    }
    const decimals = Number.isInteger(target) && Number.isInteger(from) ? 0 : 2
    const t0 = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION_MS)
      const eased = 1 - Math.pow(1 - p, 3)
      show(p >= 1 ? target : Number((from + (target - from) * eased).toFixed(decimals)))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    show(from)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])

  return <>{format(shown)}</>
}
