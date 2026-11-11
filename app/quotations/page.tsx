'use client'
import {
  COMMAND_BUTTON_SIZE_CLASSES,
  SEARCH_INPUT_CLASSES,
  SEARCH_ICON_CLASSES,
  TABLE_TOOLBAR_CLASSES, ROW_ICON_BUTTON_CLASSES } from '@/components/common/ActionButton'
import { isQuotationFormTemplate, pickQuotationPrintTemplate, printQuotationA4, renderQuotationA4PagesHtml } from '@/features/documents/utils/transaction-print'
import { QuotationPreviewOverlay } from '@/features/quotations/components/QuotationPreviewOverlay'
import { loadTemplateLibrary, refreshSharedTemplates } from '@/features/documents/services/template-library-storage'
import type { DocumentTemplate } from '@/lib/types/document'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'

import React, { useState, useEffect } from 'react'
import {
  Plus,
  ArrowRight,
  Search,
  ShoppingBag,
  RefreshCw,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Printer,
  Pencil,
  Copy,
  XCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { CustomSelect } from '@/components/common/CustomSelect'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import { Quotation } from '@/lib/types/rental-pos'
import { logger } from '@/lib/utils/logger'
import { useToast } from '@/components/common/Toast'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import {
  loadQuotations as loadQuotationsFromStorage,
  updateQuotationStatus,
  confirmQuotationWorkflow,
  cancelQuotationWorkflow,
  fetchQuotationsFromSupabase,
  quotationStatusView,
  QUOTATION_WAITING_STATUSES,
} from '@/features/quotations/services/quotation-storage'
import { useAutoFitPageSize } from '@/lib/hooks/useAutoFitPageSize'
import { isNoChargeBillLine } from '@/features/pos/services/accessory-rules'

interface ReservationFulfillmentResult {
  hasShortage: boolean
  requestedQuantity: number
  reservedQuantity: number
  shortageQuantity: number
  items: Array<{
    productId: string
    productName: string
    shortageQuantity: number
  }>
}

const STATUS_TONE_CLASS = {
  accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  converted: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  closed: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  waiting: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
} as const

export default function QuotationsPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const { settings: systemSettings } = useSystemSettings()
  const { user } = useAuth()
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [printTemplates, setPrintTemplates] = useState<DocumentTemplate[]>(() => loadTemplateLibrary().filter(isQuotationFormTemplate))

  const [selectedQuotationForConversion, setSelectedQuotationForConversion] = useState<Quotation | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [reservationResult, setReservationResult] = useState<ReservationFulfillmentResult | null>(null)

  // Quotation Release Reservation
  const [quotationForRelease, setQuotationForRelease] = useState<Quotation | null>(null)
  const [releaseTargetStatus, setReleaseTargetStatus] = useState<'CANCELLED' | 'WAITING' | 'REJECTED'>('CANCELLED')
  const [releaseError, setReleaseError] = useState('')
  const [isReleasing, setIsReleasing] = useState(false)

  const handleOpenReleaseModal = (quotation: Quotation) => {
    setQuotationForRelease(quotation)
    setReleaseTargetStatus('CANCELLED')
    setReleaseError('')
    setIsReleasing(false)
  }

  const handleCloseReleaseModal = () => {
    if (isReleasing) return
    setQuotationForRelease(null)
    setReleaseError('')
  }

  const handleConfirmRelease = async () => {
    if (!quotationForRelease || isReleasing) return
    setIsReleasing(true)
    setReleaseError('')
    try {
      const actor = {
        userId: user?.userId || 'system',
        displayName: user?.displayName || 'ระบบ',
      }
      await cancelQuotationWorkflow(quotationForRelease.id, '', actor)
      const updatedList = loadQuotationsFromStorage()
      setQuotations(updatedList)
      setQuotationForRelease(null)
      if (selectedQuotationForConversion?.id === quotationForRelease.id) {
        closeActionModal()
      }
      showToast('ยกเลิกใบเสนอราคาสำเร็จ', `ยกเลิก ${quotationForRelease.quotationNo} เรียบร้อยแล้ว`, 'SUCCESS')
    } catch (err: any) {
      setReleaseError(err?.message || 'ไม่สามารถยกเลิกใบเสนอราคาได้')
    } finally {
      setIsReleasing(false)
    }
  }

  const loadQuotations = React.useCallback(async () => {
    setIsLoading(true)
    try {
      try {
        const remote = await fetchQuotationsFromSupabase()
        if (remote && remote.length >= 0) {
          setQuotations(remote)
          return
        }
      } catch (err) {
        console.warn('[QuotationsPage] Supabase fetch fallback to local cache:', err)
      }
      const data = loadQuotationsFromStorage()
      setQuotations(data)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadQuotations()
  }, [loadQuotations])

  // The same shop library as Documents; only data-bound quotation templates can print live bills.
  useEffect(() => {
    let active = true
    refreshSharedTemplates()
      .then((templates) => {
        if (!active) return
        const valid = templates.filter(isQuotationFormTemplate)
        setPrintTemplates(valid)
      })
      .catch((error: unknown) => {
        if (active) showToast('โหลดเทมเพลตไม่สำเร็จ', error instanceof Error ? error.message : 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
      })
    return () => { active = false }
  }, [showToast])

  // No form picker here (owner 2026-11-07): the quotation form is chosen at POS; reprints use the shop quotation form.
  const selectedPrintTemplate = pickQuotationPrintTemplate(printTemplates)

  const filteredQuotations = quotations.filter((q) => {
    const matchesSearch =
      q.quotationNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.customerName.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'WAITING' ? QUOTATION_WAITING_STATUSES.includes(q.status) : q.status === statusFilter)
    return matchesSearch && matchesStatus
  })

  const quotationAutoFit = useAutoFitPageSize({
    totalItems: filteredQuotations.length,
    defaultRowHeight: 38,
    defaultHeaderHeight: 36,
  })

  const setQuotationPage = quotationAutoFit.setCurrentPage
  useEffect(() => {
    setQuotationPage(1)
  }, [searchTerm, statusFilter, setQuotationPage])

  const paginatedQuotations = filteredQuotations.slice(
    quotationAutoFit.startIndex,
    quotationAutoFit.endIndex
  )

  const closeActionModal = () => {
    setSelectedQuotationForConversion(null)
    setReservationResult(null)
    setActionError('')
    setIsProcessing(false)
  }

  const handleOpenConversionVerification = (quotation: Quotation) => {
    setReservationResult(null)
    setActionError('')
    setSelectedQuotationForConversion(quotation)
  }

  const routeAcceptedQuotationToPos = (quotationId: string) => {
    closeActionModal()
    router.push(`/pos?quotationId=${encodeURIComponent(quotationId)}`)
  }

  // Edit keeps the number (only DRAFT / SENT / ACCEPTED); copy starts a new quotation from this one.
  const handleEditQuotation = (q: Quotation) => {
    router.push(`/pos?mode=quotation&editQuotationId=${encodeURIComponent(q.id)}`)
  }
  const handleCopyQuotation = (q: Quotation) => {
    router.push(`/pos?mode=quotation&copyQuotationId=${encodeURIComponent(q.id)}`)
  }

  const quotationTemplateProblem = () => selectedPrintTemplate
    ? 'เทมเพลตที่เลือกไม่รองรับข้อมูลครบหรือใบเสนอราคาหลายหน้า กรุณาเลือกแบบฟอร์มอื่น'
    : 'ยังไม่มีแบบฟอร์มใบเสนอราคาที่ใช้พิมพ์ได้ กรุณาเพิ่มที่เมนูจัดการเอกสาร'

  const handlePrintQuotation = (q: Quotation) => {
    if (!selectedPrintTemplate || !printQuotationA4(q, systemSettings.business, selectedPrintTemplate)) {
      showToast('พิมพ์ใบเสนอราคาไม่ได้', quotationTemplateProblem(), 'ERROR')
    }
  }

  // Double-click a quotation row: real-size A4 preview (same pages and template as print).
  const [previewPages, setPreviewPages] = useState<string[]>([])
  const closeQuotationPreview = React.useCallback(() => setPreviewPages([]), [])
  const openQuotationPreview = (e: React.MouseEvent, q: Quotation) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    window.getSelection()?.removeAllRanges()
    const pages = selectedPrintTemplate ? renderQuotationA4PagesHtml(q, systemSettings.business, selectedPrintTemplate) : []
    if (pages.length === 0) {
      showToast('แสดงตัวอย่างใบเสนอราคาไม่ได้', quotationTemplateProblem(), 'ERROR')
      return
    }
    setPreviewPages(pages)
  }

  const handleConfirmConvertToPos = async () => {
    if (!selectedQuotationForConversion || isProcessing) return
    const targetQuotation = selectedQuotationForConversion
    if (targetQuotation.status === 'CONVERTED') return

    setIsProcessing(true)
    setActionError('')
    try {
      if (targetQuotation.status !== 'ACCEPTED') {
        const actor = {
          userId: user?.userId || 'system',
          displayName: user?.displayName || 'ระบบ',
        }
        const res = await confirmQuotationWorkflow(targetQuotation.id, actor)
        const updated = loadQuotationsFromStorage()
        setQuotations(updated)
        closeActionModal()
        const backorderMsg = res.backorders.length > 0
          ? ` (มี Backorder ${res.backorders.length} รายการเนื่องจากสต็อกไม่พอ)`
          : ''
        showToast('ตอบรับใบเสนอราคาสำเร็จ', `ปรับสถานะ ${targetQuotation.quotationNo} เป็น ตอบรับแล้ว${backorderMsg}`, 'SUCCESS')
      } else {
        routeAcceptedQuotationToPos(targetQuotation.id)
      }
    } catch (err: any) {
      setActionError(err?.message || 'ไม่สามารถดำเนินการได้')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-2 bg-slate-100 dark:bg-slate-900 gap-2 text-xs">
      {/* One white work area (owner 2026-11-11): summary cards, then the toolbar and table */}
      <div className="flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 pb-0 shrink-0">
          <div className="bg-slate-100/70 dark:bg-slate-800/70 p-2.5 sm:p-3 rounded-2xl border border-slate-300/70 dark:border-slate-700 shadow-sm">
            <span className="text-[11px] text-slate-600 dark:text-slate-400 font-semibold block">ใบเสนอราคาทั้งหมด</span>
            <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-slate-100 mt-0.5">{quotations.length}</h3>
          </div>

          <div className="bg-emerald-50 dark:bg-emerald-950/30 p-2.5 sm:p-3 rounded-2xl border border-emerald-200/60 dark:border-emerald-900/40 shadow-sm">
            <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold block">ตอบรับแล้ว</span>
            <h3 className="text-lg sm:text-xl font-black text-emerald-700 dark:text-emerald-400 mt-0.5">
              {quotations.filter((q) => q.status === 'ACCEPTED').length}
            </h3>
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/30 p-2.5 sm:p-3 rounded-2xl border border-amber-200/60 dark:border-amber-900/40 shadow-sm">
            <span className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold block">รอยืนยัน</span>
            <h3 className="text-lg sm:text-xl font-black text-amber-700 dark:text-amber-400 mt-0.5">
              {quotations.filter((q) => q.status === 'WAITING' || q.status === 'SENT' || q.status === 'DRAFT').length}
            </h3>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/30 p-2.5 sm:p-3 rounded-2xl border border-blue-200/60 dark:border-blue-900/40 shadow-sm">
            <span className="text-[11px] text-blue-700 dark:text-blue-300 font-semibold block">ทำรายการสำเร็จ</span>
            <h3 className="text-lg sm:text-xl font-black text-blue-600 dark:text-blue-400 mt-0.5">
              {quotations.filter((q) => q.status === 'CONVERTED').length}
            </h3>
          </div>
        </div>

        {isLoading && (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-16 text-slate-600 dark:text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin mb-3" />
            <span className="text-sm font-semibold">กำลังโหลดข้อมูลใบเสนอราคา...</span>
          </div>
        )}

        {!isLoading && (
          <>
            {/* 1. Mobile Card View (< md screens) */}
            <div className="md:hidden flex-1 min-h-0 flex flex-col gap-2 overflow-hidden p-2">
              {/* Mobile Toolbar */}
              <div className="bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-2 shrink-0">
                <div className="relative w-full">
                  <Search className={SEARCH_ICON_CLASSES} />
                  <input
                    type="text"
                    placeholder="ค้นหาเลขที่ใบเสนอราคา หรือ ชื่อลูกค้า..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className={SEARCH_INPUT_CLASSES}
                  />
                </div>

                <div className="flex items-center gap-2 text-xs w-full">
                  <div className="flex-1">
                    <CustomSelect
                      value={statusFilter}
                      onChange={(value) => setStatusFilter(String(value))}
                      options={[
                        { value: 'ALL', label: 'สถานะ: ทั้งหมด' },
                        { value: 'ACCEPTED', label: 'ตอบรับแล้ว' },
                        { value: 'WAITING', label: 'รอยืนยัน' },
                        { value: 'CONVERTED', label: 'แปลงเป็นบิลแล้ว' },
                      ]}
                    />
                  </div>

                  <button
                    onClick={() => router.push('/pos?mode=quotation')}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-emerald-700 hover:bg-emerald-800 text-white flex items-center shadow-xs transition-all shrink-0 cursor-pointer`}
                  >
                    <Plus className="w-4 h-4" />
                    <span>สร้าง</span>
                  </button>
                </div>
              </div>

              {/* Mobile Card List */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
                {filteredQuotations.length === 0 ? (
                  <div className="p-8 text-center text-slate-600 dark:text-slate-400 italic">ไม่พบรายการใบเสนอราคา</div>
                ) : (
                  filteredQuotations.map((q) => {
                    const view = quotationStatusView(q.status)
                    const isConverted = !view.actionable
                    const buttonLabel = q.status === 'CONVERTED' ? 'เปิดบิลแล้ว' : !view.actionable ? view.label : q.status === 'ACCEPTED' ? 'เปิดบิล POS' : 'ตอบรับ'
                    return (
                      <div
                        key={q.id}
                        onDoubleClick={(e) => openQuotationPreview(e, q)}
                        className="p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm space-y-2"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-mono font-bold text-sm text-blue-600 dark:text-blue-400 block">
                              {q.quotationNo}
                            </span>
                            <span className="text-[11px] text-slate-600 dark:text-slate-400 block">วันที่: {q.quotationDate}</span>
                          </div>
                          <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${STATUS_TONE_CLASS[view.tone]}`}>
                            {view.label}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs py-1.5 border-y border-slate-100 dark:border-slate-700/80">
                          <div>
                            <span className="text-slate-600 dark:text-slate-400 block text-[10px]">ลูกค้า:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200 block truncate">
                              {q.customerName}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-600 dark:text-slate-400 block text-[10px]">ช่วงเช่า:</span>
                            <span className="font-mono text-slate-600 dark:text-slate-400 block text-[11px]">
                              {q.rentalStartDate} - {q.rentalEndDate}
                            </span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-1">
                          <div>
                            <span className="text-[10px] text-slate-600 dark:text-slate-400 block">ยอดสุทธิ:</span>
                            <span className="font-black text-sm text-slate-900 dark:text-slate-100">
                              {q.grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => handlePrintQuotation(q)} className="p-1.5 rounded-xl text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" title="พิมพ์ใบเสนอราคา" aria-label="พิมพ์">
                              <Printer className="w-4 h-4" />
                            </button>
                            {view.editable && (
                              <button type="button" onClick={() => handleEditQuotation(q)} className="p-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" title="แก้ไขใบเสนอราคา (ใช้เลขเดิม)" aria-label={`แก้ไข ${q.quotationNo}`}>
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            <button type="button" onClick={() => handleCopyQuotation(q)} className="p-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" title="คัดลอกเป็นใบเสนอราคาใหม่" aria-label={`คัดลอก ${q.quotationNo}`}>
                              <Copy className="w-4 h-4" />
                            </button>
                            {view.cancellable && (
                              <button type="button" onClick={() => handleOpenReleaseModal(q)} className="p-1.5 rounded-xl text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" title="ยกเลิกใบเสนอราคา" aria-label="ยกเลิก">
                                <XCircle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isConverted}
                              onClick={() => !isConverted && handleOpenConversionVerification(q)}
                              className="p-1.5 rounded-xl text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              title={buttonLabel}
                              aria-label={buttonLabel}
                            >
                              {q.status === 'ACCEPTED' || isConverted ? <ShoppingBag className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="shrink-0 p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400">
                ทั้งหมด {filteredQuotations.length} รายการ
              </div>
            </div>

            {/* 2. Desktop/Tablet Table View (>= md screens) */}
            <div
              className="hidden md:flex overflow-hidden flex-1 min-h-0 flex-col"
            >
              {/* Table Toolbar */}
              <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-col sm:flex-row items-stretch sm:items-center justify-between`}>
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                  {/* Search */}
                  <div className="relative min-w-[140px] flex-1 max-w-xs">
                    <Search className={SEARCH_ICON_CLASSES} />
                    <input
                      type="text"
                      placeholder="ค้นหาเลขที่ใบเสนอราคา หรือ ชื่อลูกค้า..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className={SEARCH_INPUT_CLASSES}
                    />
                  </div>

                  {/* Status Filter */}
                  <div className="w-48 shrink-0">
                    <CustomSelect
                      value={statusFilter}
                      onChange={(value) => setStatusFilter(String(value))}
                      options={[
                        { value: 'ALL', label: 'สถานะ: ทั้งหมด' },
                        { value: 'ACCEPTED', label: 'ตอบรับแล้ว' },
                        { value: 'WAITING', label: 'รอยืนยัน' },
                        { value: 'CONVERTED', label: 'แปลงเป็นบิลแล้ว' },
                      ]}
                    />
                  </div>
                </div>

                {/* Action Buttons: สร้างใบเสนอราคา */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => router.push('/pos?mode=quotation')}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-emerald-700 hover:bg-emerald-800 text-white flex items-center transition-colors cursor-pointer shadow-xs whitespace-nowrap`}
                  >
                    <Plus className="w-4 h-4" />
                    <span>สร้างใบเสนอราคา</span>
                  </button>
                </div>
              </div>

              {/* Table scroll area: rows load incrementally (quotationAutoFit) */}
              <DataTableFrame
                fill
                scrollRef={quotationAutoFit.containerRef}
                rowCount={filteredQuotations.length}
                shownCount={quotationAutoFit.endIndex}
                className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent"
              >
                  <table className={`w-full table-fixed text-left text-xs leading-tight border-collapse ${paginatedQuotations.length === 0 ? 'h-full' : ''}`}>
                    <thead className="sticky top-0 z-10 bg-[#E3E3E3] dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold">
                      <tr>
                        <th className="w-[14%] py-2 px-3 whitespace-nowrap">เลขที่ใบเสนอราคา</th>
                        <th className="w-[9%] py-2 px-3 whitespace-nowrap">วันที่เอกสาร</th>
                        <th className="w-[14%] py-2 px-3 whitespace-nowrap">ชื่อลูกค้า</th>
                        <th className="w-[13%] py-2 px-3 whitespace-nowrap">ช่วงเช่าสินค้า</th>
                        <th className="w-[11%] py-2 px-3 text-right whitespace-nowrap">ยอดรวมสุทธิ</th>
                        <th className="w-[10%] py-2 px-3 text-center whitespace-nowrap">สถานะ</th>
                        <th className="w-[29%] py-2 px-3 text-center whitespace-nowrap">การกระทำ</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y divide-slate-100 dark:divide-slate-700 ${paginatedQuotations.length === 0 ? 'h-full' : ''}`}>
                      {paginatedQuotations.length === 0 ? (
                        <tr data-empty-row="true" className="h-full">
                          <td colSpan={7} className="h-full px-4 text-center text-slate-600 dark:text-slate-400 italic align-middle">
                            <div className="flex flex-col items-center justify-center">
                              <FileText className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-400 mb-1.5 opacity-50" />
                              <p className="font-bold text-xs text-slate-600 dark:text-slate-400">ไม่พบรายการใบเสนอราคา</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        paginatedQuotations.map((q) => {
                          const view = quotationStatusView(q.status)
                          const isConverted = !view.actionable
                          const buttonLabel = q.status === 'CONVERTED' ? 'เปิดแล้ว' : !view.actionable ? view.label : q.status === 'ACCEPTED' ? 'เปิดบิล' : 'ตอบรับ'
                          return (
                            <tr key={q.id} onDoubleClick={(e) => openQuotationPreview(e, q)} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                              <td className="py-1.5 px-3 font-bold text-blue-600 dark:text-blue-400 font-mono whitespace-nowrap truncate">{q.quotationNo}</td>
                              <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400 font-mono whitespace-nowrap truncate">{q.quotationDate}</td>
                              <td className="py-1.5 px-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap truncate">{q.customerName}</td>
                              <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400 font-mono whitespace-nowrap truncate">{q.rentalStartDate} ถึง {q.rentalEndDate}</td>
                              <td className="py-1.5 px-3 text-right font-extrabold text-slate-900 dark:text-slate-100 whitespace-nowrap tabular-nums">
                                {q.grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-1.5 px-3 text-center whitespace-nowrap">
                                <span className={`inline-flex px-2 py-0.5 rounded-full font-bold text-[10px] ${STATUS_TONE_CLASS[view.tone]}`}>
                                  {view.label}
                                </span>
                              </td>
                              <td className="py-1.5 px-3 text-center whitespace-nowrap">
                                <div className="inline-flex items-center justify-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handlePrintQuotation(q)}
                                    className={`${ROW_ICON_BUTTON_CLASSES} text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60`}
                                    title="พิมพ์ใบเสนอราคา"
                                    aria-label="พิมพ์"
                                  >
                                    <Printer className="w-3.5 h-3.5" />
                                  </button>
                                  {view.editable && (
                                    <button
                                      type="button"
                                      onClick={() => handleEditQuotation(q)}
                                      className={`${ROW_ICON_BUTTON_CLASSES} text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700`}
                                      title="แก้ไขใบเสนอราคา (ใช้เลขเดิม)"
                                      aria-label={`แก้ไข ${q.quotationNo}`}
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleCopyQuotation(q)}
                                    className={`${ROW_ICON_BUTTON_CLASSES} text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700`}
                                    title="คัดลอกเป็นใบเสนอราคาใหม่"
                                    aria-label={`คัดลอก ${q.quotationNo}`}
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                  {view.cancellable && (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenReleaseModal(q)}
                                      className={`${ROW_ICON_BUTTON_CLASSES} text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60`}
                                      title="ยกเลิกใบเสนอราคา"
                                      aria-label="ยกเลิก"
                                    >
                                      <XCircle className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={isConverted}
                                    onClick={() => !isConverted && handleOpenConversionVerification(q)}
                                    className={`${ROW_ICON_BUTTON_CLASSES} text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/60`}
                                    title={buttonLabel}
                                    aria-label={buttonLabel}
                                  >
                                    {q.status === 'ACCEPTED' || isConverted ? <ShoppingBag className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
              </DataTableFrame>
            </div>
          </>
        )}
      </div>

      {selectedQuotationForConversion && (
        <AppModal isOpen onClose={() => !isProcessing && closeActionModal()} closeOnBackdropClick={!isProcessing} size="lg">
            <AppModalHeader onClose={() => !isProcessing && closeActionModal()}>
              <div className="min-w-0">
                <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">{selectedQuotationForConversion.quotationNo}</span>
                <h3 className="font-black text-base text-slate-900 dark:text-slate-100 truncate">
                  {selectedQuotationForConversion.status === 'ACCEPTED' ? 'ตรวจสอบก่อนเปิดบิล' : 'ตอบรับใบเสนอราคา'}
                </h3>
              </div>
            </AppModalHeader>

            <AppModalBody className="space-y-3">
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-1">
                <p>ลูกค้า: <strong>{selectedQuotationForConversion.customerName}</strong> ({selectedQuotationForConversion.phone})</p>
                <p>ช่วงเวลาเช่า: <strong className="font-mono">{selectedQuotationForConversion.rentalStartDate} ถึง {selectedQuotationForConversion.rentalEndDate}</strong></p>
              </div>

              <h4 className="font-bold">รายการสินค้า</h4>
              <div className="border rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                {selectedQuotationForConversion.items.map((item, idx) => {
                  // A "ไม่คิดเงิน" rental (owner 2026-11-09): จำนวน only; ราคา and จำนวนเงิน are "-".
                  const noCharge = item.rentalType !== 'SALE' && isNoChargeBillLine(item)
                  return (
                  <div key={idx} className="p-3 flex justify-between items-center bg-white dark:bg-slate-900">
                    <div>
                      <span className="font-bold block">{item.productName}</span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        จำนวน: {item.quantity}{noCharge ? ' | ราคา: -' : ` | ราคา: ${item.unitPrice} บาท`}
                      </span>
                    </div>
                    <span className="font-extrabold text-blue-600 dark:text-blue-400">
                      {noCharge ? '-' : `${item.lineTotal.toLocaleString()} บาท`}
                    </span>
                  </div>
                  )
                })}
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl space-y-1 text-right border border-blue-100 dark:border-blue-900">
                <p>ยอดรวมส่วนลด/ค่าขนส่ง/VAT: <span className="font-bold">{(selectedQuotationForConversion.grandTotal - selectedQuotationForConversion.subtotal).toLocaleString()} บาท</span></p>
                <h4 className="text-sm font-black text-blue-600 dark:text-blue-400">
                  ยอดรวมสุทธิทั้งสิ้น: {selectedQuotationForConversion.grandTotal.toLocaleString()} บาท
                </h4>
              </div>

              {reservationResult && (
                <div className={`p-3 rounded-xl border ${reservationResult.hasShortage ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900' : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900'}`}>
                  <div className="flex gap-2 items-start">
                    {reservationResult.hasShortage ? <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0" /> : <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />}
                    <div className="space-y-1 flex-1">
                      <p className="font-black">
                        {reservationResult.hasShortage ? `ยืนยันแล้ว — รอสินค้า ${reservationResult.shortageQuantity} ชิ้น` : 'จองสินค้าได้ครบ'}
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        ต้องการ {reservationResult.requestedQuantity} / จองได้ {reservationResult.reservedQuantity} / ขาด {reservationResult.shortageQuantity}
                      </p>
                      {reservationResult.items.filter((item) => item.shortageQuantity > 0).map((item) => (
                        <div key={item.productId} className="text-[11px] flex justify-between gap-2">
                          <span>{item.productName}</span>
                          <span className="font-bold text-amber-700 dark:text-amber-300">ขาด {item.shortageQuantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {actionError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300">
                  {actionError}
                </div>
              )}
            </AppModalBody>

            <AppModalFooter className="justify-between">
              <div>
                {selectedQuotationForConversion.status === 'ACCEPTED' && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => handleOpenReleaseModal(selectedQuotationForConversion)}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-rose-300 dark:border-rose-800 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 disabled:opacity-50 cursor-pointer`}
                  >
                    ยกเลิกใบเสนอราคานี้
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={closeActionModal}
                  className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-700 disabled:opacity-50`}
                >
                  {reservationResult?.hasShortage ? 'ปิด' : 'ยกเลิก'}
                </button>

                {!reservationResult?.hasShortage && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={handleConfirmConvertToPos}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-emerald-700 hover:bg-emerald-800 text-white shadow-lg shadow-emerald-500/30 flex items-center disabled:opacity-50`}
                  >
                    {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
                    <span>{selectedQuotationForConversion.status === 'ACCEPTED' ? 'เข้า POS เพื่อเปิดบิล' : 'ยืนยันตอบรับ'}</span>
                    {!isProcessing && <ArrowRight className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </AppModalFooter>
        </AppModal>
      )}

      {/* Quotation Release Reservation Modal */}
      {quotationForRelease && (
        <AppModal isOpen onClose={() => !isReleasing && handleCloseReleaseModal()} closeOnBackdropClick={!isReleasing} size="sm">
            <AppModalHeader onClose={() => !isReleasing && handleCloseReleaseModal()}>
              <div className="min-w-0">
                <span className="text-xs font-mono font-bold text-rose-700 dark:text-rose-400">
                  {quotationForRelease.quotationNo}
                </span>
                <h3 className="font-black text-base text-slate-900 dark:text-slate-100">
                  ยกเลิกใบเสนอราคา
                </h3>
              </div>
            </AppModalHeader>

            <AppModalBody className="space-y-3">
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-1">
                <p>ลูกค้า: <strong>{quotationForRelease.customerName}</strong></p>
                <p>ช่วงเวลาเช่า: <strong className="font-mono">{quotationForRelease.rentalStartDate} ถึง {quotationForRelease.rentalEndDate}</strong></p>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  สาเหตุ *
                </label>
                <CustomSelect
                  value={releaseTargetStatus}
                  onChange={(value) => setReleaseTargetStatus(value as typeof releaseTargetStatus)}
                  options={[
                    { value: 'CANCELLED', label: 'ร้านยกเลิกใบเสนอราคา' },
                    { value: 'REJECTED', label: 'ลูกค้าปฏิเสธ' },
                  ]}
                />
              </div>


              {releaseError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs">
                  {releaseError}
                </div>
              )}
            </AppModalBody>

            <AppModalFooter>
              <button
                type="button"
                disabled={isReleasing}
                onClick={handleCloseReleaseModal}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-700 disabled:opacity-50 cursor-pointer`}
              >
                ยกเลิก
              </button>

              <button
                type="button"
                disabled={isReleasing}
                onClick={handleConfirmRelease}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-500/30 flex items-center disabled:opacity-50 cursor-pointer`}
              >
                {isReleasing ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                <span>ยืนยันยกเลิก</span>
              </button>
            </AppModalFooter>
        </AppModal>
      )}

      <QuotationPreviewOverlay pages={previewPages} onClose={closeQuotationPreview} />
    </div>
  )
}
