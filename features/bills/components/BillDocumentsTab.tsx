'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React, { useEffect, useState } from 'react'
import { ClipboardCheck, FileText, PackageCheck, Printer } from 'lucide-react'
import type { FullBill } from '@/lib/types/rental-return'
import type { DocumentTemplate } from '@/lib/types/document'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { useToast } from '@/components/common/Toast'
import { fullBillToTemplateData, MAIN_BILL_FORM_MISSING, printSavedBill } from '@/features/documents/utils/rental-bill-print'
import {
  CHECK_FORM_NAME,
  RETURN_FORM_NAME,
  pickBillFormTemplate,
  printBillForm,
  printReturnForm,
  renderBillFormPagesHtml,
  renderReturnFormPagesHtml,
  thaiDocDate,
} from '@/features/documents/utils/transaction-print'
import { fetchBillReturns, type SavedReturn } from '@/features/bills/api/bill-repository'
import { savedReturnFormData } from '@/features/bills/services/return-reprint'
import { refreshSharedTemplates } from '@/features/documents/services/template-library-storage'
import { BillPreviewOverlay } from '@/features/bills/components/BillPreviewOverlay'
import { QuotationPreviewOverlay } from '@/features/quotations/components/QuotationPreviewOverlay'

const PRINT_BUTTON_CLASSES = `${COMMAND_BUTTON_SIZE_CLASSES} shrink-0 flex items-center bg-blue-600 hover:bg-blue-700 text-white cursor-pointer`

/** One document row: icon, name, one line under it, the พิมพ์ button; double-click shows it (owner 2026-11-11). */
function DocumentRow({
  icon,
  title,
  subtitle,
  onPreview,
  onPrint,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onPreview: () => void
  onPrint: () => void
}) {
  return (
    <div
      role="listitem"
      title="ดับเบิลคลิกเพื่อดูตัวอย่าง"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        window.getSelection()?.removeAllRanges()
        onPreview()
      }}
      className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-2 cursor-pointer select-none hover:bg-slate-50 dark:hover:bg-slate-700/40"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate" title={title}>{title}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 truncate" title={subtitle}>{subtitle}</p>
      </div>
      <button type="button" onClick={onPrint} className={PRINT_BUTTON_CLASSES}>
        <Printer />
        พิมพ์
      </button>
    </div>
  )
}

/** Documents of one bill that can be opened again: the bill itself (same template as print), the
 *  ใบเช็คของ (items counted when delivering / collecting) and each saved return (ใบรับคืนบางส่วน),
 *  on the shop's forms once they are uploaded. Only พิมพ์ on each row; double-click = preview. */
export function BillDocumentsTab({ bill }: { bill: FullBill }) {
  const { settings } = useSystemSettings()
  const { showToast } = useToast()
  const [previewing, setPreviewing] = useState(false)
  const [previewPages, setPreviewPages] = useState<string[]>([])
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

  const business = settings.business || {}
  const showPages = (pages: string[]) => {
    if (pages.length === 0) showToast('ไม่มีข้อมูลสำหรับแสดง', '', 'INFO')
    else setPreviewPages(pages)
  }

  return (
    <div role="list" aria-label="เอกสารของบิล" className="space-y-2">
      <DocumentRow
        icon={<FileText className="w-5 h-5 shrink-0 text-blue-600 dark:text-blue-400" />}
        title={`บิลเช่า ${bill.billNo}`}
        subtitle={`ลูกค้า: ${bill.customerName || '-'}`}
        onPreview={() => setPreviewing(true)}
        onPrint={() => {
          printSavedBill(bill, settings.business)
            .then((ok) => ok || showToast('พิมพ์บิลไม่ได้', MAIN_BILL_FORM_MISSING, 'ERROR'))
            .catch((err: unknown) => showToast('พิมพ์บิลไม่ได้', err instanceof Error ? err.message : 'โหลดแบบฟอร์มไม่สำเร็จ', 'ERROR'))
        }}
      />

      {checkForm && (
        <DocumentRow
          icon={<ClipboardCheck className="w-5 h-5 shrink-0 text-blue-600 dark:text-blue-400" />}
          title={`${CHECK_FORM_NAME} ${bill.billNo}`}
          subtitle={`ลูกค้า: ${bill.customerName || '-'}`}
          onPreview={() => showPages(renderBillFormPagesHtml(fullBillToTemplateData(bill), business, checkForm))}
          onPrint={() => {
            if (!printBillForm(fullBillToTemplateData(bill), business, checkForm)) {
              showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
            }
          }}
        />
      )}

      {returnForm &&
        saved.returns.map((ret) => (
          <DocumentRow
            key={ret.id}
            icon={<PackageCheck className="w-5 h-5 shrink-0 text-emerald-700 dark:text-emerald-400" />}
            title={`${RETURN_FORM_NAME} ${ret.returnNo}`}
            subtitle={`วันที่คืน: ${thaiDocDate(ret.returnedAt.slice(0, 10))}`}
            onPreview={() => showPages(renderReturnFormPagesHtml(savedReturnFormData(bill, ret, saved.caseReturnLine), business, returnForm))}
            onPrint={() => {
              if (!printReturnForm(savedReturnFormData(bill, ret, saved.caseReturnLine), business, returnForm)) {
                showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
              }
            }}
          />
        ))}

      <BillPreviewOverlay bill={previewing ? bill : null} business={settings.business} onClose={() => setPreviewing(false)} />
      <QuotationPreviewOverlay pages={previewPages} onClose={() => setPreviewPages([])} />
    </div>
  )
}
