'use client'

import React from 'react'
import { Lock } from 'lucide-react'
import { useAppLock } from '@/features/auth/contexts/AppLockContext'
import { HEADER_ICON_BUTTON_CLASSES, HEADER_ICON_BUTTON_IDLE_CLASSES } from '@/components/common/ActionButton'

interface AppLockButtonProps {
  className?: string
}

/** Icon-only lock button of the app header. */
export function AppLockButton({ className = '' }: AppLockButtonProps) {
  const { pinEnabled, lockApp } = useAppLock()

  if (!pinEnabled) {
    return null
  }

  return (
    <button
      type="button"
      onClick={lockApp}
      className={`${HEADER_ICON_BUTTON_CLASSES} ${HEADER_ICON_BUTTON_IDLE_CLASSES} ${className}`}
      title="ล็อกระบบ (App Lock)"
      aria-label="ล็อกระบบ"
    >
      <Lock className="w-4 h-4" />
    </button>
  )
}
