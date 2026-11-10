'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React, { useEffect, useState } from 'react'
import { WalletCards } from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { NumericInput } from '@/components/common/NumericInput'
import { FullBill } from '@/lib/types/rental-return'
import { useToast } from '@/components/common/Toast'
import { correctBill } from '@/features/bills/services/bill-service'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { dbErrorMessage } from '@/lib/db/rpc'

interface DepositModalProps {
  isOpen: boolean
  bill: FullBill | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

/**
 * Deposit of a rental bill (Master v4.3.1 §18): the system only records and shows it.
 * It never deducts it, refunds it, or uses it against damage/lost fees — returning or keeping
 * the deposit at the counter is the staff's own job. A wrongly typed amount can be corrected
 * (audited, no PIN or typed reason).
 */
export function DepositModal({ isOpen, bill, onClose, onSaved }: DepositModalProps) {
  const { showToast } = useToast()
  const [amount, setAmount] = useState(0)
  const [note, setNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen || !bill) return
    setAmount(bill.heldDepositAmount || 0)
    setNote(bill.depositNote || '')
  }, [isOpen, bill])

  if (!bill) return null
  const changed = amount !== (bill.heldDepositAmount || 0) || note !== (bill.depositNote || '')

  const handleSave = async () => {
    if (!changed) return onClose()
    setIsSaving(true)
    try {
      // The box is the deposit held; the part not received yet stays on the bill as it is
      await correctBill(bill.id, { depositAmount: amount + (bill.depositOutstanding || 0), depositNote: note || null }, '')
      showToast('แก้ไขมัดจำแล้ว', `บิล ${bill.billNo}`, 'SUCCESS')
      await onSaved()
      onClose()
    } catch (err) {
      if (!isPinCancelled(err)) showToast('แก้ไขมัดจำไม่สำเร็จ', dbErrorMessage(err instanceof Error ? err.message : ''), 'ERROR')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AppModal isOpen={isOpen} onClose={onClose} size="md">
      <AppModalHeader title={`มัดจำของบิล ${bill.billNo}`} icon={<WalletCards className="w-4 h-4" />} onClose={onClose} />
      <AppModalBody>
        <div className="space-y-3 text-sm">
          <p className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200">
            ระบบเก็บยอดมัดจำไว้เพื่อแสดงเท่านั้น — ไม่หัก ไม่คืน และไม่นำไปหักค่าเสียหายให้อัตโนมัติ
            การคืนหรือหักมัดจำที่หน้าร้านให้พนักงานจัดการเอง
          </p>
          <label className="block text-xs font-semibold">
            ยอดมัดจำ (บาท)
            <NumericInput value={amount} onChange={(v) => setAmount(Math.max(0, Number(v) || 0))} className="mt-1 w-full rounded-xl border px-3 py-2" />
          </label>
          <label className="block text-xs font-semibold">
            หมายเหตุมัดจำ
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="เช่น รับเงินสด 1,000 / บัตรประชาชนตัวจริง" />
          </label>
        </div>
      </AppModalBody>
      <AppModalFooter>
        <button type="button" onClick={onClose} className={`${COMMAND_BUTTON_SIZE_CLASSES} border`}>ปิด</button>
        {changed && (
          <button type="button" disabled={isSaving} onClick={() => void handleSave()} className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-amber-500 text-slate-900 disabled:opacity-50`}>
            {isSaving ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}
          </button>
        )}
      </AppModalFooter>
    </AppModal>
  )
}
