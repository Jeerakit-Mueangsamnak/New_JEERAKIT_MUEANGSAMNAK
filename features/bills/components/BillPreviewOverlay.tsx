'use client'

import React, { useMemo } from 'react'
import { A4FullPreviewOverlay } from '@/features/pos/components/A4FitPreview'
import { RentalBillTemplate } from '@/templates/rental-bill/RentalBillTemplate'
import { fullBillToTemplateData } from '@/features/documents/utils/rental-bill-print'
import type { FullBill } from '@/lib/types/rental-return'
import type { BusinessSettings } from '@/features/settings/types/settings-page.types'

interface BillPreviewOverlayProps {
  bill: FullBill | null
  business: Partial<BusinessSettings> | undefined
  onClose: () => void
}

/** Full-screen A4 bill preview: the same rental-bill document checkout and print use. */
export function BillPreviewOverlay({ bill, business, onClose }: BillPreviewOverlayProps) {
  const data = useMemo(() => (bill ? fullBillToTemplateData(bill, business) : null), [bill, business])

  return (
    <A4FullPreviewOverlay open={!!data} onClose={onClose}>
      {data && <RentalBillTemplate data={data} />}
    </A4FullPreviewOverlay>
  )
}
