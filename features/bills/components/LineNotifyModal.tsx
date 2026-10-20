'use client'

import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { AlertTriangle, Clock, Copy, CreditCard, Link2, MessageSquare, Send, ShieldCheck, Sparkles, WalletCards } from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { useToast } from '@/components/common/Toast'
import { createCustomerLineLinkCode, getBillLineRecipient, sendBillViaLine, type BillLineRecipient } from '@/app/actions/line'

/** FLEX stays off until the bill send can carry a Flex Message (the database accepts text only). */
export type LineMessageMode = 'TEXT' | 'FLEX'
export type LineTextPreset = 'UPCOMING' | 'OVERDUE' | 'OUTSTANDING' | 'SUMMARY' | 'CUSTOM'

/** Text of each preset, from the stored bill numbers only (nothing is recalculated here). */
export function buildBillTextMessage(data: LineNotifyBillData, preset: LineTextPreset): string {
  const baht = (n: number) => `฿${n.toLocaleString('th-TH')}`
  const hello = `เรียน คุณ ${data.customerName}`
  const due = data.returnDate ? `กำหนดคืน: ${data.returnDate}` : null
  const lines: Array<string | null> =
    preset === 'UPCOMING'
      ? [hello, `แจ้งเตือนใกล้ครบกำหนดคืนสินค้าเช่า บิลเลขที่ ${data.billNo}`, due, 'กรุณาเตรียมสินค้าเพื่อส่งคืนตามกำหนด']
      : preset === 'OVERDUE'
        ? [hello, `บิลเลขที่ ${data.billNo} เลยกำหนดคืนสินค้าแล้ว`, due, 'กรุณาติดต่อร้านเพื่อนัดคืนสินค้า']
        : preset === 'OUTSTANDING'
          ? [hello, `แจ้งยอดค้างชำระ บิลเลขที่ ${data.billNo}`, `ยอดสุทธิ: ${baht(data.grandTotal)}`, `ยอดค้าง: ${baht(data.outstandingAmount)}`, 'กรุณาชำระยอดค้างหรือติดต่อร้าน']
          : preset === 'SUMMARY'
            ? [buildBillSummaryText(data)]
            : [hello, `เรื่อง บิลเลขที่ ${data.billNo}`, '']
  return lines.filter((l): l is string => l !== null).join('\n')
}

/** "สรุปบิล" preset: the stored bill numbers as plain text. */
export function buildBillSummaryText(data: LineNotifyBillData) {
  const money = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
  return [
    'สรุปบิลเช่า',
    `ลูกค้า: ${data.customerName}`,
    `เลขที่บิล: ${data.billNo}`,
    `สถานะ: ${getThaiBillStatus(data.rentalStatus)}`,
    data.returnDate ? `วันครบกำหนด: ${data.returnDate}` : null,
    `ยอดรวม: ${money(data.grandTotal)}`,
    `ยอดค้าง: ${money(data.outstandingAmount)}`,
  ].filter(Boolean).join('\n')
}

type LinkCode = { code: string; expiresAt: string; oaUrl: string | null; qr: string | null }

const newKey = () => `bill-${crypto.randomUUID()}`

function getThaiBillStatus(status: string) {
  switch (status) {
    case 'RENTING': return 'กำลังเช่า'
    case 'RETURNED': return 'คืนครบแล้ว'
    case 'PARTIAL_RETURNED': return 'คืนบางส่วน'
    case 'CLOSED': return 'ปิดบิลแล้ว'
    case 'CANCELLED': return 'ยกเลิก'
    case 'OVERDUE': return 'เกินกำหนด'
    default: return status || '-'
  }
}

export interface LineNotifyBillData {
  id: string
  billNo: string
  customerName: string
  customerPhone?: string
  returnDate: string
  grandTotal: number
  outstandingAmount: number
  rentalStatus: string
  items?: string[]
}

interface LineNotifyModalProps {
  isOpen: boolean
  onClose: () => void
  billData: LineNotifyBillData | null
}

