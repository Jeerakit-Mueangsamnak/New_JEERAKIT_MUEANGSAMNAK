'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldCheck, X, AlertCircle } from 'lucide-react'
import {
  registerPinConfirmer,
  type PinConfirmRequest,
  type PinConfirmResult,
} from '@/lib/db/pin-confirm'
import { useRouter } from 'next/navigation'
import { describePinRefusal, verifyPinOnServer } from '@/features/auth/services/pin-lock'
import { useAppLock } from '@/features/auth/contexts/AppLockContext'
import { PinSetupDialog } from '@/features/auth/components/PinSetupDialog'

interface Pending {
  req: PinConfirmRequest
  resolve: (r: PinConfirmResult | null) => void
}

/** Mount once near the root: renders the PIN dialog used by withPin / withPinIfRequired. */
export function PinConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { status } = useAppLock()
  // No PIN yet: the risky action waits while the user sets one (in place, so the cart / form
  // on this page is kept) and then continues to the normal PIN check.
  const needsPin = Boolean(status && !status.pinSet)

  useEffect(() => {
    registerPinConfirmer((req) =>
      new Promise<PinConfirmResult | null>((resolve) => {
        setPin('')
        setReason(req.defaultReason ?? '')
        setError(null)
        setPending({ req, resolve })
      })
    )
    return () => registerPinConfirmer(null)
  }, [])

  useEffect(() => {
    if (pending && !needsPin) setTimeout(() => inputRef.current?.focus(), 50)
  }, [pending, needsPin])

  const close = useCallback((result: PinConfirmResult | null) => {
    pending?.resolve(result)
    setPending(null)
    setPin('')
  }, [pending])

  const submit = useCallback(async () => {
    if (!pending || busy) return
    if (!/^\d{6}$/.test(pin)) {
      setError('PIN ต้องเป็นตัวเลข 6 หลัก')
      return
    }
    if (pending.req.askReason && !reason.trim()) {
      setError('กรุณาระบุเหตุผล')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await verifyPinOnServer(pin, 'ACTION', pending.req.action)
      if (r.ok && r.token) {
        close({ token: r.token, reason: pending.req.askReason ? reason.trim() : undefined })
      } else {
        setPin('')
        setError(describePinRefusal(r))
      }
    } catch (err) {
      setPin('')
      setError(err instanceof Error ? err.message : 'ตรวจสอบ PIN ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }, [pending, busy, pin, reason, close])

  return (
    <>
      {children}
      {pending && needsPin && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-6 flex flex-col items-center text-center">
            <ShieldCheck className="w-8 h-8 text-blue-600" />
            <h3 className="mt-3 font-bold text-slate-900 dark:text-white">ยังไม่ได้ตั้ง PIN</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              &ldquo;{pending.req.title}&rdquo; ต้องยืนยันด้วย PIN ของคุณ ตั้ง PIN ก่อน แล้วทำรายการนี้ต่อได้ทันที
            </p>
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="mt-5 w-full rounded-xl bg-blue-600 hover:bg-blue-500 text-white py-2.5 text-sm font-bold"
            >
              ตั้ง PIN
            </button>
            <button
              type="button"
              onClick={() => { close(null); router.push('/account?tab=SECURITY') }}
              className="mt-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              ไปหน้า ตั้งค่าส่วนตัว &rsaquo; ความปลอดภัย
            </button>
            <button
              type="button"
              onClick={() => close(null)}
              className="mt-3 w-full rounded-xl border border-slate-300 dark:border-slate-700 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300"
            >
              ยกเลิกรายการ
            </button>
          </div>
        </div>
      )}
      <PinSetupDialog open={Boolean(pending && needsPin && setupOpen)} mode="set" onClose={() => setSetupOpen(false)} />
      {pending && !needsPin && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">{pending.req.title}</h3>
                  {pending.req.detail && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-line mt-0.5">{pending.req.detail}</p>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => close(null)} className="p-1 text-slate-400 hover:text-slate-700" aria-label="ยกเลิก">
                <X className="w-4 h-4" />
              </button>
            </div>

            {pending.req.askReason && (
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {pending.req.reasonLabel || 'เหตุผล'}
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  placeholder="เช่น ลูกค้าประจำ ตัดเศษให้"
                />
              </label>
            )}

            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              PIN 6 หลักของคุณ
              <input
                ref={inputRef}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-center text-xl tracking-[0.5em] font-mono"
                aria-label="PIN"
              />
            </label>

            {error && (
              <div className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => close(null)} className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 py-2 text-sm font-semibold">
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || pin.length !== 6}
                className="flex-1 rounded-xl bg-blue-600 text-white py-2 text-sm font-bold disabled:opacity-50"
              >
                {busy ? 'กำลังตรวจสอบ…' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
