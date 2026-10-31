'use client'

import React, { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { NotificationBell } from '@/components/common/NotificationBell'
import { QuickActionLauncher } from '@/components/common/QuickActionLauncher'
import { AppLockButton } from '@/features/auth/components/AppLockButton'
import { getPageMeta } from '@/lib/navigation-meta'
import { LiveClockBadge } from '@/components/common/LiveClockBadge'
import { useSidebarDrawer } from '@/lib/hooks/useSidebarDrawer'
import {
  APP_CHROME_BG_CLASSES,
  APP_CHROME_BORDER_CLASSES,
  APP_HEADER_HEIGHT_CLASS,
  APP_HEADER_PADDING_X_CLASS,
  HEADER_CONTROL_CLASSES,
  HEADER_ICON_BUTTON_CLASSES,
  HEADER_ICON_BUTTON_IDLE_CLASSES,
} from '@/components/common/ActionButton'

/** The one app header for every screen width (the drawer toggle shows only below xl). */
function TopHeaderContent() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isOpen, toggle } = useSidebarDrawer()

  const isAuthRoute = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/auth'].some(
    (route) => pathname === route || pathname?.startsWith(route + '/')
  )
  const { name: pageName, icon: PageIcon, colorClass, dotClass } = getPageMeta(pathname || '', searchParams)

  if (isAuthRoute) return null

  return (
    <header className={`sticky top-0 z-30 ${APP_HEADER_HEIGHT_CLASS} ${APP_HEADER_PADDING_X_CLASS} ${APP_CHROME_BG_CLASSES} ${APP_CHROME_BORDER_CLASSES} border-b shadow-sm text-slate-900 dark:text-slate-100 shrink-0 relative flex items-center justify-between gap-2`}>
      {/* Left: drawer toggle (below xl) + current page name */}
      <div className="flex items-center gap-2 z-10 shrink-0 min-w-0">
        <button
          onClick={toggle}
          className={`xl:hidden ${HEADER_ICON_BUTTON_CLASSES} ${HEADER_ICON_BUTTON_IDLE_CLASSES}`}
          aria-label="เปิด/ปิด เมนู"
        >
          {isOpen ? <X className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> : <Menu className="w-5 h-5" />}
        </button>
        <div className={`${HEADER_CONTROL_CLASSES} gap-1.5 px-3 min-w-0`}>
          <PageIcon className={`w-4 h-4 shrink-0 ${colorClass}`} />
          <h1 className={`font-bold text-xs sm:text-sm truncate ${colorClass}`} title={pageName}>
            {pageName}
          </h1>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
        </div>
      </div>

      {/* Right: date & time, lock, notifications, quick actions */}
      <div className="flex items-center gap-2 z-10 shrink-0">
        <LiveClockBadge />
        <AppLockButton />
        <NotificationBell />
        <QuickActionLauncher />
      </div>
    </header>
  )
}

export function TopHeader() {
  return (
    <Suspense fallback={null}>
      <TopHeaderContent />
    </Suspense>
  )
}
