'use client'

import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Link2Off, MessageCircle } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useAskText } from '@/components/common/ConfirmDialogProvider'
import { createClient } from '@/lib/supabase/client'
import { createCustomerLineLinkCode, unlinkLineContact } from '@/app/actions/line'

/**
 * The customer's LINE link, inside the customer form. The LINE ID field is only a note; messages
 * reach a customer only after they send the shop's one-time code from their own LINE (1:1 chat).
 */

interface LinkedContact {
  id: string
  display_name: string | null
}
interface IssuedCode {
  code: string
  expiresAt: string
  qr: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BTN = 'h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50'

export function CustomerLineLink({ customerId, customerName }: { customerId?: string; customerName: string }) {
  const { showToast } = useToast()
  const askText = useAskText()
  const saved = UUID.test(customerId || '')
  const [contact, setContact] = useState<LinkedContact | null>(null)
  const [notReady, setNotReady] = useState(false)
  const [code, setCode] = useState<IssuedCode | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!saved) return
    const { data, error } = await createClient()
      .from('line_contacts')
      .select('id, display_name')
      .eq('customer_id', customerId as string)
      .eq('status', 'LINKED')
      .maybeSingle()
    setNotReady(Boolean(error))
    setContact((data as LinkedContact | null) ?? null)
  }, [saved, customerId])

  useEffect(() => {
    setCode(null)
    void load()
  }, [load])

  const issue = async () => {
    setBusy(true)
    try {
      const r = await createCustomerLineLinkCode(customerId as string)
      if (!r.success || !r.data) {
        showToast('สร้างรหัสไม่สำเร็จ', r.error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        return
      }
      const qr = r.data.oaUrl ? await QRCode.toDataURL(r.data.oaUrl, { margin: 1, width: 160 }).catch(() => null) : null
      setCode({ code: r.data.code, expiresAt: r.data.expires_at, qr })
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    if (!contact) return
    const reason = await askText({
      title: `ยกเลิกการเชื่อม LINE: ${customerName}`,
      message: 'ข้อความที่ยังไม่ส่งถึงลูกค้าจะถูกยกเลิก และต้องสร้างรหัสใหม่เพื่อเชื่อมอีกครั้ง',
      placeholder: 'เหตุผล เช่น ผูกผิดคน',
      confirmLabel: 'ยกเลิกการเชื่อม',
      danger: true,
    })
    if (!reason?.trim()) return
    setBusy(true)
    try {
      const r = await unlinkLineContact(contact.id, reason)
      if (!r.success) {
        showToast('ยกเลิกไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
        return
      }
      showToast('ยกเลิกการเชื่อมแล้ว', customerName, 'SUCCESS')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code.code)
      showToast('คัดลอกรหัสแล้ว', 'ให้ลูกค้าส่งรหัสนี้ในแชตกับ LINE ร้าน', 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  return (
    <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 space-y-1.5" data-testid="customer-line-link">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">เชื่อม LINE ร้าน (สำหรับส่งบิล/แจ้งเตือน)</span>
        {saved && !notReady && (
          <span
            className={`h-6 px-2 rounded-lg text-[11px] font-bold inline-flex items-center ${
              contact
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            }`}
          >
            {contact ? `เชื่อมแล้ว${contact.display_name ? ` · ${contact.display_name}` : ''}` : 'ยังไม่เชื่อม'}
          </span>
        )}
        <span className="ml-auto" />
        {saved && !notReady && contact && (
          <button type="button" disabled={busy} onClick={() => void unlink()} className={`${BTN} text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40`}>
            <Link2Off className="w-3.5 h-3.5" />
            ยกเลิกการเชื่อม
          </button>
        )}
        {saved && !notReady && !contact && !code && (
          <button type="button" disabled={busy} onClick={() => void issue()} className={`${BTN} bg-emerald-600 hover:bg-emerald-700 text-white`}>
            สร้างรหัสเชื่อม LINE
          </button>
        )}
      </div>
      {!saved && <p className="text-[11px] text-slate-500">บันทึกลูกค้าก่อน แล้วเปิดแก้ไขอีกครั้งเพื่อสร้างรหัสเชื่อม LINE</p>}
      {saved && notReady && <p className="text-[11px] text-amber-700 dark:text-amber-300">ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้</p>}
      {code && (
        <div className="flex flex-wrap items-center gap-3">
          {code.qr && <img src={code.qr} alt="QR สำหรับส่งรหัสเชื่อม LINE" className="w-28 h-28 rounded-lg bg-white p-1" />}
          <div className="space-y-1 text-[11px]">
            <p className="text-slate-600 dark:text-slate-300">
              {code.qr ? 'ให้ลูกค้าสแกน QR แล้วกดส่งข้อความในแชตกับร้าน' : 'ให้ลูกค้าส่งรหัสนี้ในแชต LINE กับร้าน'}
            </p>
            <p className="font-mono text-sm font-extrabold tracking-wider text-slate-900 dark:text-slate-100" data-testid="customer-line-code">
              {code.code}
            </p>
            <p className="text-slate-500">
              ใช้ได้ครั้งเดียว หมดอายุ {new Date(code.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
            </p>
            <button type="button" onClick={() => void copy()} className={`${BTN} border border-slate-300 dark:border-slate-700`}>
              <Copy className="w-3 h-3" />
              คัดลอกรหัส
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
