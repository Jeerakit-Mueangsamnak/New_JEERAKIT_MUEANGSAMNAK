'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Delete, LogOut, AlertCircle, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useAppLock } from '@/features/auth/contexts/AppLockContext'
import { AuthLayout } from '@/features/auth/components/AuthLayout'

import Link from 'next/link'
import { describePinRefusal, formatWait, setAppLockedState } from '@/features/auth/services/pin-lock'

interface PinLockScreenProps {
  onUnlockSuccess?: () => void
}

export function PinLockScreen({ onUnlockSuccess }: PinLockScreenProps) {
  const { user, signOut: logout } = useAuth()
  const { verifyPin, unlockApp, status, pinBlocked } = useAppLock()
  const userId = user?.id || ''

  const [pin, setPin] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isShaking, setIsShaking] = useState(false)
  const [lockedUntil, setLockedUntil] = useState<string | null>(status?.lockedUntil ?? null)
  const [blocked, setBlocked] = useState<boolean>(pinBlocked)
  const [now, setNow] = useState(Date.now())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const keypadRef = useRef<HTMLDivElement>(null)
  const pointerKeyRef = useRef<HTMLButtonElement | null>(null)

  // Mouse/touch input should never leave an outline on a keypad key. Keyboard
  // users retain the blue focus-visible ring when activating with Enter/Space.
  const markPointerKey = (event: React.PointerEvent<HTMLButtonElement> | React.TouchEvent<HTMLButtonElement>) => {
    pointerKeyRef.current = event.currentTarget
  }

  const preventMouseFocus = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault() // Prevents the browser from focusing the key on mouse down.
    pointerKeyRef.current = event.currentTarget
  }

  const activateKeypadButton = (event: React.MouseEvent<HTMLButtonElement>, action: () => void) => {
    action()
    if (event.detail > 0 || pointerKeyRef.current === event.currentTarget) {
      event.currentTarget.blur()
    }
    pointerKeyRef.current = null
  }

  const releaseKeypadFocus = useCallback(() => {
    keypadRef.current?.querySelector<HTMLButtonElement>('button[data-pin-key]:focus')?.blur()
  }, [])

  // Countdown while the server makes us wait (iOS-style waits, Master §4.3)
  useEffect(() => {
    if (!lockedUntil) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [lockedUntil])

  const lockoutSeconds = lockedUntil ? Math.max(0, Math.ceil((new Date(lockedUntil).getTime() - now) / 1000)) : 0
  const isLockedOut = blocked || lockoutSeconds > 0

  const handleKeyPress = useCallback(
    async (digit: string) => {
      if (isLockedOut || isSubmitting) return
      if (pin.length >= 6) return

      const nextPin = pin + digit
      setPin(nextPin)
      setErrorMsg(null)

      if (nextPin.length === 6) {
        setIsSubmitting(true)
        try {
          const result = await verifyPin(nextPin)
          setPin('')
          if (result.ok) {
            setLockedUntil(null)
            onUnlockSuccess?.()
          } else {
            setIsShaking(true)
            setTimeout(() => setIsShaking(false), 500)
            setBlocked(result.blocked)
            setLockedUntil(result.lockedUntil)
            setNow(Date.now())
            setErrorMsg(describePinRefusal(result))
          }
        } catch (err: unknown) {
          setPin('')
          setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการตรวจสอบ PIN')
        } finally {
          setIsSubmitting(false)
        }
      }
    },
    [pin, isLockedOut, isSubmitting, verifyPin, onUnlockSuccess]
  )

  const handleDigitPress = handleKeyPress

  const handleDelete = useCallback(() => {
    if (isLockedOut || isSubmitting) return
    setPin((prev) => prev.slice(0, -1))
    setErrorMsg(null)
  }, [isLockedOut, isSubmitting])

  const handleClear = useCallback(() => {
    if (isLockedOut || isSubmitting) return
    setPin('')
    setErrorMsg(null)
  }, [isLockedOut, isSubmitting])

  // Keyboard shortcut support (0-9, Backspace, Escape). Captured first and kept from the page
  // underneath, so no field types the digit and no modal reacts to Escape.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!/^[0-9]$/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Escape') return

      // Physical keypad shortcuts must not focus the last clicked on-screen key.
      pointerKeyRef.current = null
      releaseKeypadFocus()
      if (/^[0-9]$/.test(e.key)) {
        handleKeyPress(e.key)
      } else if (e.key === 'Backspace') {
        handleDelete()
      } else {
        handleClear()
      }
      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyPress, handleDelete, handleClear, releaseKeypadFocus])

  const handleLogout = async () => {
    if (userId) setAppLockedState(userId, false)
    unlockApp()
    await logout()
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-sm flex flex-col items-center pt-[clamp(8px,1.5dvh,20px)] pb-16 transition-all duration-200">
        {/* Show the signed-in username at the top-right, apart from the centered PIN form. */}
        <p className="fixed top-3 right-3 sm:top-5 sm:right-5 z-[60] max-w-[60vw] truncate text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
          @{user?.username || 'user'}
        </p>

        {/* Logo scales with available screen height; no blue frame around an uploaded image. */}
        <div className="text-center space-y-2 sm:space-y-3 shrink-0">
          <div className="h-[clamp(80px,12dvh,132px)] w-[clamp(80px,12dvh,132px)] mx-auto flex items-center justify-center overflow-hidden">
            {user?.avatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={user.avatarUrl} alt={user.fullName || 'User Avatar'} className="w-full h-full object-contain" />
            ) : (
              <div className="h-full w-full rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-900 dark:text-white text-2xl font-black">
                {user?.firstName?.[0] || 'ผ'}
              </div>
            )}
          </div>
          <h2 className="text-[26px] font-bold text-slate-900 dark:text-white tracking-tight">
            {user?.displayName || user?.fullName || 'ผู้ใช้งาน'}
          </h2>
        </div>

        {/* Exactly six PIN boxes, centred independently of any controls. */}
        <div className="w-full flex justify-center mt-[clamp(16px,2.5dvh,28px)] mb-[clamp(10px,1.8dvh,20px)]">
          <div className={`flex items-center justify-center gap-2 sm:gap-3 py-1 ${isShaking ? 'animate-shake' : ''}`}>
            {[0, 1, 2, 3, 4, 5].map((index) => {
              const isFilled = pin.length > index
              return (
                <div
                  key={index}
                  className={`w-9 sm:w-10 h-12 shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 ${
                    isFilled
                      ? 'bg-blue-500/20 border-2 border-blue-500 text-blue-600 dark:text-white font-mono font-black text-lg shadow-md shadow-blue-500/30'
                      : 'bg-slate-100 dark:bg-slate-800/80 border-2 border-slate-300 dark:border-slate-700 text-transparent'
                  }`}
                >
                  {isFilled ? '•' : ''}
                </div>
              )
            })}
          </div>
        </div>

        {/* Show status only when there is a real error or a lockout; no idle instruction text. */}
        {(isLockedOut || errorMsg) && (
          <div className="w-full flex justify-center text-center mb-2" role="status" aria-live="polite">
            {isLockedOut ? (
              <div className="flex items-center justify-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-900 px-3 py-1 rounded-xl">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{blocked ? 'PIN ถูกล็อก' : `รออีก ${formatWait(lockedUntil || '')} แล้วลองใหม่`}</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 text-xs text-rose-700 dark:text-rose-400 font-bold bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900 px-3 py-1 rounded-xl animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
        )}

        {/* Numeric Keypad (1-9, 0) */}
        <div ref={keypadRef} className="grid grid-cols-3 gap-x-6 gap-y-[clamp(10px,1.7dvh,16px)] w-full max-w-[300px] mt-[clamp(10px,1.7dvh,18px)]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              type="button"
              disabled={isLockedOut || isSubmitting}
              data-pin-key
              onPointerDown={markPointerKey}
              onTouchStart={markPointerKey}
              onMouseDown={preventMouseFocus}
              onClick={(event) => activateKeypadButton(event, () => handleDigitPress(num.toString()))}
              aria-label={`ตัวเลข ${num}`}
              className="aspect-square w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 active:bg-blue-600 active:text-white border border-slate-300 dark:border-slate-700/80 text-slate-900 dark:text-white font-black text-xl sm:text-2xl flex items-center justify-center mx-auto transition-all shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-blue-400 active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none"
            >
              {num}
            </button>
          ))}

          {/* Bottom row: Forgot PIN under 7; 0 under 8; Delete under 9. */}
          <div className="min-h-14 sm:min-h-16 flex flex-col items-center justify-center text-center gap-0.5">
            {user?.role === 'OWNER' ? (
              <Link href="/forgot-pin" className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline focus-visible:underline">
                ลืม PIN?
              </Link>
            ) : (
              <span className="text-[11px] leading-tight text-slate-600 dark:text-slate-400" title="ลืม PIN? ให้เจ้าของร้านล้าง PIN ให้ที่เมนูจัดการสิทธิ์">
                ลืม PIN?<span className="block text-[10px]">แจ้งเจ้าของร้าน</span>
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={isLockedOut || isSubmitting}
            data-pin-key
            onPointerDown={markPointerKey}
            onTouchStart={markPointerKey}
            onMouseDown={preventMouseFocus}
            onClick={(event) => activateKeypadButton(event, () => handleDigitPress('0'))}
            aria-label="ตัวเลข 0"
            className="aspect-square w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 active:bg-blue-600 active:text-white border border-slate-300 dark:border-slate-700/80 text-slate-900 dark:text-white font-black text-xl sm:text-2xl flex items-center justify-center mx-auto transition-all shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-blue-400 active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none"
          >
            0
          </button>

          <button
            type="button"
            disabled={isLockedOut || isSubmitting || pin.length === 0}
            data-pin-key
            onPointerDown={markPointerKey}
            onTouchStart={markPointerKey}
            onMouseDown={preventMouseFocus}
            onClick={(event) => activateKeypadButton(event, handleDelete)}
            aria-label="ลบตัวเลข"
            className="aspect-square w-14 h-14 sm:w-16 sm:h-16 rounded-full text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 active:bg-slate-200 dark:active:bg-slate-800 flex items-center justify-center mx-auto transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-blue-400 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer select-none"
          >
            <Delete className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

      </div>
      <button
        type="button"
        onClick={handleLogout}
        className={`${COMMAND_BUTTON_SIZE_CLASSES} fixed bottom-3 right-3 sm:bottom-5 sm:right-5 z-[60] bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/60 text-slate-700 dark:text-slate-200 hover:text-red-700 dark:hover:text-red-400 border border-slate-300 dark:border-slate-700 flex items-center transition-colors cursor-pointer shadow-sm`}
        title="ออกจากระบบ"
      >
        <LogOut className="w-4 h-4" />
        <span>ออกจากระบบ</span>
      </button>
    </AuthLayout>
  )
}
