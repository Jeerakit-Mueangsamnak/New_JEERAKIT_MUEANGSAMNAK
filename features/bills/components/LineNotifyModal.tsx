'use client'
import {
  COMMAND_BUTTON_SIZE_CLASSES,
  TAB_BAR_SURFACE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'

import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Clock, Copy, CreditCard, Link2, MessageSquare, Send, ShieldCheck, Sparkles, WalletCards } from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { CustomerLineLinkDialog } from '@/features/customers/components/CustomerLineLinkButton'
import { getBillLineRecipient, sendBillViaLine, type BillLineRecipient } from '@/app/actions/line'

/** ข้อความ = plain text; Flex Card = the bill as a card (title, the note, the bill's rows). */
export type LineMessageMode = 'TEXT' | 'FLEX'
export type LineTextPreset = 'UPCOMING' | 'OVERDUE' | 'OUTSTANDING' | 'SUMMARY' | 'CUSTOM'

/** Text of each preset, from the stored bill numbers only (nothing is recalculated here). */
export function buildBillTextMessage(data: LineNotifyBillData, preset: LineTextPreset): string {
  const baht = (n: number) => `${n.toLocaleString('th-TH')}`
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
  const money = (n: number) => `${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
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

const CARD_TITLE: Record<LineTextPreset, string> = {
  UPCOMING: 'แจ้งเตือนใกล้ครบกำหนดคืน',
  OVERDUE: 'เลยกำหนดคืนสินค้า',
  OUTSTANDING: 'แจ้งยอดค้างชำระ',
  SUMMARY: 'สรุปบิลเช่า',
  CUSTOM: 'ข้อความจากร้าน',
}
const CARD_NOTE: Record<LineTextPreset, string> = {
  UPCOMING: 'กรุณาเตรียมสินค้าเพื่อส่งคืนตามกำหนด',
  OVERDUE: 'กรุณาติดต่อร้านเพื่อนัดคืนสินค้า',
  OUTSTANDING: 'กรุณาชำระยอดค้างหรือติดต่อร้าน',
  SUMMARY: '',
  CUSTOM: '',
}

/** Flex Card of a preset: title + rows from the stored bill numbers (nothing is recalculated here). */
export function buildBillCard(data: LineNotifyBillData, preset: LineTextPreset) {
  const money = (n: number) => `${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`
  const rows = [
    { label: 'เลขที่บิล', value: data.billNo },
    { label: 'ลูกค้า', value: data.customerName },
    { label: 'สถานะ', value: getThaiBillStatus(data.rentalStatus) },
    { label: 'กำหนดคืน', value: data.returnDate || '' },
    { label: 'ยอดรวม', value: money(data.grandTotal) },
    { label: 'ยอดค้าง', value: money(data.outstandingAmount) },
  ].filter((r) => r.value !== '')
  return { title: CARD_TITLE[preset], note: CARD_NOTE[preset], rows }
}

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
  { type: 'UPCOMING', label: 'เตือนวันคืน', description: 'แจ้งก่อนครบกำหนด', icon: <Clock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />, activeClass: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200' },
  { type: 'OVERDUE', label: 'เกินกำหนด', description: 'ติดตามการส่งคืน', icon: <AlertTriangle className="w-3.5 h-3.5 text-red-700 dark:text-red-400" />, activeClass: 'border-red-500 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200' },
  { type: 'OUTSTANDING', label: 'ยอดค้าง', description: 'แจ้งยอดค้างชำระ', icon: <CreditCard className="w-3.5 h-3.5 text-orange-700 dark:text-orange-400" />, activeClass: 'border-orange-500 bg-orange-50 dark:bg-orange-950/60 text-orange-800 dark:text-orange-200' },
  { type: 'SUMMARY', label: 'สรุปบิล', description: 'สรุปข้อมูลบิลเช่า', icon: <ShieldCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />, activeClass: 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200' },
  { type: 'CUSTOM', label: 'ปรับแต่งเอง', description: 'พิมพ์ข้อความอิสระ', icon: <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />, activeClass: 'border-purple-500 bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200' },
]

export function LineNotifyModal({ isOpen, onClose, billData }: LineNotifyModalProps) {
  const { showToast } = useToast()
  const [presetType, setPresetType] = useState<LineTextPreset>('UPCOMING')
  const [mode, setMode] = useState<LineMessageMode>('TEXT')
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [recipient, setRecipient] = useState<BillLineRecipient | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const confirm = useConfirm()

  // Who the bill goes to on LINE (no notice box any more, owner 2026-11-11: ส่งทาง LINE is simply
  // off until the customer is linked). Read again after the link window closes: the customer may
  // have linked in the meantime.
  const billId = billData?.id
  const [recipientRound, setRecipientRound] = useState(0)
  useEffect(() => {
    if (!isOpen || !billId) return
    let alive = true
    getBillLineRecipient(billId)
      .then((r) => alive && setRecipient(r.success && r.data ? r.data : null))
      .catch(() => alive && setRecipient(null))
    return () => { alive = false }
  }, [isOpen, billId, recipientRound])
  const closeLink = useCallback(() => {
    setLinkOpen(false)
    setRecipientRound((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!billData) return
    setMessage(mode === 'FLEX' ? buildBillCard(billData, presetType).note : buildBillTextMessage(billData, presetType))
  }, [billData, presetType, mode])

  if (!isOpen || !billData) return null

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    showToast('คัดลอกข้อความสำเร็จ', 'คัดลอกข้อความ LINE เรียบร้อยแล้ว', 'SUCCESS')
    setTimeout(() => setCopied(false), 2000)
  }

  const canSend = recipient?.state === 'LINKED'
  // สร้างลิงก์ LINE: only for a bill with a customer who is not linked yet
  const canLink = Boolean(recipient?.customer_id) && recipient?.state !== 'LINKED'
  const startLink = async () => {
    if (!canLink) return
    const ok = await confirm({
      title: 'สร้างลิงก์ผูก LINE',
      message: `สร้างลิงก์ผูก LINE ให้คุณ${billData.customerName} ใช่ไหม`,
      confirmLabel: 'สร้างลิงก์',
      cancelLabel: 'ยกเลิก',
    })
    if (ok) setLinkOpen(true)
  }
  const outgoingText = message
  const card = buildBillCard(billData, presetType)
  // Copy-to-send-yourself: a card cannot be pasted, so its content goes out as text
  const copyableText =
    mode === 'FLEX' ? [card.title, message, ...card.rows.map((r) => `${r.label}: ${r.value}`)].filter(Boolean).join('\n') : outgoingText

  const handleSendLine = async () => {
    if (mode === 'TEXT' && !outgoingText.trim()) {
      showToast('ยังส่งไม่ได้', 'กรุณาระบุข้อความก่อนส่ง', 'ERROR')
      return
    }
    if (!canSend) return
    setSending(true)
    try {
      const r = await sendBillViaLine({
        billId: billData.id,
        text: outgoingText,
        idempotencyKey: newKey(),
        ...(mode === 'FLEX' ? { card: { title: card.title, rows: card.rows } } : {}),
      })
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
      <AppModalHeader onClose={onClose} icon={<MessageSquare className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />}>
        <div>
          <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <span>ส่งบิลทาง LINE ถึงลูกค้า</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold text-[10px]">LINE OA</span>
          </h3>
        </div>
      </AppModalHeader>

      <AppModalBody className="space-y-4">
        {/* Tab bar (owner 2026-11-11): [ข้อความ] [Flex Card] [สร้างลิงก์ LINE]; the last one opens the link window after a confirm */}
        <div role="tablist" aria-label="รูปแบบการส่ง" className={`${TAB_BAR_SURFACE_CLASSES} grid grid-cols-3`}>
          {([
            { id: 'TEXT' as const, label: 'ข้อความ', icon: <MessageSquare /> },
            { id: 'FLEX' as const, label: 'Flex Card', icon: <WalletCards /> },
          ]).map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={mode === b.id}
              onClick={() => setMode(b.id)}
              className={`${TAB_BUTTON_BASE_CLASSES} min-w-0 [&_svg]:w-3.5 [&_svg]:h-3.5 ${mode === b.id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
            >
              {b.icon}
              <span className="truncate">{b.label}</span>
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={false}
            disabled={!canLink}
            title={recipient?.state === 'LINKED' ? 'ลูกค้าผูก LINE แล้ว' : recipient?.customer_id ? undefined : 'บิลนี้ไม่มีข้อมูลลูกค้า'}
            onClick={() => void startLink()}
            className={`${TAB_BUTTON_BASE_CLASSES} min-w-0 [&_svg]:w-3.5 [&_svg]:h-3.5 ${TAB_BUTTON_INACTIVE_CLASSES} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Link2 />
            <span className="truncate">สร้างลิงก์ LINE</span>
          </button>
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
                <label className="font-bold text-slate-700 dark:text-slate-300">{mode === 'FLEX' ? 'ข้อความใต้หัวการ์ด (ไม่ใส่ก็ได้)' : 'ข้อความที่จะส่ง'}</label>
                <button type="button" onClick={handleCopy} className={`${COMMAND_BUTTON_SIZE_CLASSES} text-blue-600 dark:text-blue-400 hover:underline flex items-center`}>
                  <Copy className="w-3 h-3" /><span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ'}</span>
                </button>
              </div>
              <textarea rows={7} maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} className="w-full p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-inner" />
              <p className="text-right text-[10px] text-slate-600 dark:text-slate-400">{message.length}/5000</p>
            </div>
            {mode === 'FLEX' && (
              <div className="space-y-1.5">
                <span className="font-bold text-slate-700 dark:text-slate-300 block text-[11px]">ตัวอย่างการ์ดที่ลูกค้าจะเห็น</span>
                <div aria-label="ตัวอย่าง Flex Card" className="max-w-xs rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-sm space-y-1.5">
                  <p className="font-bold text-sm text-slate-900 dark:text-slate-100">{card.title}</p>
                  {message.trim() && <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{message}</p>}
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-1.5 space-y-0.5">
                    {card.rows.map((r) => (
                      <div key={r.label} className="flex gap-2 text-xs">
                        <span className="w-16 shrink-0 text-slate-500 dark:text-slate-400">{r.label}</span>
                        <span className="text-slate-900 dark:text-slate-100">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
        </>
      </AppModalBody>

      <AppModalFooter>
        <button type="button" onClick={onClose} className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`}>ยกเลิก</button>
        <button type="button" onClick={() => copyText(copyableText, 'นำไปวางในแชต LINE ของลูกค้าได้เลย')} className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950 flex items-center`}>
          <Copy className="w-4 h-4" />คัดลอกไปส่งเอง
        </button>
        <button type="button" onClick={handleSendLine} disabled={sending || !canSend || (mode === 'TEXT' && !outgoingText.trim())} title={canSend ? undefined : 'ลูกค้ายังไม่ได้ผูก LINE กับร้าน'} className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white shadow-lg shadow-emerald-500/30 flex items-center transition-all`}>
          {sending ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />กำลังส่ง...</> : <><Send className="w-4 h-4" />ส่งทาง LINE</>}
        </button>
      </AppModalFooter>
      <CustomerLineLinkDialog
        customerId={recipient?.customer_id || undefined}
        customerName={billData.customerName}
        open={linkOpen}
        onClose={closeLink}
      />
    </AppModal>
  )
}
