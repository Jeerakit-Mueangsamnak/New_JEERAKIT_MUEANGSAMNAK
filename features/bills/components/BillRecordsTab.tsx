'use client'

import React from 'react'
import type { FullBill } from '@/lib/types/rental-return'
import { JobSummaryCard } from '@/features/appointments/components/JobSummaryCard'
import { BillHistoryTab } from '@/features/bills/components/BillHistoryTab'
import { BillDocumentsTab } from '@/features/bills/components/BillDocumentsTab'
import {
  getBillListReturnDate,
  getBillOverdueDays,
  getRentalStatusPresentation,
} from '@/features/bills/utils/bill-list-presentation'

const PANEL_CLASSES = 'min-h-0 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'

/**
 * ประวัติการทำรายการ/เอกสาร of a bill on one page (owner 2026-11-11): left 70% = the bill's history,
 * right 30% = the customer box on top (like the job summary box, the circle-arrow shows the return
 * due date) and the bill's documents under it (double-click = preview, พิมพ์ only).
 */
export function BillRecordsTab({ bill }: { bill: FullBill }) {
  const status = getRentalStatusPresentation(bill.rentalStatus, getBillOverdueDays(bill))
  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] md:grid-rows-[minmax(0,1fr)] gap-2 overflow-y-auto md:overflow-hidden">
      <BillHistoryTab bill={bill} />
      <div className="min-h-0 flex flex-col gap-2 overflow-hidden">
        <JobSummaryCard
          data-testid="bill-summary"
          className="shrink-0"
          title={`บิลเช่า ${bill.billNo}`}
          badge={<span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${status.className}`}>{status.label}</span>}
          customerName={bill.customerName}
          phone={bill.customerPhone}
          // The POS keeps the delivery place in the bill's note as "ส่งที่: …"
          location={bill.siteName || /(?:^|\n)ส่งที่:\s*(.+)/.exec(bill.remark || '')?.[1]?.trim()}
          date={bill.billDate}
          returnDate={getBillListReturnDate(bill) || bill.scheduledReturnDate || null}
        />
        <div className={`${PANEL_CLASSES} flex-1 overflow-y-auto p-2`}>
          <BillDocumentsTab bill={bill} />
        </div>
      </div>
    </div>
  )
}
