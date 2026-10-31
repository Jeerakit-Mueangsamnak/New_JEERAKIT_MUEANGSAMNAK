'use client'

import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, MessageCircle, RefreshCw } from 'lucide-react'
import { ActionButton } from '@/components/common/ActionButton'
import { AppModal, AppModalBody, AppModalHeader } from '@/components/common/AppModal'
import { useToast } from '@/components/common/Toast'
import { createClient } from '@/lib/supabase/client'
import { createCustomerLineLinkCode } from '@/app/actions/line'

/**
 * Customer page › "สร้างลิงก์ผูก LINE": the customer's own single-use code as a QR (scan at the
 * counter) and a link (send from afar). The link opens the shop chat with the code typed in; one
 * send links that LINE to this customer. The time left comes from the code's own expiry
 * (Settings › LINE linkCodeTtlMinutes); the link carries only the code.
 */

interface Issued {
  code: string
  expiresAt: number
  oaUrl: string | null
  qr: string | null
}

const BTN = 'px-2.5 py-1.5 font-bold text-xs rounded-xl flex items-center gap-1.5 border shadow-sm transition-all'

function leftText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} นาที` : 'หมดอายุแล้ว'
}

export function CustomerLineLinkButton({ customerId, customerName }: { customerId?: string; customerName: string }) {
  const { showToast } = useToast()
  const [linkedName, setLinkedName] = useState<string | null | undefined>(undefined)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    if (!customerId) return setLinkedName(undefined)
    const { data, error } = await createClient()
      .from('line_contacts')
      .select('display_name')
      .eq('customer_id', customerId)
      .eq('status', 'LINKED')
      .maybeSingle()
    // no LINE tables in this database: keep the button; the action answers in Thai
    setLinkedName(error || !data ? null : ((data.display_name as string | null) ?? ''))
  }, [customerId])

  useEffect(() => {
    setIssued(null)
    void load()
  }, [load])

  useEffect(() => {
    if (!issued) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [issued])

  const issue = async () => {
    if (!customerId) return
    setBusy(true)
    try {
      const r = await createCustomerLineLinkCode(customerId)
      if (!r.success || !r.data) {
        showToast('สร้างลิงก์ไม่สำเร็จ', r.error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        return
      }
      const qr = r.data.oaUrl ? await QRCode.toDataURL(r.data.oaUrl, { margin: 1, width: 200 }).catch(() => null) : null
      setNow(Date.now())
      setIssued({ code: r.data.code, expiresAt: new Date(r.data.expires_at).getTime(), oaUrl: r.data.oaUrl, qr })
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setIssued(null)
    void load()
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('คัดลอกลิงก์แล้ว', what, 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  if (linkedName !== null && linkedName !== undefined) {
    return (
      <span
        className={`${BTN} border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 shadow-none`}
        data-testid="customer-line-linked"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        ผูก LINE แล้ว{linkedName ? ` · ${linkedName}` : ''}
      </span>
    )
  }

  const left = issued ? issued.expiresAt - now : 0
  return (
    <>
      <button
        type="button"
        disabled={!customerId || busy}
        onClick={() => void issue()}
        className={`${BTN} border-emerald-700 ${
          !customerId || busy ? 'opacity-40 cursor-not-allowed bg-emerald-700 text-white' : 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
        }`}
      >
        <MessageCircle className="w-3.5 h-3.5" />
        <span>สร้างลิงก์ผูก LINE</span>
      </button>
      <AppModal isOpen={Boolean(issued)} onClose={close} size="sm">
        <AppModalHeader title={`ลิงก์ผูก LINE · คุณ${customerName}`} icon={<MessageCircle />} onClose={close} />
        {issued && (
          <AppModalBody className="space-y-3 text-xs">
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL QR, nothing to optimise */}
            {issued.qr && <img src={issued.qr} alt={`QR ลิงก์ผูก LINE ของคุณ${customerName}`} className="w-44 h-44 mx-auto rounded-lg bg-white p-1" />}
            {issued.oaUrl ? (
              <>
                <p className="text-slate-600 dark:text-slate-300">
                  <b className="text-slate-800 dark:text-slate-100">อยู่ที่ร้าน</b> ให้สแกน QR นี้ · <b className="text-slate-800 dark:text-slate-100">อยู่ไกล</b> คัดลอกลิงก์ส่งไปทางแชตหรือช่องทางที่ติดต่อลูกค้าอยู่
                  เมื่อกดแล้ว LINE จะเปิดแชตร้านพร้อมรหัส กดส่งครั้งเดียวก็ผูกเสร็จ
                </p>
                <div className="flex gap-2">
                  <input readOnly value={issued.oaUrl} aria-label="ลิงก์ผูก LINE" className="flex-1 min-w-0 h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-[11px] text-slate-700 dark:text-slate-300" />
                  <ActionButton variant="outline" icon={<Copy />} onClick={() => void copy(issued.oaUrl as string, 'ส่งให้ลูกค้าทางช่องทางที่ติดต่อกันอยู่')}>
                    คัดลอกลิงก์
                  </ActionButton>
                </div>
              </>
            ) : (
              <p className="rounded-lg px-2.5 py-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200">
                ใส่ LINE ID ของร้านที่ ตั้งค่า › กิจการ ก่อน จึงจะมี QR และลิงก์ · ระหว่างนี้ให้ลูกค้าพิมพ์รหัส <span className="font-mono font-bold">{issued.code}</span> ในแชต LINE ร้าน
              </p>
            )}
            <p className={left > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-400'} aria-live="polite">
              {left > 0 ? (
                <>
                  รอกดลิงก์ ใช้ได้ครั้งเดียว หมดอายุใน <b className="tabular-nums" data-testid="customer-line-link-left">{leftText(left)}</b>
                </>
              ) : (
                'ลิงก์นี้หมดอายุแล้ว กดสร้างลิงก์ใหม่'
              )}
            </p>
            <ActionButton size="sm" variant="outline" icon={<RefreshCw />} disabled={busy} onClick={() => void issue()}>
              สร้างลิงก์ใหม่
            </ActionButton>
          </AppModalBody>
        )}
      </AppModal>
    </>
  )
}
