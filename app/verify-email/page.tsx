'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { CheckCircle2, Clock, RefreshCw, ArrowRight, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuthLayout } from '@/features/auth/components/AuthLayout'

type VerifyState = 'CHECKING' | 'VERIFIED' | 'EXPIRED'

/**
 * Landing page after the confirmation email link.
 * /auth/callback exchanges the link for a real Supabase session and redirects here with
 * ?status=verified (success) or ?status=invalid-link (expired / already used / other device).
 */
export default function VerifyEmailPage() {
  const [status, setStatus] = useState<VerifyState>('CHECKING')
  const [isResending, setIsResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [emailInput, setEmailInput] = useState('')

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    async function checkStatus() {
      const callbackStatus = new URLSearchParams(window.location.search).get('status')
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        setUserEmail(user.email ?? null)
        setStatus(user.email_confirmed_at ? 'VERIFIED' : 'EXPIRED')
        return
      }

      // No session in this browser: trust only the callback result, never assume success
      setStatus(callbackStatus === 'verified' ? 'VERIFIED' : 'EXPIRED')
    }
    void checkStatus()
  }, [supabase])

  const handleResend = async () => {
    const email = (userEmail || emailInput).trim().toLowerCase()
    if (!email || isResending) return
    setIsResending(true)
    setResendError(null)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/verify-email` },
      })
      if (error) {
        setResendError(
          error.status === 429
            ? 'ส่งอีเมลบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
            : 'ไม่สามารถส่งอีเมลยืนยันได้ กรุณาลองใหม่อีกครั้ง'
        )
        return
      }
      setResendSuccess(true)
    } catch {
      setResendError('เกิดข้อผิดพลาดในการเชื่อมต่อระบบ')
    } finally {
      setIsResending(false)
    }
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-sm sm:max-w-md mx-auto space-y-4">
        <div className="text-left space-y-1">
          <h2 className="text-[26px] font-bold text-slate-900 dark:text-white tracking-tight">
            ยืนยันที่อยู่อีเมล
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs">
            การยืนยันอีเมลสำหรับบัญชีผู้ใช้งาน Rental POS
          </p>
        </div>

        {/* State Display */}
        {status === 'CHECKING' && (
          <div className="text-center py-6 space-y-3">
            <RefreshCw className="w-8 h-8 text-blue-500 dark:text-blue-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold">กำลังตรวจสอบโทเค็นยืนยันอีเมล...</p>
            <p className="text-[11px] text-slate-500">กรุณารอสักครู่ ระบบกำลังสื่อสารกับเซิร์ฟเวอร์</p>
          </div>
        )}

        {status === 'VERIFIED' && (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-500 dark:text-emerald-400 mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">ยืนยันอีเมลสำเร็จเรียบร้อย</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                อีเมลของคุณได้รับการยืนยันแล้ว สามารถเข้าใช้งานระบบ Rental POS ได้ทันที
              </p>
            </div>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-500/20"
            >
              <span>ไปที่หน้าเข้าสู่ระบบ</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {status === 'EXPIRED' && (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-full bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-500 dark:text-amber-400 mx-auto">
              <Clock className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">ลิงก์ยืนยันอีเมลหมดอายุ</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                ลิงก์นี้หมดอายุการใช้งานหรือถูกใช้งานไปแล้ว กรุณากดปุ่มเพื่อส่งอีเมลยืนยันใหม่อีกครั้ง
              </p>
            </div>

            {resendSuccess ? (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                ส่งอีเมลยืนยันใหม่ไปยังกล่องจดหมายของคุณเรียบร้อยแล้ว
              </div>
            ) : (
              <div className="space-y-3 text-left">
                {!userEmail && (
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="อีเมลที่ใช้ลงทะเบียน"
                      aria-label="อีเมลที่ใช้ลงทะเบียน"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                  </div>
                )}
                {resendError && (
                  <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{resendError}</p>
                )}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isResending || (!userEmail && !emailInput.trim())}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
                  <span>{isResending ? 'กำลังส่งอีเมล...' : 'ส่งอีเมลยืนยันใหม่อีกครั้ง'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-center text-[10px] text-slate-400 dark:text-slate-500">
          <p>ระบบยืนยันอีเมลสำหรับเข้าใช้งาน</p>
          <Link href="/login" className="text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block">
            กลับสู่หน้าเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    </AuthLayout>
  )
}
