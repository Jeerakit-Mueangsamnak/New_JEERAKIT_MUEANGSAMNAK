'use client'

import React, { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useAppLock } from '@/features/auth/contexts/AppLockContext'
import { PinLockScreen } from '@/features/auth/components/PinLockScreen'
import { isPublicRoute as isPublicPath } from '@/features/auth/services/public-routes'
import { firstAllowedHref, menuForPath } from '@/features/auth/services/permissions'

export function AuthShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { session, loading: authLoading, user, hasMenu, refreshUser } = useAuth()
  const { pinEnabled, isLocked, loading: appLockLoading, unlockApp } = useAppLock()

  const isPublicRoute = isPublicPath(pathname)
  const pageRef = useRef<HTMLDivElement>(null)
  const locked = Boolean(session && user && pinEnabled && isLocked && pathname !== '/forgot-pin')

  // While locked the page underneath cannot be focused or clicked (inert), but keeps its state.
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    if (locked) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [locked])

  useEffect(() => {
    if (!authLoading) {
      if (!session && !isPublicRoute) {
        // Not authenticated on protected route -> redirect to login
        router.replace('/login')
      } else if (session && user && (pathname === '/login' || pathname === '/register')) {
        // Authenticated user on login or register -> redirect to POS
        router.replace('/pos')
      }
    }
  }, [authLoading, session, user, isPublicRoute, pathname, router])

  // Menus and role are set centrally by the OWNER (จัดการสิทธิ์), possibly from another device:
  // read them again on every page change so an open device follows the latest grants.
  const firstPath = useRef(true)
  const signedIn = Boolean(session && user)
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false
      return
    }
    if (signedIn && !isPublicRoute) void refreshUser()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a page change triggers the re-read
  }, [pathname])

  // Menu access (Master §4.2): a page outside the user's menus sends them to their first menu.
  const pageMenu = menuForPath(pathname)
  const menuDenied = Boolean(!isPublicRoute && user?.status === 'ACTIVE' && pageMenu && !hasMenu(pageMenu))
  useEffect(() => {
    if (!menuDenied) return
    const target = firstAllowedHref(user)
    if (target && target !== pathname) router.replace(target)
  }, [menuDenied, user, pathname, router])

  // Public routes: render content directly
  if (isPublicRoute) {
    return (
      <div className="flex flex-col xl:flex-row h-full w-full overflow-hidden min-h-0 min-w-0 flex-1">
        {children}
      </div>
    )
  }

  // Protected route: show loading indicator while checking session or app lock
  if (authLoading || appLockLoading) {
    return (
      <div className="fixed inset-0 bg-slate-100 dark:bg-background flex flex-col items-center justify-center gap-3 z-50">
        <div className="w-10 h-10 border-3 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
        <span className="text-xs text-slate-600 dark:text-slate-400 font-medium tracking-wide">
          กำลังตรวจสอบสิทธิ์เข้าใช้งาน...
        </span>
      </div>
    )
  }

  // Protected route: if unauthenticated, show redirecting state (do not render protected content)
  if (!session) {
    return (
      <div className="fixed inset-0 bg-slate-100 dark:bg-background flex flex-col items-center justify-center gap-3 z-50">
        <div className="w-10 h-10 border-3 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
        <span className="text-xs text-slate-600 dark:text-slate-400 font-medium tracking-wide">
          กำลังพาคุณไปหน้าเข้าสู่ระบบ...
        </span>
      </div>
    )
  }

  if (menuDenied) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span className="font-bold">บัญชีนี้ยังไม่ได้รับสิทธิ์เมนูนี้</span>
        {!firstAllowedHref(user) && <span>ให้เจ้าของร้านเปิดเมนูให้ที่หน้าจัดการสิทธิ์</span>}
      </div>
    )
  }

  // A PIN is optional at sign-in: users set it later in Settings → Security, or when a risky
  // action first asks for it (PinConfirmProvider). Without a PIN the app never locks.

  // App lock is an overlay: the page underneath stays mounted, so unlocking returns to the
  // same screen and unsaved work (Master §4.3). The session is never signed out by the lock.
  return (
    <>
      <div
        className="flex flex-col xl:flex-row h-full w-full overflow-hidden min-h-0 min-w-0 flex-1"
        ref={pageRef}
        aria-hidden={locked || undefined}
      >
        {children}
      </div>
      {locked && (
        <div className="fixed inset-0 z-[9999] overflow-auto">
          <PinLockScreen onUnlockSuccess={unlockApp} />
        </div>
      )}
    </>
  )
}
