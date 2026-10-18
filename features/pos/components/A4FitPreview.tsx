'use client'

import React, { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react'
import { ModalPortal } from '@/components/common/ModalPortal'

interface A4FitPreviewProps {
  children: React.ReactNode
  printId?: string
  className?: string
  paddingPx?: number
  align?: 'left' | 'center'
  /**
   * Layout mode for scaling.
   * 'contain' – default behavior, fit both width and height.
   * 'width' – fit width to actual A4 size, allow vertical scroll.
   */
  fitMode?: 'contain' | 'width'
}

const MIN_SCALE = 0.12
const MAX_SCALE = 1
// 210mm × 297mm at 96dpi
const A4_WIDTH_PX = 794
const A4_HEIGHT_PX = 1123

/**
 * Central A4 preview surface.
 *
 * The sheet itself always remains a real CSS A4 page (210mm × 297mm).
 * Only the on-screen presentation is scaled to fit the available viewport.
 * Supports Double Click / Double Tap to open Full Preview overlay,
 * and Single Click / Single Tap to close.
 */
export function A4FitPreview({
  children,
  printId = 'pos-print-document',
  className = '',
  paddingPx = 10,
  align = 'center',
  fitMode = 'width',
}: A4FitPreviewProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [sheetSize, setSheetSize] = useState({ width: A4_WIDTH_PX, height: A4_HEIGHT_PX })

  const [isFullPreview, setIsFullPreview] = useState(false)
  const lastTapRef = useRef<number>(0)
  const closeFullPreview = useCallback(() => setIsFullPreview(false), [])

  const fitSheet = useCallback(() => {
    const viewport = viewportRef.current
    const sheet = sheetRef.current
    if (!viewport || !sheet) return

    const pageWidth = sheet.offsetWidth
    const pageHeight = sheet.offsetHeight
    const availableWidth = Math.max(1, viewport.clientWidth - paddingPx * 2)
    const availableHeight = Math.max(1, viewport.clientHeight - paddingPx * 2)

    if (pageWidth <= 0 || pageHeight <= 0) return

    let nextScale: number
    if (fitMode === 'width') {
      // Fit width to viewport, limit to actual size (no upscale beyond actual A4)
      nextScale = Math.max(MIN_SCALE, Math.min(1.0, availableWidth / pageWidth))
    } else {
      // Default contain behavior (fit both dimensions)
      nextScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, availableWidth / pageWidth, availableHeight / pageHeight),
      )
    }

    setSheetSize({ width: pageWidth, height: pageHeight })
    setScale((current) => (Math.abs(current - nextScale) > 0.001 ? nextScale : current))
  }, [paddingPx, fitMode])

  useLayoutEffect(() => {
    fitSheet()

    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(fitSheet)
    observer.observe(viewport)

    window.addEventListener('resize', fitSheet)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fitSheet)
    }
  }, [fitSheet])

  // Mouse PC Double Click in Normal Mode
  const handleNormalDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsFullPreview(true)
  }

  // Touch iPad / Mobile Double Tap in Normal Mode
  const handleNormalTouchEnd = (e: React.TouchEvent) => {
    const now = Date.now()
    const DOUBLE_TAP_DELAY = 320 // ms
    if (lastTapRef.current && now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      e.preventDefault()
      e.stopPropagation()
      setIsFullPreview(true)
      lastTapRef.current = 0
    } else {
      lastTapRef.current = now
    }
  }

  return (
    <>
      <div
        ref={viewportRef}
        className={`pos-a4-fit-viewport relative h-full w-full min-h-0 min-w-0 overflow-hidden ${className}`}
        aria-label="ตัวอย่างเอกสาร A4"
      >
        <div
          className={`absolute inset-0 flex flex-col ${fitMode === 'width' ? 'items-center justify-start overflow-y-auto no-scrollbar' : align === 'left' ? 'items-start justify-start overflow-hidden' : 'items-center justify-center overflow-hidden'}`}
          style={{
            paddingTop: `${paddingPx}px`,
            paddingBottom: `${paddingPx}px`,
            paddingLeft: `${paddingPx}px`,
            paddingRight: `${paddingPx}px`,
          }}
        >
          <div
            className="pos-a4-fit-stage relative shrink-0 cursor-pointer select-none"
            title="ดับเบิ้ลคลิกเพื่อดูตัวอย่างแบบเต็มจอ (Double-click for Full Preview)"
            onDoubleClick={handleNormalDoubleClick}
            onTouchEnd={handleNormalTouchEnd}
            style={{
              width: `${sheetSize.width * scale}px`,
              height: `${sheetSize.height * scale}px`,
            }}
          >
            <div
              id={printId}
              ref={sheetRef}
              className="pos-a4-fit-sheet absolute left-0 top-0 h-[297mm] w-[210mm] origin-top-left overflow-hidden bg-white shadow-xl ring-1 ring-slate-300/80 rounded-sm"
              style={{ transform: `scale(${scale})` }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>

      <A4FullPreviewOverlay
        open={isFullPreview}
        onClose={closeFullPreview}
        sheetWidth={sheetSize.width}
        sheetHeight={sheetSize.height}
        fitMode={fitMode}
      >
        {children}
      </A4FullPreviewOverlay>
    </>
  )
}

