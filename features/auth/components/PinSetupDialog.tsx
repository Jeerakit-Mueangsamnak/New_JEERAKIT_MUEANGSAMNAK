'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import { ModalPortal } from '@/components/common/ModalPortal'
import { PinPad } from '@/features/auth/components/PinPad'
import { useAppLock } from '@/features/auth/contexts/AppLockContext'
import {
  describePinRefusal,
  setPinOnServer,
  validatePinFormat,
  verifyPinOnServer,
} from '@/features/auth/services/pin-lock'

type Step = 'current' | 'new' | 'confirm'

interface PinSetupDialogProps {
  open: boolean
  /** 'set' = the user has no PIN yet; 'change' = asks for the current PIN first. */
  mode: 'set' | 'change'
  onClose: () => void
  /** Called after the server saved the PIN (only its hash is stored). */
  onDone?: () => void
}

/**
 * Set / change the user's own PIN: centred title, 6 boxes, keypad below, steps
 * "1. ตั้ง PIN → 2. ยืนยัน PIN" (plus "ใส่ PIN เดิม" first when changing).
 * Cancel / back are secondary actions at the bottom — there is no sign-out here.
 */
export function PinSetupDialog({ open, mode, onClose, onDone }: PinSetupDialogProps) {
  const { refreshLockState } = useAppLock()
  const [step, setStep] = useState<Step>(mode === 'change' ? 'current' : 'new')
  const [value, setValue] = useState('')
  const [newPin, setNewPin] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(mode === 'change' ? 'current' : 'new')
    setValue('')
    setNewPin('')
    setToken(null)
    setError(null)
    setBusy(false)
  }, [open, mode])

  const advance = useCallback(async (pin: string) => {
    setError(null)
    if (step === 'current') {
      setBusy(true)
      try {
        const r = await verifyPinOnServer(pin, 'ACTION', 'PIN_CHANGE')
        if (r.ok && r.token) {
          setToken(r.token)
          setStep('new')
        } else {
          setError(describePinRefusal(r))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ตรวจสอบ PIN ไม่สำเร็จ')
      } finally {
        setBusy(false)
        setValue('')
      }
      return
    }
    if (step === 'new') {
      const check = validatePinFormat(pin)
      if (!check.isValid) {
        setError(check.error || 'PIN นี้เดาง่ายเกินไป')
        setValue('')
        return
      }
      setNewPin(pin)
      setValue('')
      setStep('confirm')
      return
    }
    if (pin !== newPin) {
      setError('PIN ที่ยืนยันไม่ตรงกับที่ตั้งไว้ ลองอีกครั้ง')
      setValue('')
      return
    }
    setBusy(true)
    try {
      await setPinOnServer(pin, token)
      await refreshLockState()
      onDone?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึก PIN ไม่สำเร็จ')
      setValue('')
    } finally {
      setBusy(false)
    }
  }, [step, newPin, token, refreshLockState, onDone, onClose])

  useEffect(() => {
    if (open && value.length === 6 && !busy) void advance(value)
  }, [open, value, busy, advance])

  if (!open) return null

  const isFirstStep = step === (mode === 'change' ? 'current' : 'new')
  const goBack = () => {
    setError(null)
    setValue('')
    if (step === 'confirm') setStep('new')
    else if (step === 'new' && mode === 'change') { setStep('current'); setToken(null) }
  }

  const heading = step === 'current' ? 'ใส่ PIN เดิม' : step === 'new' ? (mode === 'change' ? 'ตั้ง PIN ใหม่' : 'ตั้ง PIN') : 'ยืนยัน PIN'
  const hint = step === 'current'
    ? 'ใส่ PIN ปัจจุบันก่อนเปลี่ยน'
    : step === 'new'
      ? 'ตัวเลข 6 หลัก ห้ามเลขซ้ำทั้งหมดหรือเลขเรียง'
      : 'กด PIN ชุดเดิมอีกครั้ง'
  const chip = (active: boolean) =>
    `px-3 py-1 rounded-full text-[11px] font-bold ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[10001] bg-black/50 flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label={heading}>
        <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl px-6 py-7 flex flex-col items-center">
          <ShieldCheck className="w-8 h-8 text-blue-600" />
          <h2 className="mt-3 text-xl font-bold text-slate-900 dark:text-white text-center">{heading}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 text-center">{hint}</p>

          <div className="mt-4 flex items-center gap-2">
            {mode === 'change' && <span className={chip(step === 'current')}>PIN เดิม</span>}
            <span className={chip(step === 'new')}>1. ตั้ง PIN</span>
            <span className={chip(step === 'confirm')}>2. ยืนยัน PIN</span>
          </div>

          <div className="mt-6 w-full">
            <PinPad value={value} onChange={(v) => { setError(null); setValue(v) }} disabled={busy} />
          </div>

          <div className="mt-5 min-h-[20px] text-center">
            {busy ? (
              <span className="text-xs text-slate-500">กำลังบันทึก…</span>
            ) : error ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={isFirstStep ? onClose : goBack}
            disabled={busy}
            className="mt-3 w-full rounded-xl border border-slate-300 dark:border-slate-700 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {isFirstStep ? 'ยกเลิก' : 'ย้อนกลับ'}
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}
