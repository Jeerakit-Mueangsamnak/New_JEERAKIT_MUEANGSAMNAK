'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React, { useEffect, useState } from 'react'
import { ClipboardCheck, Eye, FileText, PackageCheck, Printer } from 'lucide-react'
import type { FullBill } from '@/lib/types/rental-return'
import type { DocumentTemplate } from '@/lib/types/document'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { useToast } from '@/components/common/Toast'
import { fullBillToTemplateData, MAIN_BILL_FORM_MISSING, printSavedBill } from '@/features/documents/utils/rental-bill-print'
import { CHECK_FORM_NAME, RETURN_FORM_NAME, pickBillFormTemplate, printBillForm, printReturnForm, thaiDocDate } from '@/features/documents/utils/transaction-print'
import { fetchBillReturns, type SavedReturn } from '@/features/bills/api/bill-repository'
import { savedReturnFormData } from '@/features/bills/services/return-reprint'
import { refreshSharedTemplates } from '@/features/documents/services/template-library-storage'
import { BillPreviewOverlay } from '@/features/bills/components/BillPreviewOverlay'

/** Documents of one bill that can be opened again: the bill itself (same template as print), the
 *  ใบเช็คของ (items counted when delivering / collecting) and each saved return (ใบรับคืนบางส่วน),
 *  on the shop's forms once they are uploaded. */
export function BillDocumentsTab({ bill }: { bill: FullBill }) {
  const { settings } = useSystemSettings()
  const { showToast } = useToast()
  const [previewing, setPreviewing] = useState(false)
  const [checkForm, setCheckForm] = useState<DocumentTemplate | undefined>(undefined)
  const [returnForm, setReturnForm] = useState<DocumentTemplate | undefined>(undefined)
  const [saved, setSaved] = useState<{ returns: SavedReturn[]; caseReturnLine: Record<string, string> }>({ returns: [], caseReturnLine: {} })
  useEffect(() => {
    let alive = true
    refreshSharedTemplates()
      .then((templates) => {
        if (!alive) return
        setCheckForm(pickBillFormTemplate(templates, CHECK_FORM_NAME))
        setReturnForm(pickBillFormTemplate(templates, RETURN_FORM_NAME))
      })
      .catch((err: unknown) => console.error('Reading the bill forms failed:', err))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    let alive = true
    fetchBillReturns(bill.id)
      .then((data) => alive && setSaved(data))
      .catch((err: unknown) => console.error('Reading the bill returns failed:', err))
    return () => {
      alive = false
    }
  }, [bill.id])

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
          className={`${COMMAND_BUTTON_SIZE_CLASSES} flex items-center border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer`}
        >
          <Eye className="w-3.5 h-3.5" />
          ดูตัวอย่าง
        </button>
        <button
          type="button"
          onClick={() => {
            printSavedBill(bill, settings.business)
              .then((ok) => ok || showToast('พิมพ์บิลไม่ได้', MAIN_BILL_FORM_MISSING, 'ERROR'))
              .catch((err: unknown) => showToast('พิมพ์บิลไม่ได้', err instanceof Error ? err.message : 'โหลดแบบฟอร์มไม่สำเร็จ', 'ERROR'))
          }}
          className={`${COMMAND_BUTTON_SIZE_CLASSES} flex items-center bg-blue-600 hover:bg-blue-700 text-white cursor-pointer`}
        >
          <Printer className="w-3.5 h-3.5" />
          พิมพ์
        </button>
      </div>

      {checkForm && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-2.5">
          <ClipboardCheck className="w-5 h-5 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{CHECK_FORM_NAME} {bill.billNo}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 truncate">ลูกค้า: {bill.customerName || '-'}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!printBillForm(fullBillToTemplateData(bill), settings.business, checkForm)) {
                showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
              }
            }}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} flex items-center bg-blue-600 hover:bg-blue-700 text-white cursor-pointer`}
          >
            <Printer className="w-3.5 h-3.5" />
            พิมพ์
          </button>
        </div>
      )}

      {returnForm &&
        saved.returns.map((ret) => (
          <div key={ret.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-2.5">
            <PackageCheck className="w-5 h-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{RETURN_FORM_NAME} {ret.returnNo}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400 truncate">วันที่คืน: {thaiDocDate(ret.returnedAt.slice(0, 10))}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!printReturnForm(savedReturnFormData(bill, ret, saved.caseReturnLine), settings.business, returnForm)) {
                  showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
                }
              }}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} flex items-center bg-blue-600 hover:bg-blue-700 text-white cursor-pointer`}
            >
              <Printer className="w-3.5 h-3.5" />
              พิมพ์
            </button>
          </div>
        ))}

      <BillPreviewOverlay bill={previewing ? bill : null} business={settings.business} onClose={() => setPreviewing(false)} />
    </div>
  )
}
