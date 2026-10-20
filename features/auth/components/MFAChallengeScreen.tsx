'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ShieldCheck, LogOut, AlertCircle, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { AuthLayout } from '@/features/auth/components/AuthLayout'

interface MFAChallengeScreenProps {
  onSuccess?: () => void
}

export function MFAChallengeScreen({ onSuccess }: MFAChallengeScreenProps) {
  const supabase = createClient()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
  }, [supabase]) // createClient() returns a singleton, so this runs once

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const [code, setCode] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isShaking, setIsShaking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleVerify = async (codeToVerify: string) => {
    const clean = codeToVerify.trim().replace(/\D/g, '')
    if (clean.length !== 6) {
      setErrorMsg('กรุณากรอกรหัสยืนยัน 6 หลัก')
      return
    }

    setIsSubmitting(true)
    setErrorMsg(null)
    try {
      const { data: factorsData } = await supabase.auth.mfa.listFactors()
      const verifiedFactor = factorsData?.all?.find((f) => f.status === 'verified')
      if (!verifiedFactor) throw new Error('ไม่พบ 2FA ที่ใช้งานอยู่')
      
      const challenge = await supabase.auth.mfa.challenge({ factorId: verifiedFactor.id })
      if (challenge.error) throw challenge.error
      
      const verify = await supabase.auth.mfa.verify({
        factorId: verifiedFactor.id,
        challengeId: challenge.data.id,
        code: clean
      })
      
      if (verify.error) throw verify.error

      setCode('')
      if (onSuccess) {
        onSuccess()
      }
    } catch (err: any) {
      setIsShaking(true)
      setTimeout(() => setIsShaking(false), 500)
      setErrorMsg(err?.message || 'รหัสยืนยัน 6 หลักไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่อีกครั้ง')
      setCode('')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(val)
    setErrorMsg(null)
    if (val.length === 6) {
      void handleVerify(val)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void handleVerify(code)
  }

  return (
    <AuthLayout className="z-[9999] select-none animate-in fade-in duration-300">
      <div className="w-full max-w-sm sm:max-w-md mx-auto space-y-5">
        {/* Top Header */}
        <div className="w-full flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-500 dark:text-blue-400 text-xs font-bold">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">การยืนยันตัวตนสองชั้น (2FA)</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">Authenticator Security Check</span>
            </div>
          </div>

          <button
            onClick={() => logout()}
            disabled={isSubmitting}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-red-50 dark:bg-slate-800/80 dark:hover:bg-red-950/60 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            title="ออกจากระบบ"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>ออกจากระบบ</span>
          </button>
        </div>

        {/* 2FA Form */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl sm:rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-600 border-2 border-blue-400/30 flex items-center justify-center text-white text-xl font-black shadow-xl shadow-blue-500/25 mx-auto">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">ยืนยันรหัส Authenticator</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            บัญชี <span className="text-blue-600 dark:text-blue-400 font-bold">@{user?.username || 'user'}</span> เปิดใช้งาน 2FA ไว้
            กรุณากรอกรหัส 6 หลักจากแอป Authenticator ของคุณ
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs font-semibold animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className={`relative flex items-center justify-center ${isShaking ? 'animate-shake' : ''}`}>
            {/* Visual 6-digit boxes */}
            <div className="flex items-center justify-center gap-2.5">
              {[0, 1, 2, 3, 4, 5].map((idx) => {
                const char = code[idx] || ''
                const isCurrent = code.length === idx
                return (
                  <div
                    key={idx}
                    className={`w-10 h-12 rounded-xl flex items-center justify-center text-lg font-black font-mono transition-all ${
                      char
                        ? 'bg-blue-500/20 border-2 border-blue-500 text-slate-900 dark:text-white shadow-md shadow-blue-500/25'
                        : isCurrent
                        ? 'bg-slate-100 dark:bg-slate-800/90 border-2 border-blue-400/60 text-transparent animate-pulse'
                        : 'bg-slate-50 dark:bg-slate-950/60 border border-slate-300 dark:border-slate-800 text-transparent'
                    }`}
                  >
                    {char}
                  </div>
                )
              })}
            </div>

            {/* Hidden real input capturing user keystrokes / paste */}
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={handleCodeChange}
              autoFocus
              disabled={isSubmitting}
              autoComplete="one-time-code"
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              aria-label="รหัสยืนยัน 6 หลักจากแอป Authenticator"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || code.length !== 6}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <span>กำลังตรวจสอบรหัส...</span>
            ) : (
              <>
                <span>ยืนยันรหัสเข้าสู่ระบบ</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-500">
          ไม่สามารถเข้าถึงแอป Authenticator? กรุณาติดต่อผู้ดูแลระบบเพื่อรีเซ็ต
        </p>

        {/* Footer info */}
        <p className="text-center text-[10px] text-slate-400 dark:text-slate-600 pt-3 border-t border-slate-200 dark:border-slate-800">
          Rental POS &bull; TOTP Multi-Factor Authentication
        </p>
      </div>
    </AuthLayout>
  )
}
