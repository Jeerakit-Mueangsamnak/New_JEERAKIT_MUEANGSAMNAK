'use client'

import React, { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mail, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useAppLock } from '@/features/auth/contexts/AppLockContext'
import { createClient } from '@/lib/supabase/client'
import { recoverOwnerPin, validatePinFormat } from '@/features/auth/services/pin-lock'

/**
 * OWNER "ลืม PIN" (Master v4.3.1 §4.3): the old PIN is never shown or sent (only a hash
 * exists). The OWNER proves who they are the usual way — an e-mail link or the account
 * password — then sets a new PIN. Only the PIN changes; the change is audited.
 * A USER's forgotten PIN is reset by the OWNER in the member screen instead.
 */
export default function ForgotPinPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPin />
    </Suspense>
  )
}

function ForgotPin() {
  const router = useRouter()
  const params = useSearchParams()
  const { user } = useAuth()
  const { refreshLockState, unlockApp } = useAppLock()
  const [verified, setVerified] = useState(params.get('verified') === '1')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user && user.role !== 'OWNER') {
    return (
      <AuthLayout>
        <div className="max-w-sm mx-auto space-y-3 text-center">
          <h2 className="text-xl font-bold">ลืม PIN</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">ให้เจ้าของร้านล้าง PIN ให้ที่เมนูจัดการสิทธิ์ แล้วตั้ง PIN ใหม่</p>
          <button type="button" onClick={() => router.back()} className="text-sm font-bold text-blue-600">กลับ</button>
        </div>
      </AuthLayout>
    )
  }

  const sendEmailLink = async () => {
    if (!user?.email) return setError('บัญชีนี้ไม่มีอีเมล — ใช้รหัสผ่านแทน')
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.auth.signInWithOtp({
      email: user.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/forgot-pin?verified=1')}`,
      },
    })
    setBusy(false)
    if (err) setError(err.message)
    else setInfo(`ส่งลิงก์ยืนยันไปที่ ${user.email} แล้ว — เปิดอีเมลแล้วกดลิงก์บนเครื่องนี้`)
  }

  const verifyPassword = async () => {
    if (!user?.email || !password) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.auth.signInWithPassword({ email: user.email, password })
    setBusy(false)
    setPassword('')
    if (err) setError('รหัสผ่านไม่ถูกต้อง')
    else setVerified(true)
  }

  const saveNewPin = async () => {
    const check = validatePinFormat(pin)
    if (!check.isValid) return setError(check.error)
    if (pin !== pin2) return setError('PIN สองช่องไม่ตรงกัน')
    setBusy(true)
    setError(null)
    try {
      await recoverOwnerPin(pin)
      unlockApp()
      await refreshLockState()
      setInfo('ตั้ง PIN ใหม่เรียบร้อย')
      setTimeout(() => router.replace('/dashboard'), 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ตั้ง PIN ใหม่ไม่สำเร็จ')
      setVerified(false)
    } finally {
      setBusy(false)
      setPin('')
      setPin2('')
    }
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-sm mx-auto space-y-4">
        <div>
          <h2 className="text-[26px] font-bold text-slate-900 dark:text-white">ลืม PIN</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">ยืนยันตัวตนก่อน แล้วตั้ง PIN ใหม่ — ระบบเปลี่ยนเฉพาะ PIN ไม่แตะข้อมูลอื่น</p>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-2 text-rose-600 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
          </div>
        )}
        {info && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center gap-2 text-emerald-700 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 shrink-0" /><span>{info}</span>
          </div>
        )}

        {!verified ? (
          <div className="space-y-4">
            <button type="button" disabled={busy} onClick={() => void sendEmailLink()}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-blue-600 text-white py-3 text-sm font-bold disabled:opacity-50">
              <Mail className="w-4 h-4" /> ส่งลิงก์ยืนยันทางอีเมล
            </button>
            <div className="text-center text-[11px] text-slate-400">หรือ</div>
            <div className="space-y-2">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="รหัสผ่านของบัญชี"
                className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm" />
              <button type="button" disabled={busy || !password} onClick={() => void verifyPassword()}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-300 dark:border-slate-700 py-2.5 text-sm font-bold disabled:opacity-50">
                <KeyRound className="w-4 h-4" /> ยืนยันด้วยรหัสผ่าน
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="PIN ใหม่ 6 หลัก" className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-center tracking-[0.4em] font-mono" />
            <input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="ยืนยัน PIN ใหม่" className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-center tracking-[0.4em] font-mono" />
            <button type="button" disabled={busy || pin.length !== 6 || pin2.length !== 6} onClick={() => void saveNewPin()}
              className="w-full rounded-2xl bg-blue-600 text-white py-3 text-sm font-bold disabled:opacity-50">
              ตั้ง PIN ใหม่
            </button>
          </div>
        )}
      </div>
    </AuthLayout>
  )
}
