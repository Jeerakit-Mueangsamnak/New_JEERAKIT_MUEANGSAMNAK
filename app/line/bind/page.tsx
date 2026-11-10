'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React, { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { SETTINGS_HELPER, SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { type LineInviteKind } from '@/lib/line/config'

/**
 * Invite link page (LIFF), opened in the LINE app from https://liff.line.me/<LIFF id>?t=<code>&k=<kind>.
 * The person types their name (+ phone for a customer) and LINE ID; the LINE userId is never
 * typed: the server reads it from the LIFF ID token after LINE verified it.
 */

type Phase = 'loading' | 'form' | 'sending' | 'done' | 'error'

const KIND_TITLE: Record<LineInviteKind, string> = {
  STAFF: 'ยืนยันตัวตนพนักงาน',
  DRIVER: 'ยืนยันตัวตนคนขับ',
  CUSTOMER: 'ยืนยันตัวตนลูกค้า',
}

type Liff = (typeof import('@line/liff'))['default']

export default function LineBindPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState('')
  const [liff, setLiff] = useState<Liff | null>(null)
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<LineInviteKind>('STAFF')
  const [isFriend, setIsFriend] = useState<boolean | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [lineHandle, setLineHandle] = useState('')

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    if (!liffId) {
      setMessage('ระบบผูก LINE ยังไม่ได้ตั้งค่า กรุณาแจ้งร้าน')
      setPhase('error')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const sdk = (await import('@line/liff')).default
        await sdk.init({ liffId })
        if (!sdk.isLoggedIn()) {
          sdk.login({ redirectUri: window.location.href })
          return
        }
        const params = new URLSearchParams(window.location.search)
        const t = (params.get('t') || '').trim().toUpperCase()
        const k = (params.get('k') || '').toUpperCase()
        if (!/^LINK-[A-HJ-NP-Z2-9]{10}$/.test(t)) {
          setMessage('ลิงก์ไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากร้าน')
          setPhase('error')
          return
        }
        const [profile, friendship] = await Promise.all([
          sdk.getProfile().catch(() => null),
          sdk.getFriendship().catch(() => null),
        ])
        if (cancelled) return
        setLiff(sdk)
        setCode(t)
        setKind(k === 'CUSTOMER' || k === 'DRIVER' ? k : 'STAFF')
        setIsFriend(friendship ? friendship.friendFlag : null)
        setName(profile?.displayName ?? '')
        setPhase('form')
      } catch {
        if (!cancelled) {
          setMessage('เปิดหน้ายืนยันไม่สำเร็จ กรุณาเปิดลิงก์ในแอป LINE อีกครั้ง')
          setPhase('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!liff || phase === 'sending') return
    setPhase('sending')
    try {
      const res = await fetch('/api/line/liff-bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: liff.getIDToken(), code, typedName: name, typedPhone: phone, lineHandle, isFriend }),
      })
      const body = (await res.json()) as { ok: boolean; message?: string; result?: string }
      setMessage(body.message || (body.ok ? 'ผูก LINE เรียบร้อย' : 'ผูก LINE ไม่สำเร็จ'))
      // a missing name / phone keeps the form open; anything else is final
      setPhase(body.ok ? 'done' : body.result === 'NAME_REQUIRED' || body.result === 'PHONE_REQUIRED' ? 'form' : 'error')
    } catch {
      setMessage('ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่')
      setPhase('form')
    }
  }

  return (
    <AuthLayout brandingTitle="ผูก LINE กับร้าน" brandingSubtitle="รับแจ้งเตือนและงานทาง LINE">
      <div className="w-full max-w-sm mx-auto space-y-4">
        <h1 className="text-lg font-black text-slate-900 dark:text-slate-100">{KIND_TITLE[kind]}</h1>

        {phase === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังเปิดหน้ายืนยัน…
          </p>
        )}

        {(phase === 'form' || phase === 'sending') && (
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <div>
              <label className={SETTINGS_LABEL} htmlFor="bind-name">
                ชื่อ-นามสกุล
              </label>
              <input id="bind-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={SETTINGS_INPUT} />
            </div>
            {kind === 'CUSTOMER' && (
              <div>
                <label className={SETTINGS_LABEL} htmlFor="bind-phone">
                  เบอร์โทร (เบอร์ที่ให้ไว้กับร้าน)
                </label>
                <input
                  id="bind-phone"
                  required
                  inputMode="tel"
                  maxLength={30}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={SETTINGS_INPUT}
                />
              </div>
            )}
            <div>
              <label className={SETTINGS_LABEL} htmlFor="bind-lineid">
                ไอดีไลน์ (ถ้ามี)
              </label>
              <input id="bind-lineid" maxLength={60} value={lineHandle} onChange={(e) => setLineHandle(e.target.value)} className={SETTINGS_INPUT} />
            </div>
            {message && <p className="text-xs text-red-700 dark:text-red-400">{message}</p>}
            {isFriend === false && <p className={SETTINGS_HELPER}>กรุณาเพิ่มเพื่อน LINE ร้านด้วย เพื่อรับข้อความแจ้งเตือน</p>}
            <button
              type="submit"
              disabled={phase === 'sending'}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full bg-[#06C755] hover:brightness-95 text-white flex items-center justify-center disabled:opacity-60`}
            >
              {phase === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
              ยืนยันตัวตน
            </button>
          </form>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-5 h-5 shrink-0" /> {message}
            </p>
            {liff?.isInClient() && (
              <button type="button" onClick={() => liff.closeWindow()} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full border border-slate-300 dark:border-slate-700`}>
                ปิดหน้านี้
              </button>
            )}
          </div>
        )}

        {phase === 'error' && (
          <p className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" /> {message}
          </p>
        )}
      </div>
    </AuthLayout>
  )
}
