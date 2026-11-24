'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React, { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { LINE_REGISTER_FIELD_LABELS, type LineRegisterField } from '@/lib/line/config'
import { postLiff, useLiff, type Liff } from '@/lib/line/use-liff'

/**
 * Registration form (LIFF), opened in the LINE app from https://liff.line.me/<LIFF id>/register (owner 2026-11-21).
 * The person gives a name (or the shop's name) and a phone, and the address parts the owner asked for; the form only
 * files a REQUEST for the shop to check. The LINE userId is never typed: the server reads it from the verified ID token.
 */

type Phase = 'loading' | 'form' | 'sending' | 'done' | 'error'
type FormConfig = { required: Record<string, boolean>; privacy: string | null; shopName: string }

const DEFAULT_PRIVACY = 'ร้านเก็บชื่อ เบอร์โทร และที่อยู่ที่คุณกรอก เพื่อตรวจสอบการลงทะเบียน และส่งเอกสารหรือการแจ้งเตือนทาง LINE ให้คุณ'
const FIELD_ORDER: readonly LineRegisterField[] = ['address', 'subdistrict', 'district', 'province', 'postcode']

export default function LineRegisterPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState('')
  const [liff, setLiff] = useState<Liff | null>(null)
  const [config, setConfig] = useState<FormConfig>({ required: {}, privacy: null, shopName: 'ร้าน' })
  const [isFriend, setIsFriend] = useState<boolean | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState<Record<LineRegisterField, string>>({ province: '', district: '', subdistrict: '', address: '', postcode: '' })
  const [consent, setConsent] = useState(false)

  const opened = useLiff()

  useEffect(() => {
    if (opened.phase === 'loading') return
    if (opened.phase === 'error') {
      setMessage(opened.message)
      setPhase('error')
      return
    }
    const sdk = opened.liff
    let cancelled = false
    void (async () => {
      const [profile, friendship, cfg] = await Promise.all([
        sdk.getProfile().catch(() => null),
        sdk.getFriendship().catch(() => null),
        fetch('/api/line/liff-register')
          .then((r) => r.json() as Promise<{ ok: boolean } & Partial<FormConfig>>)
          .catch(() => null),
      ])
      if (cancelled) return
      if (!cfg?.ok) {
        setMessage('โหลดแบบฟอร์มไม่สำเร็จ กรุณาลองใหม่')
        setPhase('error')
        return
      }
      setLiff(sdk)
      setConfig({ required: cfg.required ?? {}, privacy: cfg.privacy ?? null, shopName: cfg.shopName ?? 'ร้าน' })
      setIsFriend(friendship ? friendship.friendFlag : null)
      setName(profile?.displayName ?? '')
      setPhase('form')
    })()
    return () => {
      cancelled = true
    }
  }, [opened])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!liff || phase === 'sending') return
    setPhase('sending')
    const body = await postLiff<{ ok: boolean; message?: string; result?: string }>(liff, '/api/line/liff-register', { name, phone, address, consent, isFriend })
    setMessage(body.message || (body.ok ? 'ส่งคำขอลงทะเบียนแล้ว' : 'ส่งคำขอไม่สำเร็จ'))
    // missing / wrong input (or a network failure: no result) keeps the form open; anything else is final
    setPhase(body.ok ? 'done' : !body.result || ['MISSING', 'INVALID', 'CONSENT_REQUIRED'].includes(body.result) ? 'form' : 'error')
  }

  return (
    <AuthLayout brandingTitle="ลงทะเบียนกับร้าน" brandingSubtitle="รับเอกสารและแจ้งเตือนทาง LINE">
      <div className="w-full max-w-sm mx-auto space-y-4">
        <h1 className="text-lg font-black text-slate-900 dark:text-slate-100">ลงทะเบียนลูกค้า</h1>

        {phase === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังเปิดแบบฟอร์ม…
          </p>
        )}

        {(phase === 'form' || phase === 'sending') && (
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <div>
              <label className={SETTINGS_LABEL} htmlFor="reg-name">
                ชื่อ-นามสกุล หรือชื่อกิจการ
              </label>
              <input id="reg-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={SETTINGS_INPUT} />
            </div>
            <div>
              <label className={SETTINGS_LABEL} htmlFor="reg-phone">
                เบอร์โทรศัพท์
              </label>
              <input id="reg-phone" required inputMode="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} className={SETTINGS_INPUT} />
            </div>
            {FIELD_ORDER.map((field) => (
              <div key={field}>
                <label className={SETTINGS_LABEL} htmlFor={`reg-${field}`}>
                  {LINE_REGISTER_FIELD_LABELS[field]}
                  {config.required[field] ? '' : ' (ถ้ามี)'}
                </label>
                <input
                  id={`reg-${field}`}
                  required={config.required[field] === true}
                  inputMode={field === 'postcode' ? 'numeric' : undefined}
                  maxLength={field === 'address' ? 300 : field === 'postcode' ? 10 : 100}
                  value={address[field]}
                  onChange={(e) => setAddress((a) => ({ ...a, [field]: e.target.value }))}
                  className={SETTINGS_INPUT}
                />
              </div>
            ))}
            <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0" />
              <span data-testid="register-privacy">
                {config.privacy ?? DEFAULT_PRIVACY}
                <b className="block mt-1 text-slate-900 dark:text-slate-100">ฉันรับทราบและยินยอมให้ {config.shopName} เก็บและใช้ข้อมูลตามที่ระบุ</b>
              </span>
            </label>
            {message && <p className="text-xs text-red-700 dark:text-red-400">{message}</p>}
            {isFriend === false && <p className="text-xs text-amber-700 dark:text-amber-300">กรุณาเพิ่มเพื่อน LINE ร้านด้วย เพื่อรับผลการลงทะเบียน</p>}
            <button
              type="submit"
              disabled={phase === 'sending' || !consent}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full bg-[#06C755] hover:brightness-95 text-white flex items-center justify-center disabled:opacity-60`}
            >
              {phase === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
              ส่งคำขอลงทะเบียน
            </button>
          </form>
        )}

        {phase === 'done' && (
          <p className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-5 h-5 shrink-0" /> {message}
          </p>
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
