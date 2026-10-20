'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Lock, ShieldAlert, CheckCircle2, CircleDashed, KeyRound } from 'lucide-react'
import { useAppLock } from '@/features/auth/contexts/AppLockContext'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useToast } from '@/components/common/Toast'
import { PinSetupDialog } from '@/features/auth/components/PinSetupDialog'
import { setAutoLockSeconds } from '@/features/auth/services/pin-lock'
import type { MenuCode } from '@/features/auth/services/permissions'
import { CustomSelect } from '@/components/common/CustomSelect'

/** Menus whose screens contain actions that ask for a PIN (refund, void, stock adjust, …). */
const RISKY_MENUS: MenuCode[] = ['pos', 'bills', 'products', 'finance', 'quotations']

const lockLabel = (s: number) => (s === 0 ? 'ไม่ล็อกอัตโนมัติ' : s < 60 ? `${s} วินาที` : `${s / 60} นาที`)

/**
 * Settings → Security. Setting a PIN is optional and never forced after sign-up / sign-in.
 * Each user has ONE PIN (stored only as a hash); the two cards show where it is used.
 */
export function SecuritySettings() {
  const { status, refreshLockState } = useAppLock()
  const { user, hasMenu } = useAuth()
  const { showToast } = useToast()
  const [dialog, setDialog] = useState<'set' | 'change' | null>(null)
  const [busy, setBusy] = useState(false)

  const pinSet = Boolean(status?.pinSet)
  const canUseRiskyActions = user?.role === 'OWNER' || RISKY_MENUS.some((m) => hasMenu(m))

  const changeAutoLock = async (value: string) => {
    setBusy(true)
    try {
      await setAutoLockSeconds(Number(value))
      await refreshLockState()
      showToast('บันทึกเวลาล็อกหน้าจอแล้ว', lockLabel(Number(value)), 'SUCCESS')
    } catch (err) {
      showToast('บันทึกไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      setBusy(false)
    }
  }

  const statusBadge = (
    pinSet ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 px-3 py-1 text-xs font-bold">
        <CheckCircle2 className="w-3.5 h-3.5" /> ตั้งค่าแล้ว
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-1 text-xs font-bold">
        <CircleDashed className="w-3.5 h-3.5" /> ยังไม่ได้ตั้ง
      </span>
    )
  )

  const actions = (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => setDialog(pinSet ? 'change' : 'set')}
        className="rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm font-bold"
      >
        {pinSet ? 'เปลี่ยน PIN' : 'ตั้ง PIN'}
      </button>
      {pinSet && (
        user?.role === 'OWNER' ? (
          <Link href="/forgot-pin" className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">
            ลืม PIN
          </Link>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">ลืม PIN: ให้เจ้าของร้านล้าง PIN ให้ แล้วตั้งใหม่ที่นี่</span>
        )
      )}
    </div>
  )

  const card = (icon: React.ReactNode, title: string, desc: string, extra?: React.ReactNode) => (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
          {icon}
        </div>
        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">{title}</h3>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{desc}</p>
      <div>{statusBadge}</div>
      {actions}
      {extra}
    </section>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 p-4">
        <KeyRound className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm text-slate-700 dark:text-slate-300">
          <p className="font-bold text-slate-900 dark:text-white">บัญชีนี้มี PIN ชุดเดียว (1 บัญชี = 1 PIN)</p>
          <p className="mt-0.5">
            PIN ชุดนี้ใช้ทั้งล็อก/ปลดล็อกหน้าจอ{canUseRiskyActions ? ' และยืนยันรายการเสี่ยง' : ''} — ตั้งหรือเปลี่ยนจากการ์ดไหนก็เป็น PIN เดียวกัน
          </p>
        </div>
      </div>

      {card(
        <Lock className="w-4 h-4" />,
        'PIN สำหรับล็อก/ปลดล็อกหน้าจอ',
        `ล็อกหน้าจอเมื่อไม่ได้ใช้งานหรือเมื่อกดล็อกเอง โดยไม่ต้องออกจากระบบ ปลดล็อกด้วย PIN แล้วกลับมาหน้าเดิม${canUseRiskyActions ? ' — ใช้ PIN ชุดเดียวกับการยืนยันรายการเสี่ยง' : ''}`,
        pinSet && status ? (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60 text-sm font-semibold text-slate-700 dark:text-slate-300">
            ล็อกหน้าจออัตโนมัติเมื่อไม่ได้ใช้งาน
            <CustomSelect
              ariaLabel="ล็อกหน้าจออัตโนมัติเมื่อไม่ได้ใช้งาน"
              className="mt-1.5 block sm:w-64"
              disabled={busy}
              value={String(status.autoLockSeconds)}
              onChange={(value) => void changeAutoLock(String(value))}
              options={status.autoLockOptions.map((s) => ({ value: String(s), label: lockLabel(s) }))}
            />
          </div>
        ) : null
      )}

      {canUseRiskyActions && card(
        <ShieldAlert className="w-4 h-4" />,
        'PIN สำหรับยืนยันรายการเสี่ยง',
        'ใช้ยืนยันรายการที่กระทบเงินหรือสต็อก เช่น คืนเงิน ยกเลิกบิล ปรับสต็อก บันทึกรายจ่าย — ใช้ PIN ชุดเดียวกับการล็อกหน้าจอ'
      )}

      <PinSetupDialog
        open={dialog !== null}
        mode={dialog ?? 'set'}
        onClose={() => setDialog(null)}
        onDone={() => showToast(dialog === 'change' ? 'เปลี่ยน PIN แล้ว' : 'ตั้ง PIN แล้ว', 'ใช้ได้ทันทีทั้งล็อกหน้าจอและยืนยันรายการ', 'SUCCESS')}
      />
    </div>
  )
}
