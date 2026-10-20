'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Lock, ArrowRight, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { logout, updatePassword } from '@/app/actions/auth'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  // Recovery session is created by /auth/callback from the email link
  const { session, loading: authLoading } = useAuth()
  const [linkInvalid, setLinkInvalid] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('status')
    if (status === 'invalid-link') setLinkInvalid(true)
  }, [])

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร')
      return
    }

    if (password !== confirmPassword) {
      setError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน')
      return
    }

    if (submittingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    try {
      const result = await updatePassword(password)
      if (result.success) {
        setIsSuccess(true)
        // End the recovery session so the user signs in again with the new password
        try {
          await logout()
          await createClient().auth.signOut({ scope: 'local' })
        } catch {
          // Password is already updated; a sign-out failure must not hide the success state
        }
      } else {
        setError(result.error || 'ไม่สามารถเปลี่ยนรหัสผ่านได้')
      }
    } catch {
      setError('เกิดข้อผิดพลาดในการเชื่อมต่อระบบ')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const noRecoverySession = !isSuccess && (linkInvalid || (!authLoading && !session))

  return (
    <AuthLayout>
      <div className="w-full max-w-sm sm:max-w-md mx-auto space-y-4">
        <div className="text-left space-y-1">
          <h2 className="text-[26px] font-bold text-slate-900 dark:text-white tracking-tight">
            ตั้งรหัสผ่านใหม่
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs">
            กรุณากำหนดรหัสผ่านใหม่สำหรับบัญชีผู้ใช้งานของคุณ
          </p>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-2.5 text-rose-600 dark:text-rose-400 text-xs font-semibold animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isSuccess ? (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-500 dark:text-emerald-400 mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">เปลี่ยนรหัสผ่านสำเร็จ</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                คุณสามารถใช้รหัสผ่านใหม่เข้าสู่ระบบได้ทันที
              </p>
            </div>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-500/25 transition-colors"
            >
              <span>ไปที่หน้าเข้าสู่ระบบ</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : authLoading && !linkInvalid ? (
          <div className="text-center py-6 text-xs text-slate-500 dark:text-slate-400">
            กำลังตรวจสอบลิงก์รีเซ็ตรหัสผ่าน...
          </div>
        ) : noRecoverySession ? (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-full bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-500 dark:text-amber-400 mx-auto">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                กรุณาขอลิงก์ใหม่ และเปิดลิงก์จากอีเมลล่าสุดเท่านั้น
              </p>
            </div>
            <Link
              href="/forgot-password"
              className="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-500/25 transition-colors"
            >
              <span>ขอลิงก์รีเซ็ตรหัสผ่านใหม่</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1.5">รหัสผ่านใหม่</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="อย่างน้อย 8 ตัวอักษร"
                  autoFocus
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 focus:outline-none transition-colors cursor-pointer"
                  aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1.5">ยืนยันรหัสผ่านใหม่</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="กรอกรหัสผ่านใหม่ซ้ำอีกครั้ง"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 focus:outline-none transition-colors cursor-pointer"
                  aria-label={showConfirmPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <span>กำลังบันทึก...</span>
              ) : (
                <>
                  <span>บันทึกรหัสผ่านใหม่</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        <p className="text-center text-[10px] text-slate-400 dark:text-slate-600 pt-3 border-t border-slate-200 dark:border-slate-800">
          Rental POS &copy; {new Date().getFullYear()} - All rights reserved
        </p>
      </div>
    </AuthLayout>
  )
}