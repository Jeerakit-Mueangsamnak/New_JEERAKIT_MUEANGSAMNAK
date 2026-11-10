'use client'

import React from 'react'
import { History } from 'lucide-react'
import type { FullBill } from '@/lib/types/rental-return'
import { AppModal, AppModalBody, AppModalHeader } from '@/components/common/AppModal'
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
 * ประวัติการทำรายการ/เอกสาร of a bill, a window in the middle of the screen opened by the ดูประวัติ icon
 * of the bills list (owner 2026-11-11). Grey background, fixed height (the window itself never scrolls):
 * left 70% = การเคลื่อนไหว table, right 30% = the customer box on top (circle arrow = return due date) and the
 * bill's documents under it (double-click = preview, พิมพ์ only).
 */
export function BillRecordsModal({ bill, onClose }: { bill: FullBill | null; onClose: () => void }) {
  if (!bill) return null
  const status = getRentalStatusPresentation(bill.rentalStatus, getBillOverdueDays(bill))
  return (
    <AppModal isOpen onClose={onClose} size="2xl" contentClassName="h-[85dvh]">
      <AppModalHeader title={`ประวัติการทำรายการ/เอกสาร · ${bill.billNo}`} icon={<History className="w-4 h-4" />} onClose={onClose} />
      <AppModalBody noPadding className="!overflow-hidden bg-slate-100 dark:bg-slate-900 p-2">
        <div className="h-full min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] gap-2">
          <BillHistoryTab bill={bill} />
          <div className="min-h-0 flex flex-col gap-2 overflow-hidden">
            <JobSummaryCard
              data-testid="bill-summary"
              className="shrink-0 !bg-white dark:!bg-slate-800"
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
      </AppModalBody>
    </AppModal>
  )
}
