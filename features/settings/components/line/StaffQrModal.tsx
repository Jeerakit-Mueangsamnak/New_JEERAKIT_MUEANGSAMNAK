'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, QrCode, RefreshCw } from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { ActionButton } from '@/components/common/ActionButton'
import { createStaffLineQr, getLineCodeState, revokeLineCode } from '@/app/actions/line'
import { qrDataUrl } from '@/lib/qr-code'

/**
 * QR พนักงาน (owner 2026-11-25): the OWNER picks a staff member and presses แสดง QR; the staff member scans it at the
 * shop and sends the code in the shop chat. The QR lives 5 minutes (countdown), dies at the first scan, and has no
 * link to copy, so it cannot be sent to someone outside the shop. Closing the window cancels a code still open.
 */
type Phase = 'loading' | 'open' | 'scanned' | 'expired' | 'used' | 'error'

export function StaffQrModal({ profileId, name, onClose, onLinked }: { profileId: string; name: string; onClose: () => void; onLinked: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const code = useRef<{ id: string; expiresAt: number } | null>(null)

  const make = useCallback(async () => {
    setPhase('loading')
    setQr(null)
    const r = await createStaffLineQr(profileId)
    if (!r.success || !r.data) {
      setError(r.error || 'สร้าง QR ไม่สำเร็จ')
      return setPhase('error')
    }
    code.current = { id: r.data.codeId, expiresAt: Date.parse(r.data.expiresAt) }
    setQr(await qrDataUrl(r.data.qrText, { margin: 1, width: 240 }))
    setLeft(Math.max(0, Math.round((code.current.expiresAt - Date.now()) / 1000)))
    setPhase('open')
  }, [profileId])

  useEffect(() => {
    void make()
  }, [make])

  // countdown each second; the state of this code every 4 seconds, only while the window is open
  useEffect(() => {
    if (phase !== 'open' && phase !== 'scanned') return
    const tick = setInterval(() => {
      const k = code.current
      if (!k) return
      const s = Math.max(0, Math.round((k.expiresAt - Date.now()) / 1000))
      setLeft(s)
      if (s === 0) {
        code.current = null
        setQr(null)
        setPhase('expired')
      }
    }, 1000)
    const poll = setInterval(() => {
      const k = code.current
      if (!k || document.hidden) return
      void getLineCodeState(k.id).then((r) => {
        if (!r.success || !r.data || code.current?.id !== k.id) return
        if (r.data.state === 'USED') {
          code.current = null
          setQr(null)
          setPhase('used')
          onLinked()
        } else if (r.data.state === 'SCANNED') {
          // the QR is dead; the staff member has 5 minutes from the scan to send the code in the chat
          k.expiresAt = Date.parse(r.data.expires_at)
          setQr(null)
          setPhase('scanned')
        } else if (r.data.state !== 'OPEN') {
          code.current = null
          setQr(null)
          setPhase('expired')
        }
      })
    }, 4000)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [phase, onLinked])

  const close = () => {
    const k = code.current
    code.current = null
    if (k) void revokeLineCode(k.id)
    onClose()
  }

  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  return (
    <AppModal isOpen onClose={close} size="sm">
      <AppModalHeader onClose={close} icon={<QrCode className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />}>
        <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">QR ผูก LINE · {name}</h3>
      </AppModalHeader>
      <AppModalBody className="flex flex-col items-center gap-3 text-center min-h-64 justify-center">
        {phase === 'loading' && <Loader2 className="w-6 h-6 animate-spin text-slate-500" />}
        {phase === 'open' && qr && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL QR, nothing to optimise */}
            <img src={qr} alt={`QR ผูก LINE ของ ${name}`} className="w-56 h-56 rounded-xl bg-white p-2 border border-slate-200" />
            <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{mm}:{ss}</p>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">ให้ {name} สแกนด้วยกล้อง แล้วกดส่งข้อความในแชต LINE ร้าน · ใช้ได้ครั้งเดียว</p>
          </>
        )}
        {phase === 'scanned' && (
          <>
            <p className="text-sm font-bold text-blue-700 dark:text-blue-300">สแกนแล้ว QR นี้ใช้ไม่ได้อีก</p>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">รอ {name} กดส่งข้อความในแชต LINE ร้าน · เหลือ {mm}:{ss}</p>
          </>
        )}
        {phase === 'expired' && <p className="text-sm font-bold text-amber-700 dark:text-amber-300">QR หมดอายุแล้ว</p>}
        {phase === 'used' && (
          <p className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-5 h-5" /> {name} ผูก LINE แล้ว
          </p>
        )}
        {phase === 'error' && <p className="text-sm font-bold text-red-700 dark:text-red-400">{error}</p>}
      </AppModalBody>
      <AppModalFooter>
        {(phase === 'expired' || phase === 'error') && (
          <ActionButton variant="primary" icon={<RefreshCw />} onClick={() => void make()}>
            สร้าง QR ใหม่
          </ActionButton>
        )}
        <ActionButton variant="cancel" onClick={close}>
          ปิด
        </ActionButton>
      </AppModalFooter>
    </AppModal>
  )
}
