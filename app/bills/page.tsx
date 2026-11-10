'use client'

import { useActionPermission, NO_ACTION_PERMISSION_TITLE } from '@/features/auth/hooks/useActionPermission'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { MAIN_BILL_FORM_MISSING, printSavedBill } from '@/features/documents/utils/rental-bill-print'
import { BillPreviewOverlay } from '@/features/bills/components/BillPreviewOverlay'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import React, { useState } from 'react'
import { BillActionView } from '@/features/bills/components/BillActionView'
import { BillRevisionView } from '@/features/bills/components/BillRevisionView'
import { AuditLogViewerModal } from '@/features/bills/components/AuditLogViewerModal'
import { LineNotifyModal } from '@/features/bills/components/LineNotifyModal'
import { DepositModal } from '@/features/bills/components/DepositRefundModal'
import { DeliveryModal } from '@/features/bills/components/DeliveryModal'
import { PaymentRefundModal } from '@/features/bills/components/PaymentRefundModal'
import { AppointmentDispatchModal } from '@/features/appointments/components/AppointmentDispatchModal'
import { useToast } from '@/components/common/Toast'
import { useRouter } from 'next/navigation'
import { FullBill, loadBills as fetchBills, fetchBillsFromSupabase, canHardDeleteBill } from '@/features/bills/services/bill-storage'
import { cancelOrVoidBill, confirmBill, deleteDraftBill } from '@/features/bills/services/bill-service'
import { useDataActions } from '@/components/common/useDataActions'
import {
  getBillListReturnDate,
  getBillOverdueDays,
  getBillPaymentPresentation,
  getRentalStatusPresentation,
  isCancelledOrVoidBill,
  isOwingBill,
} from '@/features/bills/utils/bill-list-presentation'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { dbErrorMessage } from '@/lib/db/rpc'
import {
  Search,
  RefreshCw,
  Printer,
  Clock,
  CheckCircle2,
  ShieldAlert,
  XCircle,
  MessageSquare,
  History,
  AlertCircle,
  Phone,
  Receipt,
  Edit3,
  CalendarPlus,
  WalletCards,
  FileEdit,
  Trash2,
  Truck,
  Send,
} from 'lucide-react'
import { CustomSelect } from '@/components/common/CustomSelect'
import {
  ActionButton,
  COMMAND_BUTTON_SIZE_CLASSES,
  SEARCH_INPUT_CLASSES,
  SEARCH_ICON_CLASSES,
  TABLE_TOOLBAR_CLASSES, TABLE_LINE_COLOUR_CLASSES, ROW_ICON_BUTTON_CLASSES } from '@/components/common/ActionButton'
import { DataTableFrame, DATA_TABLE_CLASSES, DATA_TABLE_THEAD_CLASSES, DATA_TABLE_TH_CLASSES } from '@/components/common/DataTableFrame'
import { useAutoFitPageSize } from '@/lib/hooks/useAutoFitPageSize'

// Only the Bills toolbar uses these compact dimensions; other ActionButton usages stay unchanged.
const BILL_TOOLBAR_BUTTON_CLASSES = 'shrink-0'

