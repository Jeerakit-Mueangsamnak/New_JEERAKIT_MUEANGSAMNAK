'use client'

import { useState } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Copy, Send, ShieldAlert } from 'lucide-react'
import { ActionButton } from '@/components/common/ActionButton'
import { AppModal, AppModalBody, AppModalHeader } from '@/components/common/AppModal'
import { useToast } from '@/components/common/Toast'
import { confirmLineContactReview, createLineInviteLink, type LineInviteResult } from '@/app/actions/line'
import { SETTINGS_HELPER, SETTINGS_INPUT_MONO, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { type LineInviteKind } from '@/lib/line/config'

/**
 * Settings › LINE: one invite flow for staff, drivers and customers. The link opens the LIFF
 * page in the person's own LINE (name / phone / LINE ID typed there); the code also works
 * typed in the OA chat when LIFF is not set up yet.
 */

const KIND_LABEL: Record<LineInviteKind, string> = { STAFF: 'พนักงาน', DRIVER: 'คนขับ', CUSTOMER: 'ลูกค้า' }

export function LineInviteButton({ kind, target, name, disabled }: { kind: LineInviteKind; target: string; name: string; disabled?: boolean }) {
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState<(LineInviteResult & { qr: string | null }) | null>(null)

  const open = async () => {
    setBusy(true)
    try {
      const r = await createLineInviteLink(kind, target)
      if (!r.success || !r.data) {
        showToast('สร้างลิงก์ไม่สำเร็จ', r.error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        return
      }
      const link = r.data.url ?? r.data.oaUrl
      const qr = link ? await QRCode.toDataURL(link, { margin: 1, width: 200 }).catch(() => null) : null
      setInvite({ ...r.data, qr })
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('คัดลอกแล้ว', what, 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  return (
    <>
      <ActionButton size="sm" variant="primary" icon={<Send />} disabled={disabled || busy} onClick={() => void open()}>
        ส่งลิงก์ผูก LINE
      </ActionButton>
      <AppModal isOpen={Boolean(invite)} onClose={() => setInvite(null)} size="sm">
        <AppModalHeader title={`ลิงก์ผูก LINE · ${KIND_LABEL[kind]} ${name}`} icon={<Send />} onClose={() => setInvite(null)} />
        {invite && (
          <AppModalBody className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL QR, nothing to optimise */}
            {invite.qr && <img src={invite.qr} alt="QR ลิงก์ผูก LINE" className="w-44 h-44 mx-auto rounded-lg bg-white p-1" />}
            {invite.url ? (
              <>
                <div>
                  <label className={SETTINGS_LABEL}>ลิงก์ (ส่งเข้า LINE ส่วนตัวของ{KIND_LABEL[kind]})</label>
                  <div className="flex gap-2">
                    <input readOnly value={invite.url} className={SETTINGS_INPUT_MONO} />
                    <ActionButton variant="outline" icon={<Copy />} onClick={() => void copy(invite.url!, 'ส่งลิงก์นี้ให้ทาง LINE')}>
                      คัดลอก
                    </ActionButton>
                  </div>
                </div>
                {invite.shareUrl && (
                  <a
                    href={invite.shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full h-9 rounded-xl bg-[#06C755] hover:brightness-95 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5"
                  >
                    <Send className="w-4 h-4" /> แชร์ไปที่ LINE
                  </a>
                )}
                <p className={SETTINGS_HELPER}>ผู้รับกดลิงก์ในแอป LINE → กรอกชื่อ{kind === 'CUSTOMER' ? ' เบอร์โทร' : ''} และไอดีไลน์ → ระบบผูกให้อัตโนมัติ</p>
              </>
            ) : (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                ยังไม่ได้ตั้งค่า LIFF (NEXT_PUBLIC_LIFF_ID) จึงใช้ได้เฉพาะรหัส: ให้ผู้รับพิมพ์รหัสด้านล่างในแชตกับ LINE ร้าน
              </p>
            )}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
              <span>
                <span className={SETTINGS_HELPER}>รหัส (พิมพ์ในแชต LINE ร้านแทนการกดลิงก์ได้)</span>
                <span className="block font-mono font-extrabold tracking-wider text-slate-900 dark:text-slate-100" data-testid="line-invite-code">
                  {invite.code}
                </span>
              </span>
              <ActionButton size="sm" variant="ghost" icon={<Copy />} onClick={() => void copy(invite.code, 'ส่งรหัสนี้ในแชต LINE ร้าน')} aria-label="คัดลอกรหัส" />
            </div>
            <p className={SETTINGS_HELPER}>
              ใช้ได้ครั้งเดียว · หมดอายุ{' '}
              {new Date(invite.expires_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} น.
            </p>
          </AppModalBody>
        )}
      </AppModal>
    </>
  )
}

/** What the person typed on the invite page, and the "checked" button when it did not match. */
export interface LineReviewContact {
  id: string
  display_name: string | null
  typed_name: string | null
  typed_phone: string | null
  line_handle: string | null
  needs_review: boolean
}

export function LineContactInfo({ contact, onChanged }: { contact: LineReviewContact; onChanged: () => void }) {
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const typed = [contact.typed_name, contact.typed_phone, contact.line_handle && `ID ${contact.line_handle}`].filter(Boolean).join(' · ')

  const confirm = async () => {
    setBusy(true)
    try {
      const r = await confirmLineContactReview(contact.id)
      if (!r.success) {
        showToast('บันทึกไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
        return
      }
      showToast('ยืนยันแล้ว', contact.typed_name || contact.display_name || '', 'SUCCESS')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {typed && <span className={SETTINGS_HELPER}>กรอก: {typed}</span>}
      {contact.needs_review ? (
        <>
          <span className="inline-flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <ShieldAlert className="w-3.5 h-3.5" /> ข้อมูลไม่ตรง ให้ตรวจ
          </span>
          <ActionButton size="sm" variant="outline" icon={<CheckCircle2 />} disabled={busy} onClick={() => void confirm()}>
            ตรวจแล้ว ถูกคน
          </ActionButton>
        </>
      ) : null}
    </span>
  )
}
