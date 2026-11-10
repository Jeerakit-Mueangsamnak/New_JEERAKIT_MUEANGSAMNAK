'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Check, Printer } from 'lucide-react'
import type { FullBill } from '@/lib/types/rental-return'
import { getBillMovements, type AuditLogEntry } from '@/features/audits/services/audit-storage'
import { DataTableFrame, DATA_TABLE_CLASSES, DATA_TABLE_THEAD_CLASSES } from '@/components/common/DataTableFrame'
import { ROW_ICON_BUTTON_CLASSES } from '@/components/common/ActionButton'
import { useToast } from '@/components/common/Toast'
import { printTable } from '@/lib/print/print-service'
import { billMovementChecks, billMovementText, movementStepOrder } from '@/features/bills/utils/bill-movement'

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

// Every header centred over its column (owner 2026-11-11)
const COLUMNS: { label: string; className: string }[] = [
  { label: 'ลำดับ', className: 'w-12' },
  { label: 'รายการ', className: '' },
  { label: 'ชำระเงิน', className: 'w-16' },
  { label: 'คืนบางส่วน', className: 'w-20' },
  { label: 'คืนครบ', className: 'w-14' },
  { label: 'วันที่', className: 'w-24' },
  { label: 'เวลา', className: 'w-14' },
  { label: 'ชื่อ', className: 'w-32' },
]

const Tick = ({ on, label }: { on: boolean; label: string }) =>
  on ? <Check aria-label={label} className="w-4 h-4 mx-auto text-emerald-700 dark:text-emerald-400" /> : null

/**
 * การเคลื่อนไหว of one bill (owner 2026-11-11), oldest first:
 * ลำดับ | รายการ (ชำระเงิน, คืนของ, …) | ชำระเงิน ✓ | คืนบางส่วน ✓ | คืนครบ ✓ | วันที่ | เวลา | ชื่อ (who did it).
 * Everyone who works with bills sees it (server bill_movements). The printer icon prints this table.
 * No empty / loading text (owner 2026-11-06: an empty table shows its header only).
 */
export function BillHistoryTab({ bill }: { bill: FullBill }) {
  const { showToast } = useToast()
  const [logs, setLogs] = useState<AuditLogEntry[]>([])

  useEffect(() => {
    let alive = true
    getBillMovements(bill.id)
      .then((rows) => alive && setLogs(rows))
      .catch(() => alive && setLogs([]))
    return () => {
      alive = false
    }
  }, [bill.id, bill.paidAmount, bill.outstandingAmount, bill.rentalStatus])

  const rows = useMemo(() => {
    // Steps saved in the same moment (ออกบิล with the money taken at the counter) follow the work order
    const sorted = [...logs].sort(
      (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || movementStepOrder(a.action) - movementStepOrder(b.action)
    )
    const checks = billMovementChecks(sorted, bill)
    return sorted.map((log, i) => ({ log, text: billMovementText(log), ...checks[i] }))
  }, [logs, bill])

  const print = () => {
    const ok = printTable({
      title: `การเคลื่อนไหว บิล ${bill.billNo}`,
      subtitle: `ลูกค้า: ${bill.customerName || '-'}`,
      columns: COLUMNS.map((c) => ({ label: c.label, align: c.label === 'รายการ' || c.label === 'ชื่อ' ? 'left' : 'center' })),
      rows: rows.map((r, i) => [
        i + 1,
        r.text,
        r.paid ? '✓' : '',
        r.partialReturn ? '✓' : '',
        r.fullReturn ? '✓' : '',
        dateOf(r.log.createdAt),
        timeOf(r.log.createdAt),
        r.log.displayName || 'ระบบ',
      ]),
    })
    if (!ok) showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
  }

  return (
    <div className="min-h-0 flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">การเคลื่อนไหว</h3>
        <button
          type="button"
          onClick={print}
          title="พิมพ์ตารางการเคลื่อนไหว"
          aria-label="พิมพ์ตารางการเคลื่อนไหว"
          className={`${ROW_ICON_BUTTON_CLASSES} text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700`}
        >
          <Printer className="w-3.5 h-3.5" />
        </button>
      </div>
      <DataTableFrame fill rowCount={rows.length} className="flex-1 min-h-0 rounded-none bg-transparent">
        <table className={`${DATA_TABLE_CLASSES} text-xs`}>
          <thead className={DATA_TABLE_THEAD_CLASSES}>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} className={`px-2 text-center ${c.className}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={r.log.id || i}>
                <td className="px-2 text-center font-bold text-slate-600 dark:text-slate-400">{i + 1}</td>
                <td className="px-2 font-bold text-slate-800 dark:text-slate-200 break-words">{r.text}</td>
                <td className="px-2 text-center"><Tick on={r.paid} label="ชำระเงิน" /></td>
                <td className="px-2 text-center"><Tick on={r.partialReturn} label="คืนบางส่วน" /></td>
                <td className="px-2 text-center"><Tick on={r.fullReturn} label="คืนครบ" /></td>
                <td className="px-2 text-center font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">{dateOf(r.log.createdAt)}</td>
                <td className="px-2 text-center font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">{timeOf(r.log.createdAt)}</td>
                <td className="px-2 text-slate-700 dark:text-slate-300 break-words">{r.log.displayName || 'ระบบ'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}
