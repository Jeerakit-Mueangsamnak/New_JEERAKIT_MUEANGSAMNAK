'use client'

import React, { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { NotificationBell } from '@/components/common/NotificationBell'
import { QuickActionLauncher } from '@/components/common/QuickActionLauncher'
import { AppLockButton } from '@/features/auth/components/AppLockButton'
import { getPageName } from '@/lib/navigation-meta'
import { useMediaQuery, XL_MEDIA_QUERY } from '@/lib/hooks/useMediaQuery'
import { LiveClockBadge } from '@/components/common/LiveClockBadge'

function TopHeaderContent() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isXl = useMediaQuery(XL_MEDIA_QUERY)

  const isAuthRoute = pathname === '/login' || pathname.startsWith('/auth')
  const pageName = getPageName(pathname, searchParams)

  if (isAuthRoute) return null

  return (
    <header className="hidden xl:flex items-center justify-between px-6 py-3 bg-[#E3E3E3] dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 shadow-sm shrink-0 relative min-h-[56px]">
      {/* Left: Dynamic Menu / Page Title */}
      <div className="flex items-center min-w-0 z-10">
        <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight truncate">
          {pageName}
        </h1>
      </div>

      {/* Right: Actions (Date & Time + Lock Button + Notification Bell & Quick Action Launcher) */}
      <div className="flex items-center gap-3 shrink-0 z-10">
        <LiveClockBadge variant="header" />

        <AppLockButton variant="header" />
        {/* One bell / launcher in the app: here from xl up, in the Sidebar's mobile header below */}
        {isXl !== false && (
          <>
            <NotificationBell />
            <QuickActionLauncher />
          </>
        )}
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
