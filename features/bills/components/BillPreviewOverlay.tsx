'use client'

import React, { useMemo } from 'react'
import { A4FullPreviewOverlay } from '@/features/pos/components/A4FitPreview'
import { sanitizeDocumentHtml } from '@/features/documents/utils/document-html'

interface BillPreviewOverlayProps {
  html: string | null
  onClose: () => void
}

/** Full-screen A4 bill preview, rendered through the central A4 preview overlay. */
export function BillPreviewOverlay({ html, onClose }: BillPreviewOverlayProps) {
  const safeHtml = useMemo(() => (html ? sanitizeDocumentHtml(html) : ''), [html])

  return (
    <A4FullPreviewOverlay open={!!html} onClose={onClose}>
      <div className="p-8 text-slate-900 font-sans text-xs" dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </A4FullPreviewOverlay>
  )
}
