'use client'

import React, { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { LogOut, X, ChevronRight, ChevronDown, UserCog } from 'lucide-react'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { menuForPath } from '@/features/auth/services/permissions'
import { getPageMeta } from '@/lib/navigation-meta'
import { useSidebarDrawer } from '@/lib/hooks/useSidebarDrawer'
import { APP_CHROME_BG_CLASSES, APP_CHROME_BORDER_CLASSES, APP_HEADER_HEIGHT_CLASS } from '@/components/common/ActionButton'

// Menu order. Names and icons come from getPageMeta so the menu and the header title never drift.
const MENU_HREFS = [
  '/dashboard',
  '/reports',
  '/appointments',
  '/pos',
  '/bills',
  '/documents',
  '/customers',
  '/products',
  '/quotations',
  '/finance/statement',
  '/line',
  '/settings',
  '/owner-permissions',
]

// Menus that expand into ?view= sub pages; the first view is the default one.
const MENU_GROUPS: Record<string, string[]> = {
  '/dashboard': ['assets', 'stock', 'business'],
  '/reports': ['finance', 'sales-rental', 'operations', 'stock', 'business'],
}

const viewParams = (view: string) => ({ get: (k: string) => (k === 'view' ? view : null) })
const isUnder = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/')

const MENU_ROW_CLASSES =
  'flex min-h-10 items-center justify-between gap-2 px-3 py-2 rounded-lg font-bold text-[11px] leading-4 transition-all duration-150'
const MENU_ROW_ACTIVE_CLASSES = 'bg-emerald-700 text-white shadow-lg shadow-emerald-600/30'
const MENU_ROW_IDLE_CLASSES =
  'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-300/60 dark:hover:bg-slate-800'

function SidebarContent() {
  const pathname = usePathname() || ''
  const searchParams = useSearchParams()
  const { isOpen: isMobileOpen, setOpen: setIsMobileOpen } = useSidebarDrawer()
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Object.keys(MENU_GROUPS).map((href) => [href, isUnder(pathname, href)]))
  )
  const { user, signOut, hasMenu } = useAuth()

  // Keep a group expanded while the user is inside it
  useEffect(() => {
    const active = Object.keys(MENU_GROUPS).find((href) => isUnder(pathname, href))
    if (active) setExpanded((prev) => (prev[active] ? prev : { ...prev, [active]: true }))
  }, [pathname])

  // Auto-collapse sidebar when route/pathname changes
  useEffect(() => {
    setIsMobileOpen(false)
  }, [pathname, setIsMobileOpen])

  const isAuthRoute = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'].some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  )
  if (isAuthRoute) return null

  const handleMenuClick = () => {
    setIsMobileOpen(false)
  }

  const toggleGroup = (href: string) => setExpanded((prev) => ({ ...prev, [href]: !prev[href] }))

  return (
    <>
      {/* Backdrop Overlay for Mobile/Tablet */}
      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm xl:hidden animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Drawer Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 ${APP_CHROME_BG_CLASSES} text-slate-900 dark:text-slate-100 flex flex-col h-dvh max-h-dvh xl:h-full shrink-0 border-r ${APP_CHROME_BORDER_CLASSES} select-none xl:shadow-none transition-transform duration-300 ease-in-out xl:static xl:w-64 xl:translate-x-0 ${
          isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        {/* Drawer Header: same height as the app header so the bottom borders line up */}
        <div className={`${APP_HEADER_HEIGHT_CLASS} px-3.5 sm:px-4 flex items-center justify-between border-b ${APP_CHROME_BORDER_CLASSES} shrink-0`}>
          <span className="text-xs font-extrabold tracking-wider uppercase text-slate-700 dark:text-slate-300">
            เมนูหลัก
          </span>

          <button
            onClick={() => setIsMobileOpen(false)}
            className="xl:hidden p-1.5 rounded-xl text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-300/60 dark:hover:bg-slate-800 transition-colors"
            aria-label="ปิดเมนู"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation List */}
        <nav
          className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {MENU_HREFS.filter((href) => { const code = menuForPath(href); return !code || hasMenu(code) }).map((href) => {
            const { name, icon: Icon } = getPageMeta(href, null)
            const views = MENU_GROUPS[href]
            const isActive = isUnder(pathname, href)

            if (views) {
              const isExpanded = expanded[href]
              const currentView = searchParams.get('view') || views[0]
              const Chevron = isExpanded ? ChevronDown : ChevronRight

              return (
                <div key={href} className="space-y-1">
                  <div
                    onClick={() => toggleGroup(href)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') toggleGroup(href)
                    }}
                    className={`${MENU_ROW_CLASSES} cursor-pointer select-none ${isActive ? MENU_ROW_ACTIVE_CLASSES : MENU_ROW_IDLE_CLASSES}`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`} />
                      <span className="min-w-0 whitespace-nowrap">{name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Chevron className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white/80' : 'text-slate-600 dark:text-slate-400'}`} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="pl-6 pr-1 py-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                      {views.map((view) => {
                        const isSubActive = isActive && currentView === view

                        return (
                          <Link
                            key={view}
                            href={`${href}?view=${view}`}
                            onClick={handleMenuClick}
                            className={`flex min-h-8 items-center justify-between gap-2 px-3 py-1.5 rounded-md font-semibold text-[10.5px] leading-4 transition-all duration-150 ${
                              isSubActive
                                ? 'bg-emerald-500/20 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-bold border-l-2 border-emerald-400'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-300/50 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className="truncate">{getPageMeta(href, viewParams(view)).name}</span>
                            {isSubActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <Link
                key={href}
                href={href}
                onClick={handleMenuClick}
                className={`${MENU_ROW_CLASSES} ${isActive ? MENU_ROW_ACTIVE_CLASSES : MENU_ROW_IDLE_CLASSES}`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`} />
                  <span className="min-w-0 whitespace-nowrap">{name}</span>
                </div>
                {isActive && <ChevronRight className="w-3 h-3 shrink-0 text-white/80" />}
              </Link>
            )
          })}
        </nav>

        {/* User Footer & Logout */}
        <div className="p-4 border-t border-slate-300 dark:border-slate-800 bg-slate-200/60 dark:bg-slate-900 shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-slate-300 dark:bg-slate-800 border border-slate-400 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold flex items-center justify-center text-xs shrink-0 overflow-hidden">
                {user?.avatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={user.avatarUrl} alt={user.displayName || user.fullName || user.username} className="w-full h-full object-cover" />
                ) : (
                  (user?.displayName || user?.fullName || user?.username || 'US').slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="flex-1 truncate">
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                  {user?.displayName || user?.fullName || user?.username || 'ผู้ใช้งาน'}
                </p>
                <p className="text-[10px] text-slate-600 dark:text-slate-400 truncate flex items-center gap-1">
                  <span className="text-amber-800 dark:text-amber-400 font-bold">
                    {user?.role === 'OWNER' ? '👑 เจ้าของร้าน' : '💻 พนักงาน'}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Link
                href="/account"
                onClick={() => setIsMobileOpen(false)}
                className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
                title="ตั้งค่าส่วนตัว"
                aria-label="ตั้งค่าส่วนตัว"
              >
                <UserCog className="w-4 h-4" />
              </Link>
              <button
                onClick={async () => {
                  setIsMobileOpen(false)
                  await signOut()
                }}
                className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                title="ออกจากระบบ"
                aria-label="ออกจากระบบ"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

export function Sidebar() {
  return (
    <Suspense fallback={null}>
      <SidebarContent />
    </Suspense>
  )
}