const presets: Array<{
  type: LineTextPreset
  label: string
  description: string
  icon: React.ReactNode
  activeClass: string
}> = [
  { type: 'UPCOMING', label: 'เตือนวันคืน', description: 'แจ้งก่อนครบกำหนด', icon: <Clock className="w-3.5 h-3.5 text-amber-500" />, activeClass: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200' },
  { type: 'OVERDUE', label: 'เกินกำหนด', description: 'ติดตามการส่งคืน', icon: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />, activeClass: 'border-red-500 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200' },
  { type: 'OUTSTANDING', label: 'ยอดค้าง', description: 'แจ้งยอดค้างชำระ', icon: <CreditCard className="w-3.5 h-3.5 text-orange-500" />, activeClass: 'border-orange-500 bg-orange-50 dark:bg-orange-950/60 text-orange-800 dark:text-orange-200' },
  { type: 'SUMMARY', label: 'สรุปบิล', description: 'สรุปข้อมูลบิลเช่า', icon: <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />, activeClass: 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200' },
  { type: 'CUSTOM', label: 'ปรับแต่งเอง', description: 'พิมพ์ข้อความอิสระ', icon: <Sparkles className="w-3.5 h-3.5 text-purple-500" />, activeClass: 'border-purple-500 bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200' },
]

export function LineNotifyModal({ isOpen, onClose, billData }: LineNotifyModalProps) {
  const { showToast } = useToast()
  const [presetType, setPresetType] = useState<LineTextPreset>('UPCOMING')
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [recipient, setRecipient] = useState<BillLineRecipient | null>(null)
  const [recipientError, setRecipientError] = useState<string | null>(null)
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null)
  const [creatingCode, setCreatingCode] = useState(false)

  const billId = billData?.id
  useEffect(() => {
    if (!isOpen || !billId) return
    let alive = true
    setRecipient(null)
    setRecipientError(null)
    setLinkCode(null)
    getBillLineRecipient(billId).then((r) => {
      if (!alive) return
      if (r.success && r.data) setRecipient(r.data)
      else setRecipientError(r.error || 'ตรวจสอบ LINE ของลูกค้าไม่สำเร็จ')
    }).catch(() => alive && setRecipientError('ตรวจสอบ LINE ของลูกค้าไม่สำเร็จ'))
    return () => { alive = false }
  }, [isOpen, billId])

  useEffect(() => {
    if (!billData) return
    setMessage(buildBillTextMessage(billData, presetType))
  }, [billData, presetType])

  if (!isOpen || !billData) return null

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    showToast('คัดลอกข้อความสำเร็จ', 'คัดลอกข้อความ LINE เรียบร้อยแล้ว', 'SUCCESS')
    setTimeout(() => setCopied(false), 2000)
  }

  const canSend = recipient?.state === 'LINKED'
  const outgoingText = message

  const handleSendLine = async () => {
    if (!outgoingText.trim()) {
      showToast('ยังส่งไม่ได้', 'กรุณาระบุข้อความก่อนส่ง', 'ERROR')
      return
    }
    if (!canSend) return
    setSending(true)
    try {
      const r = await sendBillViaLine({ billId: billData.id, text: outgoingText, idempotencyKey: newKey() })
      if (!r.success || !r.data) {
        showToast('ส่งทาง LINE ไม่สำเร็จ', r.error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        return
      }
      // Test mode never reaches the customer, so it must not read like a real send
      if (r.data.mode !== 'live') showToast('โหมดทดสอบ: ยังไม่ได้ส่งถึงลูกค้า', 'ระบบบันทึกข้อความไว้ แต่ไม่ได้ส่งออกไปที่ LINE จริง', 'INFO')
      else if (r.data.status === 'SENT') showToast('ส่งบิลทาง LINE แล้ว', `ส่งถึง ${billData.customerName} แล้ว`, 'SUCCESS')
      else if (r.data.status === 'DEAD') showToast('ส่งทาง LINE ไม่สำเร็จ', 'ระบบส่งไม่ถึงลูกค้า ดูรายละเอียดที่หน้า LINE', 'ERROR')
      else showToast('ยังส่งไม่ถึงลูกค้า', 'ข้อความรออยู่ในคิว ระบบจะลองส่งอีกครั้งเมื่อมีการส่ง LINE ครั้งถัดไป', 'INFO')
      onClose()
    } catch {
      showToast('ส่งทาง LINE ไม่สำเร็จ', 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
    } finally {
      setSending(false)
    }
  }

  const handleCreateCode = async () => {
    if (!recipient?.customer_id) return
    setCreatingCode(true)
    try {
      const r = await createCustomerLineLinkCode(recipient.customer_id)
      if (!r.success || !r.data) {
        showToast('สร้างรหัสผูก LINE ไม่สำเร็จ', r.error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        return
      }
      const qr = r.data.oaUrl ? await QRCode.toDataURL(r.data.oaUrl, { margin: 1, width: 180 }).catch(() => null) : null
      setLinkCode({ code: r.data.code, expiresAt: r.data.expires_at, oaUrl: r.data.oaUrl, qr })
    } finally {
      setCreatingCode(false)
    }
  }

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('คัดลอกแล้ว', what, 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  return (
    <AppModal isOpen={isOpen} onClose={onClose} size="lg">
      <AppModalHeader onClose={onClose} icon={<MessageSquare className="w-5 h-5 text-emerald-500" />}>
        <div>
          <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <span>ส่งบิลทาง LINE ถึงลูกค้า</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold text-[10px]">LINE OA</span>
          </h3>
          <p className="text-[11px] text-slate-500">ส่งข้อความติดตามหรือสรุปบิลให้ {billData.customerName}</p>
        </div>
      </AppModalHeader>

      <AppModalBody className="space-y-4">
        <RecipientPanel
          recipient={recipient}
          error={recipientError}
          linkCode={linkCode}
          creatingCode={creatingCode}
          onCreateCode={handleCreateCode}
          onCopy={copyText}
        />

        <div className="space-y-1.5">
          <label className="font-bold text-slate-700 dark:text-slate-300 block text-[11px]">รูปแบบการส่ง</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed="true" className="p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
              <MessageSquare className="w-4 h-4" /> ข้อความ
            </button>
            <button type="button" disabled title="ระบบยังส่ง Flex Message ไม่ได้ ใช้ข้อความหรือข้อความสำเร็จรูป &quot;สรุปบิล&quot; แทน" className="p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-60">
              <WalletCards className="w-4 h-4" /> Flex Card (ยังไม่รองรับ)
            </button>
          </div>
        </div>

        <>
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 dark:text-slate-300 block text-[11px]">ข้อความสำเร็จรูป</label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {presets.map((preset) => (
                  <button key={preset.type} type="button" onClick={() => setPresetType(preset.type)} className={`p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all ${presetType === preset.type ? `${preset.activeClass} font-bold shadow-sm` : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
                    <span className="flex items-center gap-1 text-[11px]">{preset.icon}{preset.label}</span>
                    <span className="text-[10px] opacity-75">{preset.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="font-bold text-slate-700 dark:text-slate-300">ข้อความที่จะส่ง</label>
                <button type="button" onClick={handleCopy} className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                  <Copy className="w-3 h-3" /><span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ'}</span>
                </button>
              </div>
              <textarea rows={7} maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} className="w-full p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-inner" />
              <p className="text-right text-[10px] text-slate-400">{message.length}/5000</p>
            </div>
        </>
      </AppModalBody>

      <AppModalFooter>
        <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">ยกเลิก</button>
        <button type="button" onClick={() => copyText(outgoingText, 'นำไปวางในแชต LINE ของลูกค้าได้เลย')} className="px-4 py-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800 font-semibold text-xs text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950 flex items-center gap-1.5">
          <Copy className="w-4 h-4" />คัดลอกไปส่งเอง
        </button>
        <button type="button" onClick={handleSendLine} disabled={sending || !canSend || !outgoingText.trim()} title={canSend ? undefined : 'ลูกค้ายังไม่ได้ผูก LINE กับร้าน'} className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-xs shadow-lg shadow-emerald-500/30 flex items-center gap-2 transition-all">
          {sending ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />กำลังส่ง...</> : <><Send className="w-4 h-4" />ส่งทาง LINE</>}
        </button>
      </AppModalFooter>
    </AppModal>
  )
}

function RecipientPanel({ recipient, error, linkCode, creatingCode, onCreateCode, onCopy }: {
  recipient: BillLineRecipient | null
  error: string | null
  linkCode: LinkCode | null
  creatingCode: boolean
  onCreateCode: () => void
  onCopy: (text: string, what: string) => void
}) {
  if (error) return <p role="status" className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300">{error} ใช้ปุ่ม &quot;คัดลอกไปส่งเอง&quot; แทนได้</p>
  if (!recipient) return <p role="status" className="text-[11px] text-slate-400">กำลังตรวจสอบ LINE ของลูกค้า...</p>
  if (recipient.state === 'LINKED') {
    return <p role="status" className="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 px-3 py-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">ลูกค้าผูก LINE กับร้านแล้ว{recipient.display_name ? ` (${recipient.display_name})` : ''} กด &quot;ส่งทาง LINE&quot; ได้เลย</p>
  }
  if (recipient.state === 'NO_CUSTOMER') return <p role="status" className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300">บิลนี้ไม่มีข้อมูลลูกค้า จึงส่งทาง LINE ไม่ได้</p>
  if (recipient.state === 'UNREACHABLE') return <p role="status" className="rounded-xl bg-amber-50 dark:bg-amber-950/60 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">ลูกค้าบล็อกหรือลบ LINE ร้านแล้ว ให้ลูกค้าเพิ่มเพื่อน LINE ร้านอีกครั้ง</p>
  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-2 text-[11px]">
      <p role="status" className="font-bold text-amber-800 dark:text-amber-200">ลูกค้ายังไม่ได้ผูก LINE กับร้าน</p>
      {!linkCode ? (
        <>
          <p className="text-slate-600 dark:text-slate-300">สร้างรหัสให้ลูกค้า แล้วให้ลูกค้าเพิ่มเพื่อน LINE ร้านและส่งรหัสนี้ในแชตกับร้าน (แชตส่วนตัว ไม่ใช่กลุ่ม)</p>
          <button type="button" onClick={onCreateCode} disabled={creatingCode} className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" />{creatingCode ? 'กำลังสร้าง...' : 'สร้างรหัสผูก LINE'}
          </button>
        </>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3 items-start">
          {linkCode.qr && <img src={linkCode.qr} alt="QR สำหรับส่งรหัสผูก LINE" className="w-36 h-36 rounded-lg bg-white p-1" />}
          <div className="space-y-1.5">
            <p className="text-slate-600 dark:text-slate-300">{linkCode.qr ? 'ให้ลูกค้าสแกน QR นี้ แล้วกดส่งข้อความในแชตกับร้าน' : 'ให้ลูกค้าส่งรหัสนี้ในแชต LINE กับร้าน'}</p>
            <p className="font-mono text-base font-extrabold tracking-wider text-slate-900 dark:text-slate-100" data-testid="line-link-code">{linkCode.code}</p>
            <p className="text-slate-500">ใช้ได้ครั้งเดียว หมดอายุ {new Date(linkCode.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => onCopy(linkCode.code, 'คัดลอกรหัสแล้ว')} className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-bold flex items-center gap-1"><Copy className="w-3 h-3" />คัดลอกรหัส</button>
              {linkCode.oaUrl && <button type="button" onClick={() => onCopy(linkCode.oaUrl as string, 'ส่งลิงก์นี้ให้ลูกค้ากดได้เลย')} className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-bold flex items-center gap-1"><Link2 className="w-3 h-3" />คัดลอกลิงก์</button>}
            </div>
            {!linkCode.oaUrl && <p className="text-slate-500">ใส่ LINE ID ของร้านที่ ตั้งค่า › กิจการ เพื่อให้มี QR และลิงก์</p>}
            <p className="text-slate-500">เมื่อลูกค้าส่งรหัสแล้ว ปิดหน้านี้แล้วเปิดใหม่เพื่อส่งบิล</p>
          </div>
        </div>
      )}
    </div>
  )
}