export default function BillsPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const confirmDialog = useConfirm()
  const { settings: systemSettings } = useSystemSettings()
  const [bills, setBills] = useState<FullBill[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [billLoadError, setBillLoadError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  // Owner 2026-11-02: one dropdown for bills still in work + one button that shows closed bills only
  // (named "บิลที่ปิดแล้ว" since 2026-11-05; it used to read "บิลทั้งหมด").
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [showClosedBills, setShowClosedBills] = useState(false)

  // Modals State
  const [selectedBillForLog, setSelectedBillForLog] = useState<FullBill | null>(null)
  const [selectedBillForLine, setSelectedBillForLine] = useState<FullBill | null>(null)
  
  // Workflow State
  const [selectedRowBill, setSelectedRowBill] = useState<FullBill | null>(null)

  // A click on unused page space clears the current bill selection. Do not clear on rows,
  // action buttons, fields, links, or dialogs; those controls may need the selected bill.
  const handleOutsideBillClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // A workflow screen (edit / extend / return / pay) needs the selected bill; a click on its blank area must not clear it.
    if (activeWorkflow) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-bill-selectable], button, a, input, select, textarea, label, [role="dialog"], [role="combobox"]')) return
    setSelectedRowBill(null)
  }


  const [activeWorkflow, setActiveWorkflow] = useState<'RETURN' | 'DOCS' | 'CORRECTION' | 'EXTENSION' | null>(null)
  const [showDepositRefund, setShowDepositRefund] = useState(false)
  const [showPaymentRefund, setShowPaymentRefund] = useState(false)
  const [showDelivery, setShowDelivery] = useState(false)
  const [selectedBillForDispatch, setSelectedBillForDispatch] = useState<FullBill | null>(null)

  // UI hint only; the server checks menu -> OWNER grant, the reason, and (for a member) own bill of today.
  const canAction = useActionPermission()
  const { askVoidReason, confirmHardDelete } = useDataActions()
  const [isCancellingBill, setIsCancellingBill] = useState(false)

  // ยกเลิก (void) a confirmed bill: it stays in the list with its number, its money leaves the reports.
  const openCancelBill = async (bill: FullBill) => {
    if (isCancellingBill) return
    if (!canAction('BILL_VOID')) {
      showToast('ไม่มีสิทธิ์ยกเลิกบิลนี้', NO_ACTION_PERMISSION_TITLE, 'ERROR')
      return
    }
    const reason = await askVoidReason(bill.billNo)
    if (reason === null) return
    setIsCancellingBill(true)
    try {
      const updated = await cancelOrVoidBill(bill, reason)
      // The command already reloaded the list cache: take its bill, and only fall back to a full
      // reload when the server did not return it.
      if (updated) setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
      else await loadBills()
      showToast('ยกเลิกบิลสำเร็จ', `ยกเลิกบิล ${bill.billNo} เรียบร้อยแล้ว`, 'SUCCESS')
      setSelectedRowBill(null)
    } catch (err: any) {
      if (isPinCancelled(err)) return
      showToast('เกิดข้อผิดพลาดในการยกเลิกบิล', dbErrorMessage(err?.message || '') || 'ไม่สามารถยกเลิกบิลได้', 'ERROR')
    } finally {
      setIsCancellingBill(false)
    }
  }

  // ลบ (hard delete) a draft: no number, no stock, no money yet.
  const deleteDraft = async (bill: FullBill) => {
    if (!(await confirmHardDelete(`บิลร่าง ${bill.billNo}`))) return
    try {
      await deleteDraftBill(bill.id)
      showToast('ลบบิลร่างแล้ว', `ลบบิลร่าง ${bill.billNo} ออกจากระบบแล้ว`, 'SUCCESS')
      if (selectedRowBill?.id === bill.id) setSelectedRowBill(null)
      // The draft is gone from the server: drop the row now and refresh the rest in the background.
      setBills((prev) => prev.filter((b) => b.id !== bill.id))
      void loadBills()
    } catch (err: any) {
      showToast('ลบบิลร่างไม่สำเร็จ', dbErrorMessage(err?.message || '') || 'ไม่สามารถลบบิลร่างได้', 'ERROR')
    }
  }

  // Link from a notice: /bills?id=<bill> opens that bill; &send=line opens the LINE send window.
  const [linkedBill, setLinkedBill] = useState<{ id: string; send: boolean } | null>(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    return id ? { id, send: params.get('send') === 'line' } : null
  })
  React.useEffect(() => {
    if (!linkedBill) return
    const bill = bills.find((b) => b.id === linkedBill.id)
    if (!bill) return
    if (linkedBill.send) setSelectedBillForLine(bill)
    else setSelectedRowBill(bill)
    setLinkedBill(null)
  }, [bills, linkedBill])

  const loadBills = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await fetchBillsFromSupabase()
      setBills(data)
      setBillLoadError(null)
    } catch (error) {
      setBills(fetchBills())
      setBillLoadError(dbErrorMessage(error instanceof Error ? error.message : String(error)))
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadBills()
  }, [loadBills])

  // Keep the selected bill in step with every reload, so the toolbar and the modals
  // (delivery, deposit, refund) see the bill's current status and quantities.
  React.useEffect(() => {
    setSelectedRowBill((current) => (current ? bills.find((b) => b.id === current.id) ?? current : current))
  }, [bills])

  const getOverdueDays = (bill: FullBill) => getBillOverdueDays(bill)
  const isOverdueBill = (bill: FullBill) => getOverdueDays(bill) > 0

  // Filtered List
  const filteredBills = bills.filter((b) => {
    const term = searchTerm.toLowerCase()
    const matchesSearch =
      b.billNo.toLowerCase().includes(term) ||
      b.customerName.toLowerCase().includes(term) ||
      b.customerPhone.toLowerCase().includes(term)

    // "บิลที่ปิดแล้ว" button: closed bills only. Otherwise only bills still in work
    // (not closed / cancelled / void), narrowed by the status dropdown.
    if (showClosedBills) return matchesSearch && b.rentalStatus === 'CLOSED'
    if (['CLOSED', 'CANCELLED', 'VOID'].includes(b.rentalStatus)) return false

    let matchesStatus = true
    if (statusFilter === 'PAID') matchesStatus = b.paymentStatus === 'PAID'
    else if (statusFilter === 'UNPAID') matchesStatus = b.rentalStatus !== 'DRAFT' && ['UNPAID', 'PARTIAL'].includes(b.paymentStatus)
    else if (statusFilter === 'RETURNED') matchesStatus = b.rentalStatus === 'RETURNED'
    else if (statusFilter === 'NOT_RETURNED') matchesStatus = ['RENTING', 'PARTIAL_RETURNED'].includes(b.rentalStatus)

    return matchesSearch && matchesStatus
  })

  // Bills table: scrolls inside its area, more rows load near the bottom
  const {
    containerRef: billsTableContainerRef,
    setCurrentPage: setBillsCurrentPage,
    endIndex: billsEndIndex,
  } = useAutoFitPageSize({
    defaultRowHeight: 34,
    defaultHeaderHeight: 34,
    totalItems: filteredBills.length,
  })

  // Reset page when search or filters change
  React.useEffect(() => {
    setBillsCurrentPage(1)
  }, [searchTerm, statusFilter, showClosedBills, setBillsCurrentPage])

  const paginatedBills = filteredBills.slice(0, billsEndIndex)

  // Metrics
  const rentingCount = bills.filter((b) => ['RENTING', 'PARTIAL_RETURNED'].includes(b.rentalStatus)).length
  const overdueCount = bills.filter((b) => isOverdueBill(b)).length
  const unpaidCount = bills.filter((b) => isOwingBill(b) && b.paymentStatus !== 'PAID').length
  const closedCount = bills.filter((b) => b.rentalStatus === 'CLOSED').length

  // Double-click a bill row: real-size A4 preview of the bill (same template as print).
  const [previewBill, setPreviewBill] = useState<FullBill | null>(null)
  const closeBillPreview = React.useCallback(() => setPreviewBill(null), [])
  // A saved bill is printed again on the shop's main bill form.
  const printBill = (bill: FullBill) => {
    printSavedBill(bill, systemSettings.business)
      .then((ok) => ok || showToast('พิมพ์บิลไม่ได้', MAIN_BILL_FORM_MISSING, 'ERROR'))
      .catch((err: unknown) => showToast('พิมพ์บิลไม่ได้', err instanceof Error ? err.message : 'โหลดแบบฟอร์มไม่สำเร็จ', 'ERROR'))
  }
  const openBillPreview = (e: React.MouseEvent | React.KeyboardEvent, b: FullBill) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    window.getSelection()?.removeAllRanges()
    setPreviewBill(b)
  }
  // Keyboard on a bill row/card: Space selects it (like a click), Enter opens it (like a double-click).
  const handleBillRowKey = (e: React.KeyboardEvent, b: FullBill) => {
    if (e.target !== e.currentTarget) return
    if (e.key === ' ') {
      e.preventDefault()
      setSelectedRowBill(b)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      setSelectedRowBill(b)
      openBillPreview(e, b)
    }
  }

  return (
    <div onClick={handleOutsideBillClick} className="h-full min-h-0 flex flex-col overflow-hidden p-2 gap-2 bg-slate-100 dark:bg-slate-900 text-xs">

      {activeWorkflow ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {activeWorkflow === 'CORRECTION' || activeWorkflow === 'EXTENSION' ? (
            <BillRevisionView
              bill={selectedRowBill!}
              mode={activeWorkflow}
              onClose={() => {
                setActiveWorkflow(null)
                setSelectedRowBill(null)
              }}
              onSaved={async () => {
                setActiveWorkflow(null)
                setSelectedRowBill(null)
                await loadBills()
              }}
            />
          ) : (
            <BillActionView 
              customerName={selectedRowBill?.customerName || ''}
              bills={bills}
              setBills={setBills}
              initialTab={activeWorkflow}
              initialBillId={selectedRowBill?.id}
              onClose={() => {
                setActiveWorkflow(null)
                setSelectedRowBill(null)
              }}
            />
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
            {/* Summary cards inside the white work area, evenly spread, shared 8px spacing (owner 2026-11-11) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2 pb-0 shrink-0">
              <div className="min-w-0 bg-blue-50/60 dark:bg-blue-950/40 p-2 sm:p-2.5 rounded-xl border border-blue-200 dark:border-blue-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] text-blue-700 dark:text-blue-300 font-semibold">กำลังเช่าอยู่</span>
                  <h3 className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400 mt-0.5">{rentingCount} บิล</h3>
                </div>
                <div className="p-1.5 bg-blue-100 dark:bg-blue-900/50 rounded-lg text-blue-600 dark:text-blue-300">
                  <Clock className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className="min-w-0 bg-red-50/60 dark:bg-red-950/40 p-2 sm:p-2.5 rounded-xl border border-red-200 dark:border-red-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] text-red-700 dark:text-red-300 font-semibold">เกินกำหนดคืน</span>
                  <h3 className="text-base sm:text-lg font-black text-red-700 dark:text-red-400 mt-0.5">{overdueCount} บิล</h3>
                </div>
                <div className="p-1.5 bg-red-100 dark:bg-red-900/50 rounded-lg text-red-700 dark:text-red-300">
                  <ShieldAlert className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className="min-w-0 bg-amber-50/60 dark:bg-amber-950/40 p-2 sm:p-2.5 rounded-xl border border-amber-200 dark:border-amber-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] text-amber-700 dark:text-amber-300 font-semibold">ค้างชำระ</span>
                  <h3 className="text-base sm:text-lg font-black text-amber-700 dark:text-amber-400 mt-0.5">{unpaidCount} บิล</h3>
                </div>
                <div className="p-1.5 bg-amber-100 dark:bg-amber-900/50 rounded-lg text-amber-700 dark:text-amber-300">
                  <AlertCircle className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className="min-w-0 bg-emerald-50/60 dark:bg-emerald-950/40 p-2 sm:p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">ปิดบิลแล้ว</span>
                  <h3 className="text-base sm:text-lg font-black text-emerald-700 dark:text-emerald-400 mt-0.5">{closedCount} บิล</h3>
                </div>
                <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
            {/* Filter Toolbar */}
          <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-col`}>
            {/* Row 1: Search & Filter Dropdowns */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className={SEARCH_ICON_CLASSES} />
                <input
                  type="text"
                  placeholder="ค้นหาเลขบิล, ชื่อลูกค้า หรือ เบอร์โทรศัพท์..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={SEARCH_INPUT_CLASSES}
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="w-36 sm:w-44">
                  <CustomSelect
                    value={statusFilter}
                    onChange={(val) => setStatusFilter(String(val))}
                    disabled={showClosedBills}
                    options={[
                      { value: 'ALL', label: 'ทั้งหมด' },
                      { value: 'PAID', label: 'ชำระแล้ว' },
                      { value: 'UNPAID', label: 'ค้างชำระ' },
                      { value: 'RETURNED', label: 'คืนครบ' },
                      { value: 'NOT_RETURNED', label: 'ค้างคืน' },
                    ]}
                    align="left"
                    direction="down"
                  />
                </div>

                <ActionButton
                  type="button"
                  className="w-36 sm:w-44 justify-center"
                  variant={showClosedBills ? 'active' : 'neutral'}
                  aria-pressed={showClosedBills}
                  onClick={() => setShowClosedBills((v) => !v)}
                  title={showClosedBills ? 'กลับไปดูบิลที่กำลังทำงานอยู่' : 'ดูบิลที่ปิดไปแล้ว'}
                >
                  บิลที่ปิดแล้ว
                </ActionButton>
              </div>
            </div>

            {/* Row 2: One toolbar row even after selecting a bill. On very narrow screens,
                allow horizontal scrolling inside this row rather than wrapping controls. */}
            <div className={`border-t ${TABLE_LINE_COLOUR_CLASSES} pt-2 overflow-x-auto`}>
              <div data-testid="bill-toolbar" className="flex w-max min-w-full flex-nowrap items-center gap-1 shrink-0">
                {selectedRowBill?.rentalStatus === 'DRAFT' ? (
                  <>
                    <ActionButton
                      className={BILL_TOOLBAR_BUTTON_CLASSES}
                      onClick={() => router.push(`/pos?draftBillId=${selectedRowBill.id}`)}
                      variant="info"
                      icon={<FileEdit className="w-3.5 h-3.5" />}
                      title="เปิดแบบร่างใน POS เพื่อแก้ไข"
                    >
                      แก้ไขแบบร่าง
                    </ActionButton>

                    <ActionButton
                      className={BILL_TOOLBAR_BUTTON_CLASSES}
                      onClick={async () => {
                        if (await confirmDialog({ title: `ยืนยันการเปิดบิลจากแบบร่าง ${selectedRowBill.billNo} ใช่หรือไม่?` })) {
                          try {
                            const updated = await confirmBill(selectedRowBill.id)
                            showToast('ยืนยันบิลสำเร็จ', `ยืนยันบิล ${selectedRowBill.billNo} เรียบร้อยแล้ว`, 'SUCCESS')
                            // The command returned the confirmed bill: put it in the list instead of reloading everything.
                            if (updated) setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
                            else await loadBills()
                          } catch (err: any) {
                            showToast('เกิดข้อผิดพลาด', dbErrorMessage(err?.message || '') || 'ไม่สามารถยืนยันบิลได้', 'ERROR')
                          }
                        }
                      }}
                      variant="primary"
                      icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                      title="ยืนยันออกบิลเช่าจริง"
                    >
                      ยืนยันบิล
                    </ActionButton>

                    {canHardDeleteBill(selectedRowBill) && (
                      <ActionButton
                        className={BILL_TOOLBAR_BUTTON_CLASSES}
                        onClick={() => void deleteDraft(selectedRowBill)}
                        variant="danger"
                        icon={<Trash2 className="w-3.5 h-3.5" />}
                        title="ลบแบบร่างนี้ทิ้ง"
                      >
                        ลบแบบร่าง
                      </ActionButton>
                    )}
                  </>
                ) : (
                  <>
                    {/* จัดการบิล: one workspace for return / payment / documents / history of the selected bill.
                        A cancelled / void bill holds no goods, so it opens on the documents tab. */}
                    <ActionButton
                      className={BILL_TOOLBAR_BUTTON_CLASSES}
                      disabled={!selectedRowBill}
                      onClick={() =>
                        setActiveWorkflow(selectedRowBill && isCancelledOrVoidBill(selectedRowBill) ? 'DOCS' : 'RETURN')
                      }
                      variant={selectedRowBill ? 'primary' : 'neutral'}
                      icon={<RefreshCw className="w-3.5 h-3.5" />}
                      title="รับคืนสินค้า รับชำระเงิน เอกสาร และประวัติของบิลที่เลือก"
                    >
                      จัดการบิล
                    </ActionButton>


                    <ActionButton
                      disabled={!selectedRowBill || !['RENTING', 'PARTIAL_RETURNED'].includes(selectedRowBill.rentalStatus)}
                      onClick={() => setActiveWorkflow('CORRECTION')}
                      variant={selectedRowBill && ['RENTING', 'PARTIAL_RETURNED'].includes(selectedRowBill.rentalStatus) ? 'outline' : 'neutral'}
                      className={`${BILL_TOOLBAR_BUTTON_CLASSES} ${selectedRowBill && ['RENTING', 'PARTIAL_RETURNED'].includes(selectedRowBill.rentalStatus) ? '!bg-violet-600 hover:!bg-violet-700 !text-white !border-transparent' : ''}`}
                      icon={<Edit3 className="w-3.5 h-3.5" />}
                      title="แก้ไขรายการในบิล"
                    >
                      แก้ไขบิล
                    </ActionButton>

                    <ActionButton
                      className={BILL_TOOLBAR_BUTTON_CLASSES}
                      disabled={!selectedRowBill || selectedRowBill.deliveryStatus === 'DELIVERED' || !['CONFIRMED', 'ACTIVE'].includes(selectedRowBill.serverStatus || '')}
                      onClick={() => setShowDelivery(true)}
                      variant="outline"
                      icon={<Truck className="w-3.5 h-3.5" />}
                      title="บันทึกส่งของให้ลูกค้า (ส่งบางส่วนได้)"
                    >
                      ส่งของ
                    </ActionButton>




                    <ActionButton
                      className={BILL_TOOLBAR_BUTTON_CLASSES}
                      disabled={!selectedRowBill || selectedRowBill.paidAmount <= 0 || !canAction('REFUND')}
                      onClick={() => setShowPaymentRefund(true)}
                      variant={selectedRowBill && selectedRowBill.paidAmount > 0 ? 'danger' : 'neutral'}
                      icon={<Receipt className="w-3.5 h-3.5" />}
                      title={canAction('REFUND') ? 'คืนเงินรับชำระ' : NO_ACTION_PERMISSION_TITLE}
                    >
                      คืนเงินรับชำระ
                    </ActionButton>
                    <ActionButton
                      className={BILL_TOOLBAR_BUTTON_CLASSES}
                      disabled={!selectedRowBill}
                      onClick={() => setSelectedBillForDispatch(selectedRowBill)}
                      variant={selectedRowBill ? 'outline' : 'neutral'}
                      icon={<Send className="w-3.5 h-3.5" />}
                      title={selectedRowBill ? `สร้างงานจากบิล ${selectedRowBill.billNo}` : 'เลือกบิลก่อนสั่งงาน'}
                    >
                      สั่งงาน
                    </ActionButton>
                  </>
                )}
              </div>

            </div>
          </div>

          {billLoadError && (
            <div role="alert" className="shrink-0 flex items-start justify-between gap-3 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="min-w-0">
                <p className="font-bold">โหลดบิลจาก Supabase ไม่สำเร็จ</p>
                <p className="text-[11px] mt-0.5 break-words">
                  {billLoadError} {bills.length > 0 ? 'กำลังแสดงข้อมูลสำรองในเครื่อง ซึ่งอาจไม่เป็นปัจจุบัน' : 'ยังไม่มีข้อมูลบิลที่แสดงได้'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadBills()}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} shrink-0 inline-flex items-center border border-amber-400 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900`}
              >
                <RefreshCw className="w-3 h-3" />
                ลองอีกครั้ง
              </button>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-16 text-slate-600 dark:text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin mb-3" />
              <span className="text-sm font-semibold">กำลังโหลดข้อมูลบิล...</span>
            </div>
          )}

          {/* Responsive Bills View */}
          {!isLoading && (
            <>
          {/* 1. Mobile Card View (< md screens) */}
          <div className="md:hidden flex-1 min-h-0 overflow-hidden flex flex-col justify-between">
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-2.5 pr-1">
            {filteredBills.map((b) => {
              const overdueDays = getOverdueDays(b)
              const rentalPresentation = getRentalStatusPresentation(b.rentalStatus, overdueDays)
              const paymentPresentation = getBillPaymentPresentation(b)
              const canCancel = !['CLOSED', 'CANCELLED', 'VOID'].includes(b.rentalStatus)

              return (
                <div
                  key={b.id}
                  data-bill-selectable
                  tabIndex={0}
                  onClick={() => setSelectedRowBill(b)}
                  onDoubleClick={(e) => openBillPreview(e, b)}
                  onKeyDown={(e) => handleBillRowKey(e, b)}
                  className={`p-3 rounded-2xl border shadow-sm space-y-2.5 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selectedRowBill?.id === b.id ? 'bg-emerald-50/50 dark:bg-emerald-900/20 border-emerald-500/50' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-mono font-bold text-sm text-blue-600 dark:text-blue-400 block">
                        {b.billNo}
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 block">วันที่ออกบิล: {b.billDate}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${rentalPresentation.className}`}>
                        {rentalPresentation.label}
                      </span>

                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${paymentPresentation.className}`}>
                        {paymentPresentation.label}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-slate-100 dark:border-slate-700/80">
                    <div>
                      <span className="text-slate-600 dark:text-slate-400 block text-[10px]">ลูกค้า:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 block truncate">
                        {b.customerName}
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">{b.customerPhone}</span>
                    </div>
                    <div>
                      <span className="text-slate-600 dark:text-slate-400 block text-[10px]">กำหนดคืน:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 block">
                        {getBillListReturnDate(b)}
                      </span>
                      {overdueDays > 0 && (
                        <span className="text-[10px] font-bold text-red-700 dark:text-red-400 block">
                          เกิน {overdueDays} วัน
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <div>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400 block">ยอดสุทธิ / ค้างชำระ:</span>
                      <span className="font-black text-slate-900 dark:text-slate-100">
                        {b.grandTotal.toLocaleString()}
                      </span>
                      {b.outstandingAmount > 0 && (
                        <span className="text-red-700 dark:text-red-400 font-bold ml-1 text-[11px]">
                          (คงค้าง {b.outstandingAmount.toLocaleString()})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {b.rentalStatus === 'DRAFT' ? (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(`/pos?draftBillId=${b.id}`)
                            }}
                            className="p-1.5 rounded-xl text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/60"
                            title="แก้ไขแบบร่างใน POS"
                          >
                            <FileEdit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              void deleteDraft(b)
                            }}
                            className="p-1.5 rounded-xl text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60"
                            title="ลบแบบร่าง"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedBillForLog(b)
                            }}
                            className="p-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                            title="ประวัติ"
                          >
                            <History className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              printBill(b)
                            }}
                            className="p-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                            title="พิมพ์บิล (A4)"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedBillForLine(b)
                            }}
                            className="p-1.5 rounded-xl text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/60"
                            title="ส่งการแจ้งเตือน LINE"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>

                          {canCancel && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                openCancelBill(b)
                              }}
                              disabled={!canAction('BILL_VOID')}
                              className="p-1.5 rounded-xl text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={!canAction('BILL_VOID') ? NO_ACTION_PERMISSION_TITLE : 'ยกเลิกบิล'}
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {filteredBills.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-slate-600 dark:text-slate-400">
                <Receipt className="w-8 h-8 opacity-40 mb-1" />
                <span className="text-xs font-semibold">ไม่พบรายการบิล</span>
              </div>
            )}
            </div>

            <div className="shrink-0 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400">
              ทั้งหมด {filteredBills.length} รายการ
            </div>
          </div>

          {/* 2. Compact Table View (>= md screens) */}
          <div className="hidden md:flex flex-1 min-h-0 overflow-hidden flex-col justify-between">
            <DataTableFrame
              fill
              bodyClassName="bill-table-x-scroll"
              scrollRef={billsTableContainerRef}
              rowCount={filteredBills.length}
              shownCount={billsEndIndex}
              className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent"
            >
              {/* Shared table layout: like other menus; thead stays sticky inside DataTableFrame. */}
              <table className={`${DATA_TABLE_CLASSES} text-[10px] leading-tight`}>
                <thead className={`${DATA_TABLE_THEAD_CLASSES} border-b border-slate-200 dark:border-slate-700 shadow-sm text-xs`}>
                  <tr className="uppercase tracking-wider text-xs">
                    <th className={`px-1 ${DATA_TABLE_TH_CLASSES}`}>เลขที่บิล</th>
                    <th className={`px-1 ${DATA_TABLE_TH_CLASSES}`}>ลูกค้า / เบอร์</th>
                    <th className={`px-1 ${DATA_TABLE_TH_CLASSES}`}>กำหนดคืน</th>
                    <th className={`px-1 text-center ${DATA_TABLE_TH_CLASSES}`}>วันเกิน</th>
                    <th className={`px-1 text-right ${DATA_TABLE_TH_CLASSES}`}>ยอดสุทธิ</th>
                    <th className={`px-1 text-right ${DATA_TABLE_TH_CLASSES}`}>ชำระแล้ว</th>
                    <th className={`px-1 text-right ${DATA_TABLE_TH_CLASSES}`}>คงค้าง</th>
                    <th className={`pl-3 pr-1 text-center ${DATA_TABLE_TH_CLASSES}`}>สถานะเช่า</th>
                    <th className={`px-1 text-center ${DATA_TABLE_TH_CLASSES}`}>การชำระ</th>
                    <th className={`px-1 text-center ${DATA_TABLE_TH_CLASSES}`}>จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {paginatedBills.map((b) => {
                    const overdueDays = getOverdueDays(b)
                    const overdue = overdueDays > 0
                    const rentalPresentation = getRentalStatusPresentation(b.rentalStatus, overdueDays)
                    const paymentPresentation = getBillPaymentPresentation(b)
                    const isClosed = ['CLOSED', 'CANCELLED', 'VOID'].includes(b.rentalStatus)

                    return (
                      <tr
                        key={b.id}
                        data-bill-selectable
                        tabIndex={0}
                        onClick={() => setSelectedRowBill(b)}
                        onDoubleClick={(e) => openBillPreview(e, b)}
                        onKeyDown={(e) => handleBillRowKey(e, b)}
                        className={`transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${selectedRowBill?.id === b.id ? 'bg-emerald-50/50 dark:bg-emerald-900/20 ring-1 ring-inset ring-emerald-500/30' : 'hover:bg-slate-50/80 dark:hover:bg-slate-700/30'}`}
                      >
                        <td className="px-1 py-1.5 font-bold font-mono text-blue-600 dark:text-blue-400 text-[10px]">
                          <span className="block w-full min-w-0 truncate" title={b.billNo}>{b.billNo}</span>
                        </td>
                        <td className="px-1 py-1.5 space-y-px overflow-hidden">
                          <div className="w-full min-w-0 font-bold text-slate-900 dark:text-slate-100 truncate text-[10px]" title={b.customerName}>
                            {b.customerName}
                          </div>
                          <div className="w-full min-w-0 text-slate-600 dark:text-slate-400 text-[10px] flex items-center gap-0.5 font-mono truncate">
                            <Phone className="w-2.5 h-2.5 text-slate-600 dark:text-slate-400 shrink-0" />
                            <span className="truncate">{b.customerPhone}</span>
                          </div>
                        </td>
                        <td className="px-1 py-1.5 font-semibold text-slate-700 dark:text-slate-300 truncate text-[10px] font-mono">
                          {getBillListReturnDate(b)}
                        </td>
                        <td className="px-1 py-1.5 text-center truncate">
                          {overdue ? (
                            <span className="px-1 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400 font-black text-[10px] whitespace-nowrap">
                              +{overdueDays} วัน
                            </span>
                          ) : (
                            <span className="text-slate-600 dark:text-slate-400 font-mono text-[10px]">-</span>
                          )}
                        </td>
                        <td className="px-1 py-1.5 text-right font-extrabold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap text-[10px]">
                          {b.grandTotal.toLocaleString('th-TH')}
                        </td>
                        <td className="px-1 py-1.5 text-right text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums whitespace-nowrap text-[10px]">
                          {b.paidAmount.toLocaleString('th-TH')}
                        </td>
                        <td className="px-1 py-1.5 text-right font-bold text-red-700 dark:text-red-400 tabular-nums whitespace-nowrap text-[10px]">
                          {b.outstandingAmount.toLocaleString('th-TH')}
                        </td>
                        <td className="pl-3 pr-1 py-1.5 text-center truncate">
                          <span className={`inline-flex px-1 sm:px-1.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${rentalPresentation.className}`}>
                            {overdue ? 'เกินกำหนด' : rentalPresentation.label}
                          </span>
                        </td>
                        <td className="px-1 py-1.5 text-center truncate">
                          <span className={`inline-flex px-1 sm:px-1.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${paymentPresentation.className}`}>
                            {paymentPresentation.label}
                          </span>
                        </td>
                        <td className="px-0.5 sm:px-1 py-1 text-center">
                          {b.rentalStatus === 'DRAFT' ? (
                            <div className="grid grid-cols-3 sm:flex sm:flex-row items-center justify-center gap-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push(`/pos?draftBillId=${b.id}`)
                                }}
                                className={`${ROW_ICON_BUTTON_CLASSES} text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/60`}
                                title="แก้ไขแบบร่างใน POS"
                              >
                                <FileEdit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  if (await confirmDialog({ title: `ยืนยันการเปิดบิลเช่าจากแบบร่าง ${b.billNo}?` })) {
                                    try {
                                      const res = await confirmBill(b.id)
                                      if (res) {
                                        showToast('เปิดบิลสำเร็จ', `แปลงแบบร่าง ${b.billNo} เป็นบิลเช่าเรียบร้อยแล้ว`, 'SUCCESS')
                                        setBills((prev) => prev.map((prevBill) => (prevBill.id === res.id ? res : prevBill)))
                                      }
                                    } catch (err: any) {
                                      showToast('เกิดข้อผิดพลาด', dbErrorMessage(err?.message || '') || 'ไม่สามารถยืนยันบิลได้', 'ERROR')
                                    }
                                  }
                                }}
                                className={`${ROW_ICON_BUTTON_CLASSES} text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/60`}
                                title="ยืนยันเปิดบิลจริง"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void deleteDraft(b)
                                }}
                                className={`${ROW_ICON_BUTTON_CLASSES} text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60`}
                                title="ลบแบบร่าง"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 sm:flex sm:flex-row items-center justify-center gap-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedBillForLog(b)
                                }}
                                className={`${ROW_ICON_BUTTON_CLASSES} text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700`}
                                title="ดูประวัติ"
                              >
                                <History className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedBillForLine(b as any)
                                }}
                                className={`${ROW_ICON_BUTTON_CLASSES} text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/60`}
                                title="ส่งการแจ้งเตือน LINE"
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  printBill(b)
                                }}
                                className={`${ROW_ICON_BUTTON_CLASSES} text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700`}
                                title="พิมพ์บิล (A4)"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>

                              {!isClosed ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openCancelBill(b)
                                  }}
                                  disabled={!canAction('BILL_VOID')}
                                  className={`${ROW_ICON_BUTTON_CLASSES} text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60`}
                                  title={!canAction('BILL_VOID') ? NO_ACTION_PERMISSION_TITLE : 'ยกเลิกบิล'}
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <div className="h-[22px] w-[22px] sm:hidden" />
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {paginatedBills.length === 0 && (
                    <tr data-empty-row="true">
                      <td colSpan={10} className="py-12 text-center text-slate-600 dark:text-slate-400 text-xs">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <Receipt className="w-8 h-8 opacity-40 mb-1" />
                          <span className="font-semibold">ยังไม่มีรายการบิล</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </DataTableFrame>
          </div>
        </>
      )}
    </div>
  </>
)}

      <DeliveryModal
        isOpen={showDelivery && !!selectedRowBill}
        bill={selectedRowBill}
        onClose={() => setShowDelivery(false)}
        onSaved={loadBills}
      />

      <DepositModal
        isOpen={showDepositRefund && !!selectedRowBill}
        bill={selectedRowBill}
        onClose={() => setShowDepositRefund(false)}
        onSaved={loadBills}
      />

      {selectedRowBill && (
        <PaymentRefundModal
          isOpen={showPaymentRefund}
          rentalBillId={selectedRowBill.id}
          billNo={selectedRowBill.billNo}
          onClose={() => setShowPaymentRefund(false)}
          onSuccess={async (message) => {
            showToast('คืนเงินสำเร็จ', message, 'SUCCESS')
            // The server already refreshed the bill cache (refund_pay): no full reload and no loading screen.
            setBills(fetchBills())
          }}
        />
      )}

      {/* Audit Log Modal */}
      {selectedBillForLog && (
        <AuditLogViewerModal
          billId={selectedBillForLog.id}
          billNo={selectedBillForLog.billNo}
          customerName={selectedBillForLog.customerName}
          onClose={() => setSelectedBillForLog(null)}
        />
      )}

      {/* Line Notify Modal */}
      <LineNotifyModal
        isOpen={!!selectedBillForLine}
        onClose={() => setSelectedBillForLine(null)}
        billData={
          selectedBillForLine
            ? {
              id: selectedBillForLine.id,
              billNo: selectedBillForLine.billNo,
              customerName: selectedBillForLine.customerName,
              customerPhone: selectedBillForLine.customerPhone,
              returnDate: selectedBillForLine.scheduledReturnDate,
              grandTotal: selectedBillForLine.grandTotal,
              outstandingAmount: selectedBillForLine.outstandingAmount,
              rentalStatus: selectedBillForLine.rentalStatus,
            }
            : null
        }
      />

      <BillPreviewOverlay bill={previewBill} business={systemSettings.business} onClose={closeBillPreview} />
      {selectedBillForDispatch && (
        <AppointmentDispatchModal
          sourceBill={selectedBillForDispatch}
          onClose={() => setSelectedBillForDispatch(null)}
          onDispatched={(_appointments, outcome, driver) => {
            showToast(
              outcome.lineSent ? 'สั่งงานและส่งเข้า LINE คนขับแล้ว' : 'บันทึกการสั่งงานแล้ว',
              outcome.lineSent ? driver.name : `${driver.name} · ยังไม่ได้ส่งทาง LINE (${outcome.lineNote})${driver.phone ? ` แจ้งทางโทร ${driver.phone}` : ''}`,
              'SUCCESS'
            )
            if (outcome.withdrawNote) showToast('ถอนงานพนักงานคนเดิม', outcome.withdrawNote, 'INFO')
            setSelectedBillForDispatch(null)
          }}
        />
      )}
    </div>
  )
}
