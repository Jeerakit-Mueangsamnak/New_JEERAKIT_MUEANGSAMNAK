'use client'

import React, { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

export function RouteContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isPosRoute = pathname?.startsWith('/pos')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (isPosRoute) {
        document.body.classList.add('pos-route')
        document.body.classList.remove('non-pos-route')
      } else {
        document.body.classList.add('non-pos-route')
        document.body.classList.remove('pos-route')
      }
    }
  }, [isPosRoute])

  // Every menu change plays the page-enter fade again (owner 2026-11-16) without remounting the page.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.classList.remove('page-enter')
    void el.offsetWidth
    el.classList.add('page-enter')
  }, [pathname])

  return (
    <div
      ref={ref}
      className={`flex-1 min-h-0 min-w-0 h-full ${
        isPosRoute
          ? 'pos-ui overflow-hidden'
          : 'non-pos-ui overflow-y-auto'
      }`}
    >
      {children}
    </div>
  )
}
