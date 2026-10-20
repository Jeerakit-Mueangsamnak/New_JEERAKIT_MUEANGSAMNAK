'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { NumericInput } from '@/components/common/NumericInput'
import { getRefundSuggestion, refundPayment } from '@/features/bills/services/bill-service'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { CustomSelect } from '@/components/common/CustomSelect'

export type RefundMethod = 'CASH' | 'TRANSFER' | 'QR' | 'CHEQUE' | 'OTHER'

export interface RefundablePayment {
  id: string
  paymentNo?: string
  paymentMethod: string
  paidAmount: number
  refundableAmount: number
}

interface PaymentRefundModalProps {
  isOpen: boolean
  rentalBillId: string
  billNo: string
  onClose: () => void
  onSuccess: (message: string) => void | Promise<void>
}

const METHOD_LABEL: Record<string, string> = { CASH: 'เงินสด', TRANSFER: 'โอน', QR: 'QR', CARD: 'บัตร', OTHER: 'อื่น ๆ' }
const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * คืนเงิน (Master v4.3.1 §20): every refund points back to the payment it returns, never more
 * than that payment still has (received − already refunded), with a reason and the user's PIN.
 * The suggested amount comes from the server (e.g. overpaid after an early return).
 */
export function PaymentRefundModal({ isOpen, rentalBillId, billNo, onClose, onSuccess }: PaymentRefundModalProps) {
  const [payments, setPayments] = useState<RefundablePayment[]>([])
  const [paymentId, setPaymentId] = useState('')
  const [amount, setAmount] = useState(0)
  const [suggested, setSuggested] = useState(0)
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('CASH')
  const [referenceNo, setReferenceNo] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = useMemo(() => payments.find((payment) => payment.id === paymentId) || null, [payments, paymentId])

  const defaultAmount = (row: RefundablePayment | undefined, suggestion: number) =>
    row ? Math.min(row.refundableAmount, suggestion > 0 ? suggestion : row.refundableAmount) : 0

  useEffect(() => {
    if (!isOpen || !rentalBillId) return
    let alive = true
    setLoading(true)
    setError('')
    getRefundSuggestion(rentalBillId)
      .then((s) => {
        if (!alive) return
        const list: RefundablePayment[] = s.payments
          .filter((p) => p.refundable > 0)
          .map((p) => ({
            id: p.paymentId,
            paymentNo: p.paymentId.slice(0, 8),
            paymentMethod: p.method,
            paidAmount: p.amount,
            refundableAmount: p.refundable,
          }))
        const first = list[0]
        setPayments(list)
        setSuggested(s.suggestedRefund)
        setPaymentId(first?.id || '')
        setAmount(defaultAmount(first, s.suggestedRefund))
        if (first && ['CASH', 'TRANSFER', 'QR', 'OTHER'].includes(first.paymentMethod)) setRefundMethod(first.paymentMethod as RefundMethod)
        setReason(s.suggestedRefund > 0 ? 'คืนส่วนที่ลูกค้าจ่ายเกิน' : '')
        setReferenceNo('')
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'ไม่สามารถโหลดรายการรับชำระได้')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [isOpen, rentalBillId])

  const choosePayment = (id: string) => {
    setPaymentId(id)
    const row = payments.find((payment) => payment.id === id)
    setAmount(defaultAmount(row, suggested))
    if (row && ['CASH', 'TRANSFER', 'QR', 'OTHER'].includes(row.paymentMethod)) setRefundMethod(row.paymentMethod as RefundMethod)
  }

  const submit = async () => {
    if (!selected) return setError('กรุณาเลือกรายการรับชำระที่ต้องการคืนเงิน')
    if (amount <= 0 || amount > selected.refundableAmount + 0.001) {
      return setError(`ยอดคืนเงินต้องอยู่ระหว่าง 0.01 ถึง ${money(selected.refundableAmount)} บาท`)
    }
    if (!reason.trim()) return setError('กรุณาระบุเหตุผลการคืนเงิน')

    setSaving(true)
    setError('')
    try {
      await refundPayment({
        billId: rentalBillId,
        paymentId: selected.id,
        amount,
        method: refundMethod,
        reason: referenceNo.trim() ? `${reason.trim()} (อ้างอิง ${referenceNo.trim()})` : reason.trim(),
      })
      await onSuccess(`คืนเงินจำนวน ฿${money(amount)} สำเร็จ`)
      onClose()
    } catch (e: unknown) {
      if (!isPinCancelled(e)) setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการคืนเงิน')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppModal isOpen={isOpen} onClose={saving ? () => {} : onClose} size="lg">
      <AppModalHeader title={`คืนเงินจากรายการรับชำระ — ${billNo}`} onClose={saving ? undefined : onClose} />
      <AppModalBody>
        <div className="space-y-3 text-xs">
          {loading ? (
            <div className="py-8 text-center text-slate-500">กำลังโหลดรายการรับชำระ...</div>
          ) : payments.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900">
              ไม่มีรายการรับชำระที่ยังมียอดคืนได้
            </div>
          ) : (
            <>
              {suggested > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  ระบบคำนวณว่าลูกค้าจ่ายเกิน ฿{money(suggested)} — ตรวจสอบแล้วกดยืนยันเพื่อคืนเงิน
                </div>
              )}
              <div>
                <label className="mb-1 block font-bold text-slate-600 dark:text-slate-300">คืนจากรายการรับชำระ</label>
                <CustomSelect
                  ariaLabel="คืนจากรายการรับชำระ"
                  value={paymentId}
                  onChange={(value) => choosePayment(String(value))}
                  options={payments.map((payment) => ({
                    value: payment.id,
                    label: `${METHOD_LABEL[payment.paymentMethod] || payment.paymentMethod} ฿${money(payment.paidAmount)} · คืนได้ ฿${money(payment.refundableAmount)}`,
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-bold text-slate-600 dark:text-slate-300">ยอดคืนเงิน (บาท)</label>
                  <NumericInput value={amount} min={0} max={selected?.refundableAmount || 0} onChange={(value) => setAmount(value === '' ? 0 : Number(value))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold dark:border-slate-700 dark:bg-slate-900" />
                  <div className="mt-1 text-[10px] text-slate-500">คืนได้สูงสุด ฿{money(selected?.refundableAmount || 0)}</div>
                </div>
                <div>
                  <label className="mb-1 block font-bold text-slate-600 dark:text-slate-300">ช่องทางคืนเงิน</label>
                  <CustomSelect
                    ariaLabel="ช่องทางคืนเงิน"
                    value={refundMethod}
                    onChange={(value) => setRefundMethod(value as RefundMethod)}
                    options={[
                      { value: 'CASH', label: 'เงินสด' },
                      { value: 'TRANSFER', label: 'โอนเงิน' },
                      { value: 'QR', label: 'QR' },
                      { value: 'OTHER', label: 'อื่น ๆ' },
                    ]}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-bold text-slate-600 dark:text-slate-300">เลขอ้างอิง</label>
                <input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" placeholder="ถ้ามี" />
              </div>

              <div>
                <label className="mb-1 block font-bold text-slate-600 dark:text-slate-300">เหตุผลการคืนเงิน *</label>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" placeholder="ระบุเหตุผล (บันทึกในประวัติการทำรายการ)" />
              </div>
            </>
          )}

          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        </div>
      </AppModalBody>
      <AppModalFooter>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2 font-bold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">ยกเลิก</button>
        <button type="button" onClick={submit} disabled={saving || loading || !selected} className="rounded-xl bg-red-600 px-4 py-2 font-extrabold text-white hover:bg-red-700 disabled:opacity-50">{saving ? 'กำลังคืนเงิน...' : 'ยืนยันคืนเงิน (ใส่ PIN)'}</button>
      </AppModalFooter>
    </AppModal>
  )
}
