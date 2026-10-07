'use client'

import React, { useEffect, useState } from 'react'
import { Truck } from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { NumericInput } from '@/components/common/NumericInput'
import { useToast } from '@/components/common/Toast'
import type { FullBill } from '@/lib/types/rental-return'
import { deliverBill } from '@/features/bills/services/bill-service'

interface DeliveryModalProps {
  isOpen: boolean
  bill: FullBill | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

/**
 * ส่งของ (Master v4.3.1 §11.3): partial deliveries are allowed; each save is one delivery
 * with its own history, and stock moves only by the quantity actually handed over — a paid
 * bill does not mean the goods went out.
 */
export function DeliveryModal({ isOpen, bill, onClose, onSaved }: DeliveryModalProps) {
  const { showToast } = useToast()
  const [qty, setQty] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen || !bill) return
    setQty(Object.fromEntries(bill.items.map((it) => [it.rentalBillItemId, it.remainingQty ?? 0])))
    setNote('')
  }, [isOpen, bill])

  if (!bill) return null
  const open = bill.items.filter((it) => (it.remainingQty ?? 0) > 0)

  const save = async () => {
    const lines = open
      .map((it) => ({ lineId: it.rentalBillItemId, quantity: Math.min(Number(qty[it.rentalBillItemId] || 0), it.remainingQty ?? 0) }))
      .filter((l) => l.quantity > 0)
    if (lines.length === 0) {
      showToast('ไม่มีรายการส่ง', 'ระบุจำนวนที่ส่งอย่างน้อย 1 รายการ', 'ERROR')
      return
    }
    setSaving(true)
    try {
      await deliverBill(bill.id, lines, null, note || undefined)
      showToast('บันทึกส่งของแล้ว', `บิล ${bill.billNo}`, 'SUCCESS')
      await onSaved()
      onClose()
    } catch (err) {
      showToast('บันทึกส่งของไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppModal isOpen={isOpen} onClose={saving ? () => {} : onClose} size="lg">
      <AppModalHeader title={`ส่งของ — ${bill.billNo}`} icon={<Truck className="w-4 h-4" />} onClose={saving ? undefined : onClose} />
      <AppModalBody>
        {open.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">ส่งของครบทุกรายการแล้ว</div>
        ) : (
          <div className="space-y-2 text-xs">
            {open.map((it) => (
              <div key={it.rentalBillItemId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-bold truncate">{it.productName}</div>
                  <div className="text-slate-500">ค้างส่ง {it.remainingQty} {it.unit}</div>
                </div>
                <NumericInput
                  value={qty[it.rentalBillItemId] ?? 0}
                  min={0}
                  max={it.remainingQty ?? 0}
                  onChange={(v) => setQty((prev) => ({ ...prev, [it.rentalBillItemId]: v === '' ? 0 : Number(v) }))}
                  className="w-24 rounded-xl border px-2 py-1.5 text-right font-bold"
                />
              </div>
            ))}
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ถ้ามี) เช่น ทะเบียนรถ / คนขับ"
              className="w-full rounded-xl border px-3 py-2" />
          </div>
        )}
      </AppModalBody>
      <AppModalFooter>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border px-4 py-2 font-bold text-sm">ปิด</button>
        {open.length > 0 && (
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-xl bg-blue-600 text-white px-4 py-2 font-bold text-sm disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : 'บันทึกส่งของ'}
          </button>
        )}
      </AppModalFooter>
    </AppModal>
  )
}
