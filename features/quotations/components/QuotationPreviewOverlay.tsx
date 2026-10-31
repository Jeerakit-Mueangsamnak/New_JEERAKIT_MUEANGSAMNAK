'use client'

import React from 'react'
import { A4FullPreviewOverlay, A4_HEIGHT_PX } from '@/features/pos/components/A4FitPreview'

interface QuotationPreviewOverlayProps {
  /** Rendered A4 pages (renderQuotationA4PagesHtml); empty closes the preview. */
  pages: string[]
  onClose: () => void
}

/** Full-screen A4 quotation preview: the same pages and template the print button uses. */
export function QuotationPreviewOverlay({ pages, onClose }: QuotationPreviewOverlayProps) {
  const multiPage = pages.length > 1

  return (
    <A4FullPreviewOverlay
      open={pages.length > 0}
      onClose={onClose}
      multiPage={multiPage}
      sheetHeight={A4_HEIGHT_PX * Math.max(1, pages.length)}
    >
      {pages.map((html, idx) => (
        <div
          key={idx}
          className={`p-8 text-slate-900 font-sans text-xs bg-white ${multiPage ? 'h-[297mm] overflow-hidden' : ''}`}
          // Pages come from renderDocumentTemplate, which already sanitizes the HTML.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ))}
    </A4FullPreviewOverlay>
  )
}
