'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import {
  fetchPinStatus,
  setPinOnServer,
  verifyPinOnServer,
  getAppLockedState,
  setAppLockedState,
  getLastActivity,
  setLastActivity,
  isIdleExpired,
  effectiveAutoLockSeconds,
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
  const { settings } = useSystemSettings()
  const [serverStatus, setStatus] = useState<PinStatus | null>(null)
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
      // Fail closed: a device that was locked stays locked when the PIN status cannot be read
      // (unlocking still needs verify_pin on the server). Keep the last known status.
      console.error('[PIN] cannot read PIN status', err)
      setIsLocked(getAppLockedState(userId))
    }
    setCheckedUserId(userId)
  }, [userId, authLoading])

  useEffect(() => {
    void refreshLockState()
  }, [refreshLockState])

  // The OWNER may change the allowed auto-lock times from another device: read again on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshLockState()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshLockState])

  // The member's own choice applies only while the OWNER still allows it (shop default otherwise).
  const shopDefaultSeconds = settings.shopSecurity.autoLockDefaultSeconds
  const status = useMemo<PinStatus | null>(() => {
    if (!serverStatus) return null
    const seconds = effectiveAutoLockSeconds(serverStatus.autoLockSeconds, serverStatus.autoLockOptions, shopDefaultSeconds)
    return seconds === serverStatus.autoLockSeconds ? serverStatus : { ...serverStatus, autoLockSeconds: seconds }
  }, [serverStatus, shopDefaultSeconds])

  // A locked device implies a PIN was set (the lock flag is only written when it was).
  const pinEnabled = Boolean(status?.pinSet) || isLocked

  const lockApp = useCallback(() => {
    if (!userId || !pinEnabled) return
    setIsLocked(true)
    setAppLockedState(userId, true)
  }, [userId, pinEnabled])

  const unlockApp = useCallback(() => {
    if (!userId) return
    setIsLocked(false)
    setAppLockedState(userId, false)
    setLastActivity(userId, Date.now())
  }, [userId])

  // Auto-lock after the user's own idle time (PROFILE value; 0 = never). The session stays
  // signed in. The last activity is kept on this device, and the elapsed time is checked again
  // when the app comes back from the background, after device sleep and on a reopened session,
  // because timers do not run (or run late) while the page is hidden or the device sleeps.
  const lastActivity = useRef(Date.now())
  useEffect(() => {
    const seconds = status?.autoLockSeconds ?? 0
    if (!userId || !pinEnabled || isLocked || seconds <= 0) return
    const stored = getLastActivity(userId)
    if (isIdleExpired(stored, Date.now(), seconds)) {
      lockApp()
      return
    }
    lastActivity.current = stored ?? Date.now()
    let lastSaved = 0
    const touch = () => {
      const now = Date.now()
      lastActivity.current = now
      if (now - lastSaved >= 5000) {
        lastSaved = now
        setLastActivity(userId, now)
      }
    }
    touch()
    const check = () => {
      if (isIdleExpired(lastActivity.current, Date.now(), seconds)) lockApp()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setLastActivity(userId, lastActivity.current)
      else check()
    }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    const timer = setInterval(check, 5000)
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, touch))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', check)
      window.removeEventListener('pageshow', check)
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
