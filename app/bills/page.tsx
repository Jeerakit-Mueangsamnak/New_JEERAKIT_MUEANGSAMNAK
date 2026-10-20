'use client'

import { useActionPermission, NO_ACTION_PERMISSION_TITLE } from '@/features/auth/hooks/useActionPermission'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { printRentalBillA4 } from '@/features/documents/utils/rental-bill-print'
import { BillPreviewOverlay } from '@/features/bills/components/BillPreviewOverlay'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import React, { useState } from 'react'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
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
import { cancelOrVoidBill, cancelBill, confirmBill } from '@/features/bills/services/bill-service'
import {
  getBillListReturnDate,
  getBillOverdueDays,
  getBillPaymentPresentation,
  getRentalStatusPresentation,
  isCancelledOrVoidBill,
  isExtensionBill,
  isOwingBill,
} from '@/features/bills/utils/bill-list-presentation'
import { isPinCancelled } from '@/lib/db/pin-confirm'
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
import { ActionButton } from '@/components/common/ActionButton'
import { DataTableFrame, DATA_TABLE_THEAD_CLASSES, DATA_TABLE_TH_CLASSES } from '@/components/common/DataTableFrame'
import { useAutoFitPageSize } from '@/lib/hooks/useAutoFitPageSize'

export default function BillsPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const confirmDialog = useConfirm()
  const { settings: systemSettings } = useSystemSettings()
  const [bills, setBills] = useState<FullBill[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [billLoadError, setBillLoadError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [rentalFilter, setRentalFilter] = useState<string>('ALL')
  const [paymentFilter, setPaymentFilter] = useState<string>('ALL')

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const statusParam = new URLSearchParams(window.location.search).get('status')
      if (statusParam === 'DRAFT') {
        setRentalFilter('DRAFT')
      }
    }
  }, [])

  // Modals State
  const [selectedBillForLog, setSelectedBillForLog] = useState<FullBill | null>(null)
  const [selectedBillForLine, setSelectedBillForLine] = useState<FullBill | null>(null)
  
  // Workflow State
  const [selectedRowBill, setSelectedRowBill] = useState<FullBill | null>(null)

  const [activeWorkflow, setActiveWorkflow] = useState<'RETURN' | 'PAYMENT' | 'CORRECTION' | 'EXTENSION' | null>(null)
  const [showDepositRefund, setShowDepositRefund] = useState(false)
  const [showPaymentRefund, setShowPaymentRefund] = useState(false)
  const [showDelivery, setShowDelivery] = useState(false)
  const [selectedBillForDispatch, setSelectedBillForDispatch] = useState<FullBill | null>(null)

  // Cancel Modal State
  const [selectedBillForCancel, setSelectedBillForCancel] = useState<FullBill | null>(null)
  // UI hint only; the server checks menu -> OWNER grant -> PIN on every call.
  const canAction = useActionPermission()
  const [cancelReason, setCancelReason] = useState<string>('')
  const [isCancellingBill, setIsCancellingBill] = useState(false)
  const openCancelBill = (bill: FullBill) => {
    setCancelReason('')
    setSelectedBillForCancel(bill)
  }
  const closeCancelBill = () => {
    setSelectedBillForCancel(null)
    setCancelReason('')
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
      setBillLoadError(error instanceof Error ? error.message : String(error))
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

    let matchesRental = true
    if (rentalFilter === 'RENTING') matchesRental = b.rentalStatus === 'RENTING'
    else if (rentalFilter === 'CONFIRMED') matchesRental = b.rentalStatus === 'CONFIRMED'
    else if (rentalFilter === 'EXTENDED') matchesRental = isExtensionBill(b)
    else if (rentalFilter === 'OVERDUE') matchesRental = isOverdueBill(b)
    else if (rentalFilter === 'PARTIAL_RETURNED') matchesRental = b.rentalStatus === 'PARTIAL_RETURNED'
    else if (rentalFilter === 'RETURNED') matchesRental = b.rentalStatus === 'RETURNED'
    else if (rentalFilter === 'CLOSED') matchesRental = b.rentalStatus === 'CLOSED'
    else if (rentalFilter === 'DRAFT') matchesRental = b.rentalStatus === 'DRAFT'
    else if (rentalFilter === 'CANCELLED') matchesRental = b.rentalStatus === 'CANCELLED'
    else if (rentalFilter === 'VOID') matchesRental = b.rentalStatus === 'VOID'

    let matchesPayment = true
    if (paymentFilter === 'PAID') matchesPayment = b.paymentStatus === 'PAID'
    else if (paymentFilter === 'PARTIAL') matchesPayment = b.paymentStatus === 'PARTIAL'
    else if (paymentFilter === 'UNPAID') matchesPayment = isOwingBill(b) && b.paymentStatus === 'UNPAID'
    else if (paymentFilter === 'REFUND_PARTIAL') matchesPayment = b.paymentStatus === 'REFUND_PARTIAL'
    else if (paymentFilter === 'REFUNDED') matchesPayment = b.paymentStatus === 'REFUNDED'

    return matchesSearch && matchesRental && matchesPayment
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
  }, [searchTerm, rentalFilter, paymentFilter, setBillsCurrentPage])

  const paginatedBills = filteredBills.slice(0, billsEndIndex)

  // Metrics
  const rentingCount = bills.filter((b) => ['RENTING', 'PARTIAL_RETURNED'].includes(b.rentalStatus)).length
  const overdueCount = bills.filter((b) => isOverdueBill(b)).length
  const unpaidCount = bills.filter((b) => isOwingBill(b) && b.paymentStatus !== 'PAID').length
  const closedCount = bills.filter((b) => b.rentalStatus === 'CLOSED').length
  const draftCount = bills.filter((b) => b.rentalStatus === 'DRAFT').length

  const handleConfirmCancelBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedBillForCancel || !cancelReason.trim() || isCancellingBill) return

    const trimmedReason = cancelReason.trim()
    // A confirmed bill is cancelled / voided only by a member granted BILL_VOID (the server checks it too)
    if (selectedBillForCancel.serverStatus !== 'DRAFT' && !canAction('BILL_VOID')) {
      showToast('ไม่มีสิทธิ์ยกเลิกบิลนี้', NO_ACTION_PERMISSION_TITLE, 'ERROR')
      return
    }
    setIsCancellingBill(true)
    try {
      await cancelOrVoidBill(selectedBillForCancel, trimmedReason)

      const updatedBills = fetchBills()
      setBills(updatedBills)

      showToast('ยกเลิกบิลสำเร็จ', `ยกเลิกบิล ${selectedBillForCancel.billNo} เรียบร้อยแล้ว`, 'SUCCESS')
      setSelectedBillForCancel(null)
      setCancelReason('')
      setSelectedRowBill(null)
    } catch (err: any) {
      if (isPinCancelled(err)) return
      showToast('เกิดข้อผิดพลาดในการยกเลิกบิล', err?.message || 'ไม่สามารถยกเลิกบิลได้', 'ERROR')
    } finally {
      setIsCancellingBill(false)
    }
  }

  // Double-click a bill row: real-size A4 preview of the bill (same template as print).
  const [previewBill, setPreviewBill] = useState<FullBill | null>(null)
  const closeBillPreview = React.useCallback(() => setPreviewBill(null), [])
  const openBillPreview = (e: React.MouseEvent, b: FullBill) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    window.getSelection()?.removeAllRanges()
    setPreviewBill(b)
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-2 gap-2 bg-slate-100 dark:bg-slate-900 text-xs">

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
              initialMode={activeWorkflow}
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
          {/* Summary Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 sm:gap-2 shrink-0">
            <div className="bg-blue-50/60 dark:bg-blue-950/40 p-2 sm:p-2.5 rounded-xl border border-blue-200 dark:border-blue-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] sm:text-[11px] text-blue-700 dark:text-blue-300 font-semibold">กำลังเช่าอยู่</span>
                <h3 className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400 mt-0.5">{rentingCount} บิล</h3>
              </div>
              <div className="p-1.5 bg-blue-100 dark:bg-blue-900/50 rounded-lg text-blue-600 dark:text-blue-300">
                <Clock className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="bg-red-50/60 dark:bg-red-950/40 p-2 sm:p-2.5 rounded-xl border border-red-200 dark:border-red-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] sm:text-[11px] text-red-700 dark:text-red-300 font-semibold">เกินกำหนดคืน</span>
                <h3 className="text-base sm:text-lg font-black text-red-600 dark:text-red-400 mt-0.5">{overdueCount} บิล</h3>
              </div>
              <div className="p-1.5 bg-red-100 dark:bg-red-900/50 rounded-lg text-red-600 dark:text-red-300">
                <ShieldAlert className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="bg-amber-50/60 dark:bg-amber-950/40 p-2 sm:p-2.5 rounded-xl border border-amber-200 dark:border-amber-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] sm:text-[11px] text-amber-700 dark:text-amber-300 font-semibold">ค้างชำระ</span>
                <h3 className="text-base sm:text-lg font-black text-amber-600 dark:text-amber-400 mt-0.5">{unpaidCount} บิล</h3>
              </div>
              <div className="p-1.5 bg-amber-100 dark:bg-amber-900/50 rounded-lg text-amber-600 dark:text-amber-300">
                <AlertCircle className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="bg-emerald-50/60 dark:bg-emerald-950/40 p-2 sm:p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] sm:text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">ปิดบิลแล้ว</span>
                <h3 className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{closedCount} บิล</h3>
              </div>
              <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
            {/* Filter Toolbar */}
          <div className="p-2 sm:p-2.5 border-b border-slate-200 dark:border-slate-700 flex flex-col gap-2 shrink-0">
            {/* Row 1: Search & Filter Dropdowns */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="ค้นหาเลขบิล, ชื่อลูกค้า หรือ เบอร์โทรศัพท์..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full h-9 pl-10 pr-4 py-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="w-36 sm:w-44">
                  <CustomSelect
                    value={rentalFilter}
                    onChange={(val) => setRentalFilter(String(val))}
                    options={[
                      { value: 'ALL', label: 'สถานะเช่า: ทั้งหมด' },
                      { value: 'DRAFT', label: `แบบร่าง (${draftCount})` },
                      { value: 'CONFIRMED', label: 'ยืนยันแล้ว / รอส่งของ' },
                      { value: 'RENTING', label: 'เปิดอยู่ / กำลังเช่า' },
                      { value: 'EXTENDED', label: 'เช่าต่อ' },
                      { value: 'OVERDUE', label: 'เกินกำหนดคืน' },
                      { value: 'PARTIAL_RETURNED', label: 'คืนบางส่วน' },
                      { value: 'RETURNED', label: 'คืนครบแล้ว' },
                      { value: 'CLOSED', label: 'ปิดบิลแล้ว' },
                      { value: 'CANCELLED', label: 'ยกเลิกบิล' },
                      { value: 'VOID', label: 'โมฆะ (VOID)' },
                    ]}
                    align="left"
                    direction="down"
                  />
                </div>

                <div className="w-36 sm:w-44">
                  <CustomSelect
                    value={paymentFilter}
                    onChange={(val) => setPaymentFilter(String(val))}
                    options={[
                      { value: 'ALL', label: 'การชำระ: ทั้งหมด' },
                      { value: 'PAID', label: 'ชำระแล้ว' },
                      { value: 'PARTIAL', label: 'ชำระบางส่วน' },
                      { value: 'UNPAID', label: 'ค้างชำระ' },
                      { value: 'REFUND_PARTIAL', label: 'คืนเงินบางส่วน' },
                      { value: 'REFUNDED', label: 'คืนเงินแล้ว' },
                    ]}
                    align="left"
                    direction="down"
                  />
                </div>
              </div>
            </div>

            {/* Row 2: Action Buttons (Responsive with smooth horizontal scroll) */}
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-700/60 pt-2 gap-2 overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-1.5 shrink-0">
                {selectedRowBill?.rentalStatus === 'DRAFT' ? (
                  <>
                    <ActionButton
                      onClick={() => router.push(`/pos?draftBillId=${selectedRowBill.id}`)}
                      variant="info"
                      icon={<FileEdit className="w-3.5 h-3.5" />}
                      title="เปิดแบบร่างใน POS เพื่อแก้ไข"
                    >
                      แก้ไขแบบร่าง
                    </ActionButton>

                    <ActionButton
                      onClick={async () => {
                        if (await confirmDialog({ title: `ยืนยันการเปิดบิลจากแบบร่าง ${selectedRowBill.billNo} ใช่หรือไม่?` })) {
                          try {
                            await confirmBill(selectedRowBill.id)
                            showToast('ยืนยันบิลสำเร็จ', `ยืนยันบิล ${selectedRowBill.billNo} เรียบร้อยแล้ว`, 'SUCCESS')
                            await loadBills()
                          } catch (err: any) {
                            showToast('เกิดข้อผิดพลาด', err.message || 'ไม่สามารถยืนยันบิลได้', 'ERROR')
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
                        onClick={async () => {
                          if (await confirmDialog({ title: `คุณต้องการลบแบบร่าง ${selectedRowBill.billNo} หรือไม่?` })) {
                            try {
                              await cancelBill(selectedRowBill.id, 'ลบแบบร่าง')
                              showToast('ลบแบบร่างสำเร็จ', `ลบแบบร่าง ${selectedRowBill.billNo} เรียบร้อยแล้ว`, 'SUCCESS')
                              setSelectedRowBill(null)
                              await loadBills()
                            } catch (err: any) {
                              showToast('เกิดข้อผิดพลาด', err.message || 'ไม่สามารถลบแบบร่างได้', 'ERROR')
                            }
                          }
                        }}
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
                    {/* Action Button 1: รับคืนสินค้า */}
                    {/* Cancelled / void bills hold no goods: no return from them (the server refuses too). */}
                    <ActionButton
                      disabled={!selectedRowBill || isCancelledOrVoidBill(selectedRowBill)}
                      onClick={() => setActiveWorkflow('RETURN')}
                      variant={selectedRowBill && !isCancelledOrVoidBill(selectedRowBill) ? 'primary' : 'neutral'}
                      icon={<RefreshCw className="w-3.5 h-3.5" />}
                      title={
                        selectedRowBill && isCancelledOrVoidBill(selectedRowBill)
                          ? 'บิลยกเลิก/โมฆะ รับคืนสินค้าไม่ได้'
                          : 'รับคืนสินค้าจากลูกค้า'
                      }
                    >
                      รับคืนสินค้า
                    </ActionButton>
                    
                    {/* Action Button 2: รับชำระเงิน */}
                    <ActionButton
                      disabled={!selectedRowBill}
                      onClick={() => setActiveWorkflow('PAYMENT')}
                      variant={selectedRowBill ? 'info' : 'neutral'}
                      icon={<AlertCircle className="w-3.5 h-3.5" />}
                      title="บันทึกรับชำระเงิน"
                    >
                      รับชำระเงิน
                    </ActionButton>

                    <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

                    <ActionButton
                      disabled={!selectedRowBill || !['RENTING', 'PARTIAL_RETURNED'].includes(selectedRowBill.rentalStatus)}
                      onClick={() => setActiveWorkflow('CORRECTION')}
                      variant={selectedRowBill && ['RENTING', 'PARTIAL_RETURNED'].includes(selectedRowBill.rentalStatus) ? 'outline' : 'neutral'}
                      className={selectedRowBill && ['RENTING', 'PARTIAL_RETURNED'].includes(selectedRowBill.rentalStatus) ? '!bg-violet-600 hover:!bg-violet-700 !text-white !border-transparent' : ''}
                      icon={<Edit3 className="w-3.5 h-3.5" />}
                      title="แก้ไขรายการในบิล"
                    >
                      แก้ไขบิล
                    </ActionButton>

                    <ActionButton
                      disabled={!selectedRowBill || selectedRowBill.deliveryStatus === 'DELIVERED' || !['CONFIRMED', 'ACTIVE'].includes(selectedRowBill.serverStatus || '')}
                      onClick={() => setShowDelivery(true)}
                      variant="outline"
                      icon={<Truck className="w-3.5 h-3.5" />}
                      title="บันทึกส่งของให้ลูกค้า (ส่งบางส่วนได้)"
                    >
                      ส่งของ
                    </ActionButton>

                    <ActionButton
                      disabled={!selectedRowBill || !['RENTING', 'PARTIAL_RETURNED'].includes(selectedRowBill.rentalStatus)}
                      onClick={() => setActiveWorkflow('EXTENSION')}
                      variant={selectedRowBill && ['RENTING', 'PARTIAL_RETURNED'].includes(selectedRowBill.rentalStatus) ? 'outline' : 'neutral'}
                      className={selectedRowBill && ['RENTING', 'PARTIAL_RETURNED'].includes(selectedRowBill.rentalStatus) ? '!bg-cyan-600 hover:!bg-cyan-700 !text-white !border-transparent' : ''}
                      icon={<CalendarPlus className="w-3.5 h-3.5" />}
                      title="ขยายเวลาเช่าต่อ"
                    >
                      เช่าต่อ
                    </ActionButton>

                    <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

                    <ActionButton
                      disabled={!selectedRowBill}
                      onClick={() => setShowDepositRefund(true)}
                      variant={selectedRowBill && selectedRowBill.heldDepositAmount > 0 ? 'outline' : 'neutral'}
                      className={selectedRowBill && selectedRowBill.heldDepositAmount > 0 ? '!bg-amber-600 hover:!bg-amber-700 !text-white !border-transparent' : ''}
                      icon={<WalletCards className="w-3.5 h-3.5" />}
                      title="ดู/แก้ไขยอดมัดจำของบิล (ระบบไม่หักหรือคืนให้อัตโนมัติ)"
                    >
                      มัดจำ
                    </ActionButton>

                    <ActionButton
                      disabled={!selectedRowBill || selectedRowBill.paidAmount <= 0 || !canAction('REFUND')}
                      onClick={() => setShowPaymentRefund(true)}
                      variant={selectedRowBill && selectedRowBill.paidAmount > 0 ? 'danger' : 'neutral'}
                      icon={<Receipt className="w-3.5 h-3.5" />}
                      title={canAction('REFUND') ? 'คืนเงินรับชำระ' : NO_ACTION_PERMISSION_TITLE}
                    >
                      คืนเงินรับชำระ
                    </ActionButton>
                    <ActionButton
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

              {selectedRowBill && (
                <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] shrink-0 font-medium text-slate-600 dark:text-slate-300">
                  <span className="text-slate-400">เลือกบิล:</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{selectedRowBill.billNo}</span>
                  <span className="truncate max-w-[120px]">({selectedRowBill.customerName})</span>
                </div>
              )}
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
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-400 dark:border-amber-700 font-bold hover:bg-amber-100 dark:hover:bg-amber-900"
              >
                <RefreshCw className="w-3 h-3" />
                ลองอีกครั้ง
              </button>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-16 text-slate-400">
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
                  onClick={() => setSelectedRowBill(b)}
                  onDoubleClick={(e) => openBillPreview(e, b)}
                  className={`p-3 rounded-2xl border shadow-sm space-y-2.5 cursor-pointer transition-all ${selectedRowBill?.id === b.id ? 'bg-emerald-50/50 dark:bg-emerald-900/20 border-emerald-500/50' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-mono font-bold text-sm text-blue-600 dark:text-blue-400 block">
                        {b.billNo}
                      </span>
                      <span className="text-[11px] text-slate-400 block">วันที่ออกบิล: {b.billDate}</span>
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
                      <span className="text-slate-400 block text-[10px]">ลูกค้า:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 block truncate">
                        {b.customerName}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">{b.customerPhone}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">กำหนดคืน:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 block">
                        {getBillListReturnDate(b)}
                      </span>
                      {overdueDays > 0 && (
                        <span className="text-[10px] font-bold text-red-600 block">
                          เกิน {overdueDays} วัน
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block">ยอดสุทธิ / ค้างชำระ:</span>
                      <span className="font-black text-slate-900 dark:text-slate-100">
                        ฿{b.grandTotal.toLocaleString()}
                      </span>
                      {b.outstandingAmount > 0 && (
                        <span className="text-red-600 font-bold ml-1 text-[11px]">
                          (คงค้าง ฿{b.outstandingAmount.toLocaleString()})
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
                            className="p-1.5 rounded-xl text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/60"
                            title="แก้ไขแบบร่างใน POS"
                          >
                            <FileEdit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (await confirmDialog({ title: `ต้องการลบแบบร่าง ${b.billNo} หรือไม่?` })) {
                                try {
                                  await cancelBill(b.id, 'ลบแบบร่าง')
                                  showToast('ลบแบบร่างสำเร็จ', `ลบแบบร่าง ${b.billNo} แล้ว`, 'SUCCESS')
                                  await loadBills()
                                } catch (err: any) {
                                  showToast('เกิดข้อผิดพลาด', err?.message || 'ไม่สามารถลบแบบร่างได้', 'ERROR')
                                }
                              }
                            }}
                            className="p-1.5 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/60"
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
                            className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                            title="ประวัติ"
                          >
                            <History className="w-4 h-4 text-blue-500" />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              printRentalBillA4(b, systemSettings.business)
                            }}
                            className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                            title="พิมพ์บิล (A4)"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedBillForLine(b)
                            }}
                            className="p-1.5 rounded-xl text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/60"
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
                              disabled={b.serverStatus !== 'DRAFT' && !canAction('BILL_VOID')}
                              className="p-1.5 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/60 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={b.serverStatus !== 'DRAFT' && !canAction('BILL_VOID') ? NO_ACTION_PERMISSION_TITLE : 'ยกเลิกบิล'}
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
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-slate-400">
                <Receipt className="w-8 h-8 opacity-40 mb-1" />
                <span className="text-xs font-semibold">ไม่พบรายการบิล</span>
                <span className="text-[10px] mt-1 text-slate-500">ลองปรับตัวกรองหรือเพิ่มบิลใหม่จาก POS</span>
              </div>
            )}
            </div>

            <div className="shrink-0 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500">
              ทั้งหมด {filteredBills.length} รายการ
            </div>
          </div>

          {/* 2. Compact Table View (>= md screens) */}
          <div className="hidden md:flex flex-1 min-h-0 overflow-hidden flex-col justify-between">
            <DataTableFrame
              fill
              scrollRef={billsTableContainerRef}
              rowCount={filteredBills.length}
              shownCount={billsEndIndex}
              className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent"
            >
              <table className="w-full text-left border-collapse text-[10px] leading-tight table-fixed">
                <colgroup>
                  <col className="w-[88px] sm:w-[96px] lg:w-[108px]" />
                  <col className="w-auto" />
                  <col className="w-[74px] sm:w-[82px] lg:w-[90px]" />
                  <col className="w-[48px] sm:w-[54px] lg:w-[60px]" />
                  <col className="w-[68px] sm:w-[78px] lg:w-[86px]" />
                  <col className="w-[68px] sm:w-[78px] lg:w-[86px]" />
                  <col className="w-[68px] sm:w-[78px] lg:w-[86px]" />
                  <col className="w-[64px] sm:w-[72px] lg:w-[80px]" />
                  <col className="w-[64px] sm:w-[72px] lg:w-[80px]" />
                  <col className="w-[58px] sm:w-[76px] lg:w-[104px]" />
                </colgroup>
                <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-500 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 shadow-xs text-xs`}>
                  <tr className="uppercase tracking-wider text-xs">
                    <th className={`px-1 ${DATA_TABLE_TH_CLASSES}`}>เลขที่บิล</th>
                    <th className={`px-1 ${DATA_TABLE_TH_CLASSES}`}>ลูกค้า / เบอร์</th>
                    <th className={`px-1 ${DATA_TABLE_TH_CLASSES}`}>กำหนดคืน</th>
                    <th className={`px-1 text-center ${DATA_TABLE_TH_CLASSES}`}>วันเกิน</th>
                    <th className={`px-1 text-right ${DATA_TABLE_TH_CLASSES}`}>ยอดสุทธิ</th>
                    <th className={`px-1 text-right ${DATA_TABLE_TH_CLASSES}`}>ชำระแล้ว</th>
                    <th className={`px-1 text-right ${DATA_TABLE_TH_CLASSES}`}>คงค้าง</th>
                    <th className={`px-1 text-center ${DATA_TABLE_TH_CLASSES}`}>สถานะเช่า</th>
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
                        onClick={() => setSelectedRowBill(b)}
                        onDoubleClick={(e) => openBillPreview(e, b)}
                        className={`transition-colors cursor-pointer ${selectedRowBill?.id === b.id ? 'bg-emerald-50/50 dark:bg-emerald-900/20 ring-1 ring-inset ring-emerald-500/30' : 'hover:bg-slate-50/80 dark:hover:bg-slate-700/30'}`}
                      >
                        <td className="px-1 py-1.5 font-bold font-mono text-blue-600 dark:text-blue-400 truncate text-[10px]">
                          {b.billNo}
                        </td>
                        <td className="px-1 py-1.5 space-y-px overflow-hidden">
                          <div className="font-bold text-slate-900 dark:text-slate-100 truncate text-[10px]">
                            {b.customerName}
                          </div>
                          <div className="text-slate-500 text-[10px] flex items-center gap-0.5 font-mono truncate">
                            <Phone className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                            <span className="truncate">{b.customerPhone}</span>
                          </div>
                        </td>
                        <td className="px-1 py-1.5 font-semibold text-slate-700 dark:text-slate-300 truncate text-[10px] font-mono">
                          {getBillListReturnDate(b)}
                        </td>
                        <td className="px-1 py-1.5 text-center truncate">
                          {overdue ? (
                            <span className="px-1 py-0.5 rounded-full bg-red-100 text-red-700 font-black text-[10px] whitespace-nowrap">
                              +{overdueDays} วัน
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono text-[10px]">-</span>
                          )}
                        </td>
                        <td className="px-1 py-1.5 text-right font-extrabold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap text-[10px]">
                          ฿{b.grandTotal.toLocaleString('th-TH')}
                        </td>
                        <td className="px-1 py-1.5 text-right text-emerald-600 font-semibold tabular-nums whitespace-nowrap text-[10px]">
                          ฿{b.paidAmount.toLocaleString('th-TH')}
                        </td>
                        <td className="px-1 py-1.5 text-right font-bold text-red-600 tabular-nums whitespace-nowrap text-[10px]">
                          ฿{b.outstandingAmount.toLocaleString('th-TH')}
                        </td>
                        <td className="px-1 py-1.5 text-center truncate">
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
                            <div className="grid grid-cols-3 sm:flex sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push(`/pos?draftBillId=${b.id}`)
                                }}
                                className="inline-flex h-5.5 w-5.5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 items-center justify-center rounded-lg text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/60 transition-colors cursor-pointer"
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
                                        await loadBills()
                                      }
                                    } catch (err: any) {
                                      showToast('เกิดข้อผิดพลาด', err?.message || 'ไม่สามารถยืนยันบิลได้', 'ERROR')
                                    }
                                  }
                                }}
                                className="inline-flex h-5.5 w-5.5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 transition-colors cursor-pointer"
                                title="ยืนยันเปิดบิลจริง"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  if (await confirmDialog({ title: `ต้องการลบแบบร่าง ${b.billNo} หรือไม่?` })) {
                                    try {
                                      await cancelBill(b.id, 'ลบแบบร่าง')
                                      showToast('ลบแบบร่างสำเร็จ', `ลบแบบร่าง ${b.billNo} แล้ว`, 'SUCCESS')
                                      await loadBills()
                                    } catch (err: any) {
                                      showToast('เกิดข้อผิดพลาด', err?.message || 'ไม่สามารถลบแบบร่างได้', 'ERROR')
                                    }
                                  }
                                }}
                                className="inline-flex h-5.5 w-5.5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors cursor-pointer"
                                title="ลบแบบร่าง"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 sm:flex sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedBillForLog(b)
                                }}
                                className="inline-flex h-5.5 w-5.5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                title="ดูประวัติ"
                              >
                                <History className="w-3.5 h-3.5 text-blue-500" />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedBillForLine(b as any)
                                }}
                                className="inline-flex h-5.5 w-5.5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 transition-colors cursor-pointer"
                                title="ส่งการแจ้งเตือน LINE"
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  printRentalBillA4(b, systemSettings.business)
                                }}
                                className="inline-flex h-5.5 w-5.5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer transition-colors"
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
                                  disabled={b.serverStatus !== 'DRAFT' && !canAction('BILL_VOID')}
                                  className="inline-flex h-5.5 w-5.5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={b.serverStatus !== 'DRAFT' && !canAction('BILL_VOID') ? NO_ACTION_PERMISSION_TITLE : 'ยกเลิกบิล'}
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <div className="h-5.5 w-5.5 sm:hidden" />
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {paginatedBills.length === 0 && (
                    <tr data-empty-row="true">
                      <td colSpan={10} className="py-12 text-center text-slate-400 dark:text-slate-500 text-xs">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <Receipt className="w-8 h-8 opacity-40 mb-1" />
                          <span className="font-semibold">ยังไม่มีรายการบิล</span>
                          <span className="text-[11px] text-slate-400">ลองปรับตัวกรองหรือเพิ่มบิลใหม่จาก POS</span>
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
            await loadBills()
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

      {/* Cancel Modal */}
      <AppModal
        isOpen={!!selectedBillForCancel}
        onClose={closeCancelBill}
        size="sm"
      >
        {selectedBillForCancel && (
          <>
            <AppModalHeader
              onClose={closeCancelBill}
              icon={<XCircle className="w-5 h-5 text-red-500" />}
              title={`ยกเลิกบิลเช่า (${selectedBillForCancel.billNo})`}
            />

            <form onSubmit={handleConfirmCancelBill} className="flex-1 min-h-0 flex flex-col">
              <AppModalBody className="space-y-3 text-xs">
                <p className="text-slate-600 dark:text-slate-300">
                  คุณกำลังจะยกเลิกบิลเช่าของ <strong className="text-slate-900 dark:text-slate-100">{selectedBillForCancel.customerName}</strong>
                </p>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-200">
                    ระบุเหตุผลในการยกเลิกบิล <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="เช่น ลูกค้าขอยกเลิกงาน..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-red-500 focus:outline-none"
                    required
                  />
                </div>
              </AppModalBody>

              <AppModalFooter>
                <button
                  type="button"
                  onClick={closeCancelBill}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isCancellingBill}
                  className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs shadow-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  ยืนยันยกเลิกบิล
                </button>
              </AppModalFooter>
            </form>
          </>
        )}
      </AppModal>

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
