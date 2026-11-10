'use client'

import { useState } from 'react'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { toSatang } from '@/lib/money'

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * "ยืนยัน" next to เงินสดที่รับมา: shows the typed cash again in a centre pop-up (ถูกต้อง / แก้ไข).
 * Records nothing. Only a typed amount needs it — an empty box means the exact amount — unless
 * `required` (a cash step of เงินสด + QR Code, where ยืนยัน moves the payment on).
 * Changing the amount, the amount due or the step cancels an earlier confirmation.
 */
export function useCashConfirmation(opts: {
  method: string | null
  cashInput: string
  amountDue: number
  /** Shown under "ยังขาดอีก" (what to do with the rest). */
  partialHint?: string
  /** The cash must be confirmed even when the box is empty (empty = exactly the amount due). */
  required?: boolean
  /** Which step the cash belongs to; a confirmation is kept per step. */
  step?: string
  /** เงินสด + QR Code, cash first: the rest is taken by this method ("ส่วนที่เหลือ … จ่ายด้วย QR Code"). */
  restBy?: string
}) {
  const confirmDialog = useConfirm()
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null)
  const key = `${opts.step ?? ''}|${opts.cashInput}|${toSatang(opts.amountDue)}`
  const needsConfirm = opts.method === 'CASH' && (opts.cashInput !== '' || !!opts.required)
  const isConfirmed = !needsConfirm || confirmedKey === key

  const confirmCash = async (): Promise<boolean> => {
    const received = opts.cashInput === '' ? opts.amountDue : Number.parseFloat(opts.cashInput) || 0
    const diff = received - opts.amountDue
    let lastLine = `เงินทอน ${baht(diff)} บาท`
    if (diff < 0 && opts.restBy) lastLine = `ส่วนที่เหลือ ${baht(-diff)} บาท จ่ายด้วย ${opts.restBy}`
    else if (diff < 0) lastLine = [`ยังขาดอีก ${baht(-diff)} บาท`, opts.partialHint].filter(Boolean).join('\n')
    const ok = await confirmDialog({
      title: 'ยอดเงินสดถูกต้องหรือไม่',
      message: `ยอดที่ต้องชำระ ${baht(opts.amountDue)} บาท\nรับเงินสดมา ${baht(received)} บาท\n${lastLine}`,
      confirmLabel: 'ถูกต้อง',
      cancelLabel: 'แก้ไข',
    })
    setConfirmedKey(ok ? key : null)
    return ok
  }

  return { needsConfirm, isConfirmed, confirmCash, reset: () => setConfirmedKey(null) }
}

export interface PaymentNotice {
  title: string
  message: string
}

/** Centre warnings shown when "ออกบิล" / "บันทึก" is pressed too early. */
export const PAYMENT_NOT_CHOSEN_NOTICE: PaymentNotice = {
  title: 'ยังไม่ได้เลือกวิธีรับเงิน',
  message: 'กดเลือก "เงินสด", "QR Code" หรือ "ค้างชำระ" ก่อน แล้วกดออกบิลอีกครั้ง',
}
export const CASH_NOT_CONFIRMED_NOTICE: PaymentNotice = {
  title: 'ยังไม่ได้ยืนยันยอดเงินสด',
  message: 'กดปุ่ม "ยืนยัน" ข้างช่องเงินสดที่รับมา เพื่อตรวจยอดเงินก่อนบันทึก',
}
export const SPLIT_CASH_FIRST_NOTICE: PaymentNotice = {
  title: 'ยังไม่ได้กรอกเงินสด',
  message: 'จ่ายเงินสด + QR Code: กรอกเงินสดที่รับมา แล้วกด "ยืนยัน" ระบบจะแสดง QR Code สำหรับส่วนที่เหลือ',
}
export const QR_NOT_RECEIVED_NOTICE: PaymentNotice = {
  title: 'ยังไม่ได้รับเงินทาง QR Code',
  message: 'กด "แสดง QR กลางจอ" ให้ลูกค้าสแกน แล้วกด "ได้รับเงินแล้ว" ก่อนบันทึก',
}
