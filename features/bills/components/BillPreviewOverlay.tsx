'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { QuotationPreviewOverlay } from '@/features/quotations/components/QuotationPreviewOverlay'
import { fullBillToTemplateData, loadMainBillForm, MAIN_BILL_FORM_MISSING } from '@/features/documents/utils/rental-bill-print'
import { renderBillFormPagesHtml } from '@/features/documents/utils/transaction-print'
import { useToast } from '@/components/common/Toast'
import type { DocumentTemplate } from '@/lib/types/document'
import type { FullBill } from '@/lib/types/rental-return'
import type { BusinessSettings } from '@/features/settings/types/settings-page.types'

interface BillPreviewOverlayProps {
  bill: FullBill | null
  business: Partial<BusinessSettings> | undefined
  onClose: () => void
}

/** Full-screen A4 bill preview: the shop's main bill form, the same pages the print button gives. */
export function BillPreviewOverlay({ bill, business, onClose }: BillPreviewOverlayProps) {
  const { showToast } = useToast()
  const [form, setForm] = useState<DocumentTemplate | null | undefined>(undefined)

  useEffect(() => {
    if (!bill) return
    let alive = true
    loadMainBillForm()
      .then((found) => alive && setForm(found ?? null))
      .catch((err: unknown) => {
        console.error('Reading the bill forms failed:', err)
        if (alive) setForm(null)
      })
    return () => {
      alive = false
    }
  }, [bill])

  // No form to show the bill on: say which one to add, and close.
  useEffect(() => {
    if (bill && form === null) {
      showToast('ดูตัวอย่างไม่ได้', MAIN_BILL_FORM_MISSING, 'ERROR')
      onClose()
    }
  }, [bill, form, onClose, showToast])

  const pages = useMemo(
    () => (bill && form ? renderBillFormPagesHtml(fullBillToTemplateData(bill), business || {}, form) : []),
    [bill, form, business]
  )

  return <QuotationPreviewOverlay pages={pages} onClose={onClose} />
}
