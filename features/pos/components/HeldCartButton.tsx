'use client'

/**
 * Header cart icon (owner 2026-11-09), left of the lock icon.
 * - A bill cart is held on this device (CART_CHANGED_EVENT): the icon blinks red.
 * - No cart: the icon is shown but cannot be pressed.
 * - Double tap: back to the POS with the held cart. Single tap: an X appears on the icon; tapping the X
 *   clears the held cart. Nothing is saved to the database and no stock moves until the bill is saved.
 * Double tap is timed here (not dblclick), so it works the same with a mouse and on an iPad.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ShoppingCart, X } from 'lucide-react'
import { HEADER_ICON_BUTTON_CLASSES, HEADER_ICON_BUTTON_IDLE_CLASSES } from '@/components/common/ActionButton'
import { useToast } from '@/components/common/Toast'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { CART_CHANGED_EVENT, clearActiveCart, loadHeldCart } from '@/features/pos/services/cart-storage'

const DOUBLE_TAP_MS = 300

export function HeldCartButton() {
  const router = useRouter()
  const pathname = usePathname()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [held, setHeld] = useState(false)
  const [showClear, setShowClear] = useState(false)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => setHeld(Boolean(loadHeldCart(user?.id))), [user?.id])

  // Changes from this tab (event), other tabs (storage) and every menu change.
  useEffect(() => {
    refresh()
    window.addEventListener(CART_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(CART_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [refresh, pathname])

  useEffect(() => {
    if (!held) setShowClear(false)
  }, [held])

  // A tap anywhere else hides the X again.
  useEffect(() => {
    if (!showClear) return
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowClear(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [showClear])

  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current)
  }, [])

  const onTap = () => {
    if (!held) return
    if (tapTimer.current) {
      clearTimeout(tapTimer.current)
      tapTimer.current = null
      setShowClear(false)
      router.push('/pos')
      return
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null
      setShowClear(true)
    }, DOUBLE_TAP_MS)
  }

  const clearHeld = () => {
    clearActiveCart('BILL')
    setShowClear(false)
    showToast('ล้างตะกร้าแล้ว', 'รายการที่เลือกไว้ถูกล้างทิ้ง ยังไม่มีการบันทึกหรือตัดสต็อก', 'INFO')
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={onTap}
        disabled={!held}
        aria-label={held ? 'ตะกร้าสินค้าที่ค้างไว้' : 'ไม่มีตะกร้าสินค้าค้างไว้'}
        title={held ? 'ตะกร้าค้างไว้: แตะสองครั้งเพื่อเปิดหน้า POS · แตะครั้งเดียวเพื่อล้างตะกร้า' : 'ไม่มีตะกร้าสินค้าค้างไว้'}
        className={`${HEADER_ICON_BUTTON_CLASSES} ${HEADER_ICON_BUTTON_IDLE_CLASSES} disabled:opacity-40 disabled:cursor-not-allowed`}
        data-testid="held-cart-button"
      >
        <ShoppingCart className={`w-4 h-4 ${held ? 'text-red-600 dark:text-red-400 animate-pulse' : ''}`} />
        {held && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-600 animate-pulse" aria-hidden="true" />}
      </button>
      {showClear && (
        <button
          type="button"
          onClick={clearHeld}
          aria-label="ล้างตะกร้าสินค้า"
          title="ล้างตะกร้าสินค้า"
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 hover:bg-red-700 text-white grid place-items-center shadow cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
