'use client'

import React, { useEffect, useMemo, useState } from 'react'
import type { FullBill } from '@/lib/types/rental-return'
import { getAuditLogsForBill, type AuditLogEntry } from '@/features/audits/services/audit-storage'
import { AUDIT_ACTION_LABELS } from '@/features/bills/components/AuditLogViewerModal'
import { formatBaht } from '@/features/bills/utils/bill-workspace'

const METHOD_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  TRANSFER: 'โอน',
  CARD: 'บัตร',
  QR: 'QR',
  OTHER: 'อื่นๆ',
}

// A completed payment needs no note; other states say what happened to it.
const PAYMENT_STATUS_NOTE: Record<string, string> = {
  PENDING: 'รอยืนยัน',
  REFUNDED: 'คืนเงินแล้ว',
  VOIDED: 'ยกเลิกรายการ',
  VOID: 'ยกเลิกรายการ',
}

const dateTime =(iso?: string) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Who did what and when on one bill: the money records of the bill, then the saved audit trail. */
export function BillHistoryTab({ bill }: { bill: FullBill }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    // Audit is OWNER-only on the server (RLS): other users get an empty list.
    getAuditLogsForBill(bill.id)
      .then((rows) => alive && setLogs(rows))
      .catch(() => alive && setLogs([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [bill.id, bill.paidAmount, bill.outstandingAmount, bill.rentalStatus])

  const money = useMemo(() => {
    const payments = (bill.payments || []).map((p) => ({
      key: `p-${p.id}`,
      at: p.receivedAt,
      title: `รับชำระ ${formatBaht(p.amount)} บาท (${METHOD_LABEL[p.method] || p.method})`,
      note: [p.reference, PAYMENT_STATUS_NOTE[p.status]].filter(Boolean).join(' · '),
    }))
    const refunds = (bill.refunds || []).map((r) => ({
      key: `r-${r.id}`,
      at: r.paidAt,
      title: `คืนเงิน ${formatBaht(r.amount)} บาท (${r.refundNo})`,
      note: r.reason,
    }))
    return [...payments, ...refunds].sort((a, b) => (a.at || '').localeCompare(b.at || ''))
  }, [bill.payments, bill.refunds])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 space-y-4">
      <section>
        <h3 className="mb-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">รายการเงินของบิล</h3>
        {money.length === 0 ? (
          <p className="text-xs text-slate-600 dark:text-slate-400">ยังไม่มีรายการรับชำระหรือคืนเงิน</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-xs">
            {money.map((m) => (
              <li key={m.key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span className="font-bold text-slate-800 dark:text-slate-200">{m.title}</span>
                <span className="text-slate-600 dark:text-slate-400">{dateTime(m.at)}</span>
                {m.note && <span className="basis-full text-slate-600 dark:text-slate-400">{m.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">บันทึกการทำรายการ (ใคร ทำอะไร เมื่อไร)</h3>
        {loading ? (
          <p className="text-xs text-slate-600 dark:text-slate-400">กำลังโหลด...</p>
        ) : logs.length === 0 ? (
          <p className="text-xs text-slate-600 dark:text-slate-400">ไม่มีบันทึกให้แสดง (ประวัติการทำรายการดูได้เฉพาะเจ้าของร้าน)</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-xs">
            {logs.map((log, index) => {
              const meta = AUDIT_ACTION_LABELS[log.action]
              return (
                <li key={log.id || index} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                  <span className="font-bold text-slate-800 dark:text-slate-200">{meta?.label || log.action}</span>
                  <span className="text-slate-600 dark:text-slate-400">
                    {log.displayName || 'ระบบ'} · {dateTime(log.createdAt)}
                  </span>
                  {log.reason && <span className="basis-full text-slate-600 dark:text-slate-400">{log.reason}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