interface A4FullPreviewOverlayProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  sheetWidth?: number
  sheetHeight?: number
  fitMode?: 'contain' | 'width'
}

/**
 * Central full-screen A4 preview overlay (used by A4FitPreview and any page that
 * opens a document straight into full preview). Single click / tap or Esc closes.
 */
export function A4FullPreviewOverlay({
  open,
  onClose,
  children,
  sheetWidth = A4_WIDTH_PX,
  sheetHeight = A4_HEIGHT_PX,
  fitMode = 'width',
}: A4FullPreviewOverlayProps) {
  const [fullScale, setFullScale] = useState(1)

  const fitFullScreen = useCallback(() => {
    if (typeof window === 'undefined') return
    const padW = window.innerWidth < 640 ? 20 : 48
    const padH = window.innerHeight < 640 ? 32 : 64
    const availableWidth = Math.max(1, window.innerWidth - padW)
    const availableHeight = Math.max(1, window.innerHeight - padH)
    const pageWidth = sheetWidth || A4_WIDTH_PX
    const pageHeight = sheetHeight || A4_HEIGHT_PX

    setFullScale(
      fitMode === 'width'
        ? // Fit width to viewport for full preview, cap at actual size
          Math.max(MIN_SCALE, Math.min(1.0, availableWidth / pageWidth))
        : // Contain: fit both dimensions, max 1.6
          Math.max(MIN_SCALE, Math.min(1.6, availableWidth / pageWidth, availableHeight / pageHeight)),
    )
  }, [sheetWidth, sheetHeight, fitMode])

  useEffect(() => {
    if (!open) return

    fitFullScreen()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault() // leave full preview only; a modal behind it stays open
        onClose()
      }
    }

    window.addEventListener('resize', fitFullScreen)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('resize', fitFullScreen)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, fitFullScreen, onClose])

  if (!open) return null

  const handleClose = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation()
    onClose()
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex flex-col items-center overflow-y-auto no-scrollbar select-none animate-in fade-in duration-200 cursor-pointer"
        onClick={handleClose}
        onTouchEnd={handleClose}
        role="dialog"
        aria-modal="true"
        aria-label="ตัวอย่างเอกสาร A4 เต็มจอ"
      >
        {/* my-auto: centers the sheet when doc is short; collapses to 0 when doc overflows → scroll starts from top (header always visible) */}
        <div className="my-auto py-6 pointer-events-none">
          <div
            className="relative shrink-0 shadow-2xl transition-transform duration-150 pointer-events-auto"
            style={{
              width: `${sheetWidth * fullScale}px`,
              height: `${sheetHeight * fullScale}px`,
            }}
            onClick={handleClose}
          >
            <div
              className="absolute left-0 top-0 h-[297mm] w-[210mm] origin-top-left overflow-hidden bg-white shadow-2xl rounded-sm ring-1 ring-slate-400/40 pointer-events-none"
              style={{ transform: `scale(${fullScale})` }}
            >
              {children}
            </div>
          </div>
        </div>

        {/* Bottom Close Hint */}
        <div className="sticky bottom-4 text-center text-white/90 text-xs font-semibold bg-black/60 px-4 py-1.5 rounded-full backdrop-blur-md pointer-events-none shadow-lg border border-white/10 self-center">
          คลิกหรือแตะที่ใดก็ได้เพื่อปิด Full Preview (Esc)
        </div>
      </div>
    </ModalPortal>
  )
}
