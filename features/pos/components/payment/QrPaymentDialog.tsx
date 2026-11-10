'use client'

import React, { useEffect, useState } from 'react'
import Image from 'next/image'
import QRCode from 'qrcode'
import { CheckCircle2, QrCode } from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { NumericInput } from '@/components/common/NumericInput'
import { promptPayPayload } from '@/lib/promptpay'

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 })

interface QrPaymentDialogProps {
  isOpen: boolean
  onClose: () => void
  /** What is still to be paid now. */
  amount: number
  /** QR first: the customer may transfer only part; the rest is then taken in cash. */
  editable?: boolean
  promptPayId?: string
  bankQrUrl?: string
  /** "ได้รับเงินแล้ว" with the amount transferred; records nothing by itself. */
  onConfirm: (amount: number) => void
}

/** QR Code in the middle of the screen with the amount to pay (owner 2026-11-05). */
export function QrPaymentDialog({ isOpen, onClose, amount, editable = false, promptPayId, bankQrUrl, onConfirm }: QrPaymentDialogProps) {
  const [input, setInput] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [lastOpen, setLastOpen] = useState(false)
  if (isOpen !== lastOpen) {
    setLastOpen(isOpen)
    if (isOpen) setInput('')
  }
  const typed = input === '' ? amount : Math.max(0, parseFloat(input) || 0)
  const payAmount = editable ? Math.min(typed, amount) : amount
  const payload = promptPayId ? promptPayPayload(promptPayId, payAmount) : null

  useEffect(() => {
    let cancelled = false
    if (!isOpen || !payload) {
      setQrDataUrl('')
      return
    }
    QRCode.toDataURL(payload, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, payload])

  const image = qrDataUrl || bankQrUrl || ''
  const rest = Math.round((amount - payAmount) * 100) / 100

  return (
    <AppModal isOpen={isOpen} onClose={onClose} size="sm">
      <AppModalHeader onClose={onClose} icon={<QrCode className="w-5 h-5 text-purple-700 dark:text-purple-400" />}>
        <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">สแกนจ่ายด้วย QR Code</h3>
      </AppModalHeader>

      <AppModalBody className="flex flex-col items-center gap-3 text-center">
        <div>
          <p className="text-xs font-bold text-slate-600 dark:text-slate-400">ยอดที่ต้องจ่าย</p>
          <p className="text-3xl font-black tabular-nums text-slate-900 dark:text-slate-100">{baht(payAmount)} บาท</p>
        </div>

        <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700">
          {image ? (
            <Image src={image} alt="QR Code รับเงิน" width={220} height={220} unoptimized className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
              <QrCode className="w-8 h-8 text-slate-300" />
              <span>ยังไม่ได้ตั้งค่า QR รับเงิน</span>
              <span>ตั้งได้ที่ ตั้งค่าระบบ › ข้อมูลร้าน</span>
            </div>
          )}
        </div>
        <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
          {qrDataUrl ? `PromptPay: ${promptPayId}` : bankQrUrl ? 'QR Code รับเงินของร้าน (ลูกค้ากรอกยอดเอง)' : ''}
        </p>

        {editable && (
          <div className="w-full text-left">
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-0.5">ยอดที่ลูกค้าโอน (บาท)</label>
            <NumericInput
              value={input}
              onChange={(val) => setInput(val === '' ? '' : String(val))}
              min={0}
              placeholder={amount.toString()}
              aria-label="ยอดที่ลูกค้าโอน"
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-base font-extrabold text-slate-900 focus:ring-2 focus:ring-purple-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 tabular-nums"
            />
            {rest > 0 && <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">ส่วนที่เหลือ {baht(rest)} บาท รับต่อด้วยเงินสด</p>}
          </div>
        )}
      </AppModalBody>

      <AppModalFooter>
        <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
          ปิด
        </button>
        <button
          type="button"
          onClick={() => onConfirm(payAmount)}
          disabled={payAmount <= 0}
          className="px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-xs shadow-lg shadow-emerald-500/30 flex items-center gap-2 transition-all"
        >
          <CheckCircle2 className="w-4 h-4" />
          ได้รับเงินแล้ว
        </button>
      </AppModalFooter>
    </AppModal>
  )
}
