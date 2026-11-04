'use client'

import React, { useState } from 'react'
import { Eye, FileText, Printer } from 'lucide-react'
import type { FullBill } from '@/lib/types/rental-return'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { useToast } from '@/components/common/Toast'
import { printRentalBillA4 } from '@/features/documents/utils/rental-bill-print'
import { BillPreviewOverlay } from '@/features/bills/components/BillPreviewOverlay'

/** Documents of one bill that can be opened again: the bill itself (same template as print). */
export function BillDocumentsTab({ bill }: { bill: FullBill }) {
  const { settings } = useSystemSettings()
  const { showToast } = useToast()
  const [previewing, setPreviewing] = useState(false)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-2.5">
        <FileText className="w-5 h-5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">บิลเช่า {bill.billNo}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 truncate">ลูกค้า: {bill.customerName || '-'}</p>
        </div>
        <button
          type="button"
          onClick={() => setPreviewing(true)}
          className="flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
        >
          <Eye className="w-3.5 h-3.5" />
          ดูตัวอย่าง
        </button>
        <button
          type="button"
          onClick={() => {
            if (!printRentalBillA4(bill, settings.business)) showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
          }}
          className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5" />
          พิมพ์
        </button>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400">
        ใบรับคืนสินค้าและใบเสร็จรับเงินจะออกและพิมพ์ตอนกดบันทึกที่แท็บ &quot;รับคืนสินค้า&quot; และ &quot;รับชำระเงิน&quot;
      </p>

      <BillPreviewOverlay bill={previewing ? bill : null} business={settings.business} onClose={() => setPreviewing(false)} />
    </div>
  )
}
