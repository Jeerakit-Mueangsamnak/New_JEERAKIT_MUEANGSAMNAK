'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { ModalPortal } from '@/components/common/ModalPortal'
import { sanitizeDocumentHtml } from '@/features/documents/utils/document-html'

const A4_WIDTH_PX = 794 // 210mm at 96dpi

interface BillPreviewOverlayProps {
  html: string | null
  onClose: () => void
}

/**
 * Real-size A4 bill preview: centered, scrolls vertically with no visible scrollbar or frame.
 * Any click or Esc closes. On screens narrower than A4 the sheet is scaled to fit the width.
 */
export function BillPreviewOverlay({ html, onClose }: BillPreviewOverlayProps) {
  const safeHtml = useMemo(() => (html ? sanitizeDocumentHtml(html) : ''), [html])
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (!html) return
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 16) / A4_WIDTH_PX))
    fit()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('resize', fit)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [html, onClose])

  if (!html) return null

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] bg-black/85 overflow-y-auto overflow-x-hidden no-scrollbar cursor-pointer select-none animate-in fade-in duration-150"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="ตัวอย่างบิล"
      >
        <div className="min-h-full flex justify-center items-start py-2">
          <div className="bg-white shrink-0" style={{ width: '210mm', minHeight: '297mm', zoom }}>
            <div className="p-8 text-slate-900 font-sans text-xs" dangerouslySetInnerHTML={{ __html: safeHtml }} />
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
