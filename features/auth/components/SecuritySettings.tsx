'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { useAppLock } from '@/features/auth/contexts/AppLockContext'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useToast } from '@/components/common/Toast'
import { PinSetupDialog } from '@/features/auth/components/PinSetupDialog'
import { SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import { REF_BUTTON_QUIET } from '@/features/settings/components/SettingsCards'

/**
 * โปรไฟล์ของฉัน → PIN. Setting a PIN is optional and never forced after sign-up / sign-in.
 * Each user has ONE PIN (stored only as a hash), used only for the screen lock (Master §4.3,
 * owner 2026-10-26) — no other action asks for it.
 * Compact column (owner 2026-11-14): a small heading and short buttons; the button text tells whether a PIN is set
 * (ตั้ง PIN / เปลี่ยน PIN), so no status badge and no auto-lock line (that is a shop setting in ตั้งค่าระบบ).
 */
export function SecuritySettings() {
  const { status } = useAppLock()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [dialog, setDialog] = useState<'set' | 'change' | null>(null)

  const pinSet = Boolean(status?.pinSet)

  return (
    <div className="space-y-2">
      <h4 className={SETTINGS_SECTION_TITLE}>
        <Lock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        <span>PIN ล็อกหน้าจอ</span>
      </h4>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDialog(pinSet ? 'change' : 'set')} className={REF_BUTTON_QUIET}>
          {pinSet ? 'เปลี่ยน PIN' : 'ตั้ง PIN'}
        </button>
        {pinSet && user?.role === 'OWNER' && (
          <Link href="/forgot-pin" className={REF_BUTTON_QUIET}>
            ลืม PIN
          </Link>
        )}
      </div>

      <PinSetupDialog
        open={dialog !== null}
        mode={dialog ?? 'set'}
        onClose={() => setDialog(null)}
        onDone={() => showToast(dialog === 'change' ? 'เปลี่ยน PIN แล้ว' : 'ตั้ง PIN แล้ว', 'ใช้ปลดล็อกหน้าจอได้ทันที', 'SUCCESS')}
      />
    </div>
  )
}
