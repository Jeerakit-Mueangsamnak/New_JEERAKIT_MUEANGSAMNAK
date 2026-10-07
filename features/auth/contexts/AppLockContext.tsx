'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import {
  fetchPinStatus,
  setPinOnServer,
  verifyPinOnServer,
  getAppLockedState,
  setAppLockedState,
  type PinStatus,
  type PinVerifyResult,
} from '@/features/auth/services/pin-lock'

export interface AppLockContextType {
  /** The user has a PIN on the server. */
  pinEnabled: boolean
  /** PIN blocked after too many misses (needs reset / re-authentication). */
  pinBlocked: boolean
  isLocked: boolean
  loading: boolean
  status: PinStatus | null
  setupPin: (pin: string) => Promise<boolean>
  /** Unlock with the PIN; returns the server answer (ok / wait / blocked). */
  verifyPin: (pin: string) => Promise<PinVerifyResult>
  lockApp: () => void
  unlockApp: () => void
  refreshLockState: () => Promise<void>
}

const AppLockContext = createContext<AppLockContextType | null>(null)

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [status, setStatus] = useState<PinStatus | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [checkedUserId, setCheckedUserId] = useState<string | null | undefined>(undefined)
  const userId = user?.status === 'ACTIVE' ? user.id : null

  const refreshLockState = useCallback(async () => {
    if (authLoading) return
    if (!userId) {
      setStatus(null)
      setIsLocked(false)
      setCheckedUserId(null)
      return
    }
    try {
      const s = await fetchPinStatus()
      setStatus(s)
      setIsLocked(s.pinSet && getAppLockedState(userId))
    } catch (err) {
      console.error('[PIN] cannot read PIN status', err)
      setStatus(null)
    }
    setCheckedUserId(userId)
  }, [userId, authLoading])

  useEffect(() => {
    void refreshLockState()
  }, [refreshLockState])

  const pinEnabled = Boolean(status?.pinSet)

  const lockApp = useCallback(() => {
    if (!userId || !pinEnabled) return
    setIsLocked(true)
    setAppLockedState(userId, true)
  }, [userId, pinEnabled])

  const unlockApp = useCallback(() => {
    if (!userId) return
    setIsLocked(false)
    setAppLockedState(userId, false)
  }, [userId])

  // Auto-lock after the user's chosen idle time (0 = never). The session stays signed in.
  const lastActivity = useRef(Date.now())
  useEffect(() => {
    const seconds = status?.autoLockSeconds ?? 0
    if (!userId || !pinEnabled || isLocked || seconds <= 0) return
    lastActivity.current = Date.now()
    const touch = () => { lastActivity.current = Date.now() }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= seconds * 1000) lockApp()
    }, 5000)
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, touch))
      clearInterval(timer)
    }
  }, [userId, pinEnabled, isLocked, status?.autoLockSeconds, lockApp])

  const setupPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!userId) return false
    await setPinOnServer(pin)
    setAppLockedState(userId, false)
    setIsLocked(false)
    await refreshLockState()
    return true
  }, [userId, refreshLockState])

  const verifyPin = useCallback(async (pin: string): Promise<PinVerifyResult> => {
    const r = await verifyPinOnServer(pin, 'UNLOCK')
    if (r.ok) unlockApp()
    else setStatus((s) => (s ? { ...s, blocked: r.blocked, failedAttempts: r.failedAttempts, lockedUntil: r.lockedUntil } : s))
    return r
  }, [unlockApp])

  const loading = Boolean(authLoading) || (Boolean(userId) && checkedUserId !== userId)

  const value = useMemo<AppLockContextType>(() => ({
    pinEnabled,
    pinBlocked: Boolean(status?.blocked),
    isLocked,
    loading,
    status,
    setupPin,
    verifyPin,
    lockApp,
    unlockApp,
    refreshLockState,
  }), [pinEnabled, status, isLocked, loading, setupPin, verifyPin, lockApp, unlockApp, refreshLockState])

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>
}

export function useAppLock(): AppLockContextType {
  const context = useContext(AppLockContext)
  if (!context) throw new Error('useAppLock must be used within an AppLockProvider')
  return context
}
