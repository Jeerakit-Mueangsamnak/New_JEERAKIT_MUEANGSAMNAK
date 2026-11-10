'use client'
import { COMMAND_BUTTON_SIZE_CLASSES, StepNavButton } from '@/components/common/ActionButton'

import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { printReactDocuments } from '@/lib/print/print-react'
import React, { useState, useMemo, useEffect } from 'react'
import {
  FullBill,
  ReturnInspectionItem,
  ReturnCalculationResult,
} from '@/lib/types/rental-return'
import {
  DollarSign,
  ChevronLeft,
  ChevronRight,
  FileCheck,
} from 'lucide-react'
import { getLocalDateString } from '@/components/common/CustomDatePicker'
import { NumericInput } from '@/components/common/NumericInput'
import { A4FitPreview } from '@/features/pos/components/A4FitPreview'
import { PaymentMethodSelector, PaymentMethodType } from '@/features/pos/components/payment/PaymentMethodSelector'
import { PaymentDynamicContent } from '@/features/pos/components/payment/PaymentDynamicContent'
import { useToast } from '@/components/common/Toast'
import { PostSavePrintModal } from '@/components/common/PostSavePrintModal'
import { BusinessSettings } from '@/lib/types/rental-pos'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { applyDepositToBill, chargeExtraRounds, correctBill, createContinuation, processReturn, receivePayment, refundDeposit, refundOverpayment } from '@/features/bills/services/bill-service'
import { useConfirm, useNotice } from '@/components/common/ConfirmDialogProvider'
import { useSplitPayment } from '@/features/pos/hooks/useSplitPayment'
import { allocateTenders, type Tender } from '@/features/pos/services/split-payment'
import { QrPaymentDialog } from '@/features/pos/components/payment/QrPaymentDialog'
import { fullBillToTemplateData, type BillTemplateData } from '@/features/documents/utils/rental-bill-print'
import { buildContinuationLine, formatBaht } from '@/features/bills/utils/bill-workspace'
import { refreshBillsCache } from '@/features/bills/services/bill-storage'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { dbErrorMessage } from '@/lib/db/rpc'
import { ReturnTableStep } from '@/features/bills/components/ReturnTableStep'
import type { ReturnQuantityField } from '@/features/bills/components/ReturnTableStep'
import { BillWorkspaceHeader, type BillWorkspaceTab } from '@/features/bills/components/BillWorkspaceHeader'
import { BillRecordsTab } from '@/features/bills/components/BillRecordsTab'
import { isCancelledOrVoidBill } from '@/features/bills/utils/bill-list-presentation'
import { loadProducts } from '@/features/products/services/product-storage'
import {
  computeReturnCalculation,
  chargedExtraRounds,
  extraRoundsOf,
  extraRoundsFeeOf,
} from '@/features/bills/services/return-calculation'
import { refreshSharedTemplates } from '@/features/documents/services/template-library-storage'
import {
  FINE_FORM_NAME,
  MAIN_BILL_FORM_NAME,
  pickBillFormTemplate,
  RECEIPT_FORM_NAME,
  renderBillFormPagesHtml,
  renderFineFormPagesHtml,
  renderReturnFormPagesHtml,
  RETURN_FORM_NAME,
} from '@/features/documents/utils/transaction-print'
import type { DocumentTemplate } from '@/lib/types/document'

interface RentalBillingConfig {
  allowPartialReturn?: boolean
  allowContinueAfterPaid?: boolean
  [key: string]: unknown
}

const rentalBilling: RentalBillingConfig = {
  allowPartialReturn: true,
  allowContinueAfterPaid: true,
}

const getReturnedQty = (item: ReturnInspectionItem) =>
  (item.normalQty || 0) + (item.damagedQty || 0) + (item.lostQty || 0) || (item.returnQty || 0)

const getItemDamageFee = (item: ReturnInspectionItem) =>
  (item.damagedQty || 0) * (item.repairFeePerUnit || 0) +
  (item.lostQty || 0) * (item.replacementFeePerUnit || 0)

type ReturnDocType = 'RETURN_SLIP' | 'FINE_SLIP' | 'RECEIPT' | 'CONTINUATION_BILL'

/** The shop form each paper of the return is printed on. */
const RETURN_DOC_FORM_NAME: Record<ReturnDocType, string> = {
  RETURN_SLIP: RETURN_FORM_NAME,
  FINE_SLIP: FINE_FORM_NAME,
  RECEIPT: RECEIPT_FORM_NAME,
  CONTINUATION_BILL: MAIN_BILL_FORM_NAME,
}

/** One A4 page of a shop form (renderDocumentTemplate already sanitizes its HTML). */
function ReturnFormPage({ html }: { html: string }) {
  return <div className="h-full w-full bg-white p-8 font-sans text-xs text-slate-900" dangerouslySetInnerHTML={{ __html: html }} />
}

interface BillActionViewProps {
  customerName: string
  bills: FullBill[]
  setBills: React.Dispatch<React.SetStateAction<FullBill[]>>
  initialTab: 'RETURN' | 'DOCS'
  initialBillId?: string
  onClose: () => void
}

export function BillActionView({
  customerName,
  bills,
  setBills,
  initialTab,
  initialBillId,
  onClose,
}: BillActionViewProps) {
  const { showToast } = useToast()
  const confirmDialog = useConfirm()
  const { user } = useAuth()
  const { settings: systemSettings } = useSystemSettings()
  const business: Partial<BusinessSettings> = systemSettings.business

  const printDocuments = async (docs: React.ReactNode[], options?: { title?: string }) => {
    if (!printReactDocuments(docs, options?.title)) {
      showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
    }
  }

  // The workspace opens on the tab the caller asked for. Return steps: 1 = table, 2 = preview + payment.
  const [tab, setTab] = useState<BillWorkspaceTab>(initialTab)
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [selectedBillId, setSelectedBillId] = useState<string | null>(() => {
    if (initialBillId) return initialBillId
    const matching = bills.filter((b) => b.customerName === customerName)
    return matching.length === 1 ? matching[0].id : (bills[0]?.id || null)
  })
  const [returnDocIndex, setReturnDocIndex] = useState<number>(0)


  // Saved return & payment document numbers for accurate post-save printing
  // Documents as they looked at the moment of saving (the form resets once the bill is refreshed)
  const [printDocs, setPrintDocs] = useState<React.ReactNode[] | null>(null)
  // Deposit row of the payment summary: nothing / return part of it / add to it
  const [depositAction, setDepositAction] = useState<'NONE' | 'REFUND' | 'ADD'>('NONE')
  const [depositAmount, setDepositAmount] = useState<number>(0)
  // How the deposit is given back (คืน)
  const [depositRefundMethod, setDepositRefundMethod] = useState<'CASH' | 'TRANSFER'>('CASH')
  const [savedReturnInfo, setSavedReturnInfo] = useState<{
    returnNo?: string
    receiptNo?: string
    paidAmount?: number
    depositApplied?: number
    depositLeft?: number
  } | null>(null)
  // Post-Save Print Confirmation Modal State
  const [postSavePrintModal, setPostSavePrintModal] = useState<{
    isOpen: boolean
    title: string
    description: string
  }>({
    isOpen: false,
    title: '',
    description: '',
  })

  // Full-screen / Full-area Preview Overlay State

  // Active Bill Selection
  const customerBills = useMemo(() => {
    return bills.filter((b) => b.customerName === customerName)
  }, [bills, customerName])

  const activeBill = useMemo(() => {
    return bills.find((b) => b.id === selectedBillId) || null
  }, [bills, selectedBillId])

  // --- Header Dates State ---
  const [billRentalStartDate, setBillRentalStartDate] = useState<string>('')
  const [billScheduledReturnDate, setBillScheduledReturnDate] = useState<string>('')

  // --- Return Dates & Items State ---
  const [actualReturnDate, setActualReturnDate] = useState<string>('')
  const [paymentDate, setPaymentDate] = useState<string>('')
  const [inspectionItems, setInspectionItems] = useState<ReturnInspectionItem[]>([])

  // --- Return State / Payment State ---
  const [deductFromDeposit, setDeductFromDeposit] = useState<boolean>(false)
  const [userCollectedAmount, setUserCollectedAmount] = useState<number>(0)
  const [paymentChannel, setPaymentChannel] = useState<PaymentMethodType | null>(null)
  const [receivedCashInput, setReceivedCashInput] = useState<string>('')
  const [bankRef, setBankRef] = useState<string>('')
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('')
  const [isQrLoading, setIsQrLoading] = useState<boolean>(false)

  const promptPayId = business?.promptPayValue || ''

  // --- Submitting State ---
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)

  // Papers come only from the shop's forms (owner 2026-11-07: the old built-in receipts are gone):
  // a return = ONE ใบรับคืนบางส่วน (payment included), money only = ใบเสร็จรับเงิน.
  const [shopForms, setShopForms] = useState<{
    loaded: boolean
    returnForm: DocumentTemplate | null
    receiptForm: DocumentTemplate | null
    fineForm: DocumentTemplate | null
    mainBillForm: DocumentTemplate | null
  }>({
    loaded: false,
    returnForm: null,
    receiptForm: null,
    fineForm: null,
    mainBillForm: null,
  })
  const { returnForm, receiptForm, fineForm, mainBillForm } = shopForms
  useEffect(() => {
    let active = true
    refreshSharedTemplates()
      .then((templates) => {
        if (!active) return
        setShopForms({
          loaded: true,
          returnForm: pickBillFormTemplate(templates, RETURN_FORM_NAME) ?? null,
          receiptForm: pickBillFormTemplate(templates, RECEIPT_FORM_NAME) ?? null,
          fineForm: pickBillFormTemplate(templates, FINE_FORM_NAME) ?? null,
          mainBillForm: pickBillFormTemplate(templates, MAIN_BILL_FORM_NAME) ?? null,
        })
      })
      .catch((err: unknown) => {
        console.error('Reading the shop forms failed:', err)
        if (active) setShopForms((prev) => ({ ...prev, loaded: true }))
      })
    return () => {
      active = false
    }
  }, [])

  // Auto select if initialBillId or activeBill available
  useEffect(() => {
    if (!selectedBillId) {
      if (initialBillId) {
        setSelectedBillId(initialBillId)
      } else if (customerBills.length === 1) {
        setSelectedBillId(customerBills[0].id)
      } else if (bills.length > 0) {
        setSelectedBillId(bills[0].id)
      }
    }
  }, [customerBills, selectedBillId, initialBillId, bills])

  // Reset internal states when activeBill changes
  useEffect(() => {
    if (activeBill) {
      const todayStr = getLocalDateString(new Date())
      setBillRentalStartDate(activeBill.rentalStartDate)
      setBillScheduledReturnDate(activeBill.scheduledReturnDate)
      setActualReturnDate(todayStr)
      setPaymentDate(todayStr)
      setInspectionItems(
        activeBill.items
          .filter((item) => item.requiresReturn && item.rentalType !== 'SALE')
          .map((item) => {
          const itemStart =
            item.rentalStartDate || activeBill.rentalStartDate || activeBill.billDate || ''
          const itemSched = item.scheduledReturnDate || activeBill.scheduledReturnDate || ''
          const allProds = typeof window !== 'undefined' ? loadProducts() : []
          const prod = allProds.find((p) => p.id === item.productId)
          const repairFee = item.defaultRepairFee !== undefined && item.defaultRepairFee > 0
            ? item.defaultRepairFee
            : Number(prod?.defaultDamageFee ?? prod?.defaultRepairFee ?? 0)
          const replacementFee = item.defaultReplacementFee !== undefined && item.defaultReplacementFee > 0
            ? item.defaultReplacementFee
            : Number(prod?.defaultLossFee ?? prod?.defaultReplacementFee ?? 0)

          return {
            rentalBillItemId: item.rentalBillItemId,
            productId: item.productId,
            productCode: item.productCode,
            productName: item.productName,
            totalQtyInBill: item.quantity,
            outstandingQty: item.outstandingQty,
            returnQty: 0,
            normalQty: 0,
            damagedQty: 0,
            lostQty: 0,
            continueQty: 0,
            dailyRate: item.dailyRate,
            rentalType: item.rentalType === 'DAILY' ? 'DAILY' : 'NORMAL',
            // Extra rounds already charged count as rounds of the bill, so they are never charged twice.
            usageCount: (item.usageCount || 1) + chargedExtraRounds(activeBill.charges || [], item.rentalBillItemId),
            repairFeePerUnit: repairFee,
            replacementFeePerUnit: replacementFee,
            totalDamageFee: 0,
            note: '',
            selected: false,
            rentalStartDate: itemStart,
            scheduledReturnDate: itemSched,
            actualReturnDate: todayStr,
          }
        })
      )
      // The deposit is only shown at return — never deducted (Master §18).
      setDeductFromDeposit(false)
      setUserCollectedAmount(0)
      setReceivedCashInput('')
      setDepositAction('NONE')
      setDepositAmount(0)
      setDepositRefundMethod('CASH')
    }
  }, [activeBill])

  // Calculations for Return (Reacts to changed dates & items)
  const calcResult: ReturnCalculationResult = useMemo(() => {
    if (!activeBill) return computeReturnCalculation('2026-01-01', '2026-01-01', actualReturnDate, [], 0, false, 0, rentalBilling)
    return computeReturnCalculation(
      billRentalStartDate,
      billScheduledReturnDate,
      actualReturnDate,
      inspectionItems.filter((i) => i.selected && ((i.normalQty + i.damagedQty + i.lostQty) > 0 || extraRoundsOf(i) > 0)),
      activeBill.heldDepositAmount,
      deductFromDeposit,
      userCollectedAmount,
      rentalBilling,
      {
        grandTotal: activeBill.grandTotal,
        paidAmount: activeBill.paidAmount,
        outstandingAmount: activeBill.outstandingAmount,
      }
    )
  }, [activeBill, billRentalStartDate, billScheduledReturnDate, actualReturnDate, inspectionItems, deductFromDeposit, userCollectedAmount])

  // Goods that stay with the customer: lines of the new (เช่าต่อ) bill
  const continuationLines = useMemo(
    () =>
      inspectionItems
        .filter((i) => i.selected && (i.continueQty || 0) > 0)
        .map((item) => ({ item, line: buildContinuationLine(item, item.continueQty || 0) }))
        .filter((c): c is { item: ReturnInspectionItem; line: NonNullable<typeof c.line> } => c.line !== null),
    [inspectionItems]
  )
  const continuationTotal = continuationLines.reduce((sum, c) => sum + c.line.lineTotal, 0)

  // Deposit: it pays the bill only when "หักชำระ" is ticked (owner 2026-11-07: never forced); what is left
  // of it is given back to the customer (from this screen), and the bill stays open until it is.
  const depositHeld = activeBill?.heldDepositAmount || 0
  // A deposit not received yet is owed too, but the deposit held cannot pay itself
  const depositOwed = activeBill?.depositOutstanding || 0
  const depositUse = deductFromDeposit ? Math.min(depositHeld, Math.max(0, calcResult.netAmount - depositOwed)) : 0
  const depositLeft = Math.round((depositHeld - depositUse) * 100) / 100

  // What the customer pays now: what the old bill still needs (after the deposit) + the new เช่าต่อ bill
  const payableNow = Math.round((Math.max(0, calcResult.netAmount) - depositUse + continuationTotal) * 100) / 100

  // Dynamic Documents available for Return Step 4 Preview
  const availableReturnDocs = useMemo<ReturnDocType[]>(() => {
    const continuing = continuationLines.length > 0
    // Nothing coming back: the new เช่าต่อ bill, or a receipt when something is paid on the bill now.
    // Giving the deposit back only is money going out: no receipt (owner 2026-11-07).
    if (!inspectionItems.some((i) => i.selected && getReturnedQty(i) > 0)) {
      if (continuing) return ['CONTINUATION_BILL']
      return calcResult.netAmount > 0 ? ['RECEIPT'] : []
    }
    // The return form carries the rent, damage and today's payment. Lost / damaged goods charged now also get
    // a ใบชำระค่าปรับ once the shop has that form (owner 2026-11-09).
    const docs: ReturnDocType[] = ['RETURN_SLIP']
    if (fineForm && calcResult.totalDamageFee > 0) docs.push('FINE_SLIP')
    if (continuing) docs.push('CONTINUATION_BILL')
    return docs
  }, [inspectionItems, continuationLines.length, calcResult.netAmount, calcResult.totalDamageFee, fineForm])

  // Ensure returnDocIndex is within bounds
  useEffect(() => {
    if (returnDocIndex >= availableReturnDocs.length) {
      setReturnDocIndex(0)
    }
  }, [availableReturnDocs.length, returnDocIndex])

  const handlePrevReturnDoc = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (availableReturnDocs.length <= 1) return
    setReturnDocIndex((prev) => (prev > 0 ? prev - 1 : availableReturnDocs.length - 1))
  }

  const handleNextReturnDoc = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (availableReturnDocs.length <= 1) return
    setReturnDocIndex((prev) => (prev < availableReturnDocs.length - 1 ? prev + 1 : 0))
  }

  const hasReturnItems = inspectionItems.some((item) => item.selected && getReturnedQty(item) > 0)
  // Rounds used beyond the bill on rows that do not continue: charged even when nothing comes back now.
  const extraRoundItems = inspectionItems.filter((i) => i.selected && extraRoundsFeeOf(i) > 0)
  const extraRoundsTotal = Math.round(extraRoundItems.reduce((sum, i) => sum + extraRoundsFeeOf(i), 0) * 100) / 100
  const saveExtraRounds = () =>
    activeBill
      ? chargeExtraRounds(
          activeBill.id,
          extraRoundItems.map((i) => ({
            lineId: i.rentalBillItemId,
            productName: i.productName,
            rounds: extraRoundsOf(i),
            quantity: i.outstandingQty,
            fee: extraRoundsFeeOf(i),
          }))
        )
      : Promise.resolve()

  // What is paid now follows the method chosen (owner 2026-11-04): cash = the amount handed over, capped at what
  // is due (less than due = the rest stays unpaid); QR Code = in full; ค้างชำระ = nothing.
  // เงินสด + QR Code together (owner 2026-11-05): the first one pressed is taken first, the other takes the rest.
  const pay = useSplitPayment({
    due: payableNow,
    method: payableNow > 0 ? paymentChannel : null,
    setMethod: setPaymentChannel,
    cashInput: receivedCashInput,
    setCashInput: setReceivedCashInput,
    unpaidKeepsPart: true,
  })
  useEffect(() => {
    if (currentStep !== 2) return
    setUserCollectedAmount(pay.totals.collected)
  }, [currentStep, pay.totals.collected])
  /** The money taken now, by method, with the transfer reference on non-cash parts. */
  const withRef = (tenders: Tender[]) => tenders.map((t) => ({ ...t, reference: t.method === 'CASH' ? undefined : bankRef || undefined }))

  const currentPayableAmount = useMemo(
    () => (payableNow > 0 ? userCollectedAmount : 0),
    [payableNow, userCollectedAmount]
  )

  const changeAmount = paymentChannel === 'CASH' ? pay.totals.change : 0
  const notice = useNotice()

  // Generate QR Code dynamically
  useEffect(() => {
    setQrCodeUrl('')
    setIsQrLoading(false)
  }, [paymentChannel, currentPayableAmount, promptPayId])

  // The new เช่าต่อ bill on the shop's main bill form (the number is given by the server when saved)
  const continuationBillData = (billNo?: string): BillTemplateData => ({
    customerName: activeBill?.customerName || '',
    customerAddress: activeBill?.customerAddress,
    customerPhone: activeBill?.customerPhone || '',
    billNo: billNo || 'รอสร้างเลขเอกสาร',
    billDate: getLocalDateString(new Date()),
    headerRentalDate: continuationLines.map((c) => c.line.startDay).sort()[0] || '',
    headerReturnDate: continuationLines.map((c) => c.line.endDay).sort().reverse()[0] || '',
    siteName: activeBill?.siteName,
    items: continuationLines.map(({ item, line }) => ({
      code: item.productCode,
      name: item.productName,
      quantity: line.quantity,
      unit: activeBill?.items.find((b) => b.rentalBillItemId === item.rentalBillItemId)?.unit || '',
      price: line.unitPrice,
      rentalType: item.rentalType === 'DAILY' ? 'DAILY' : 'NORMAL',
      usageCount: line.periods,
      billableDays: item.rentalType === 'DAILY' ? line.periods : undefined,
      dailyStartDate: line.startDay,
      dailyEndDate: line.endDay,
      lineTotal: line.lineTotal,
    })),
    subtotal: continuationTotal,
    discount: 0,
    shippingFee: 0,
    taxAmount: 0,
    depositAmount: 0,
    grandTotal: continuationTotal,
    paidAmount: 0,
    outstandingAmount: continuationTotal,
    remark: activeBill ? `เช่าต่อจากบิล ${activeBill.billNo}` : undefined,
  })

  // Money on the return paper: today's payment counts only this bill's share (a เช่าต่อ bill's part
  // goes on that bill), and the deposit used today.
  const slipCollected = Math.min(savedReturnInfo?.paidAmount ?? userCollectedAmount, Math.max(0, calcResult.netAmount - depositUse))
  const slipDepositApplied = savedReturnInfo?.depositApplied ?? depositUse

  /** The return on the shop's ใบรับคืนบางส่วน form, one HTML page per 20 returned lines. */
  const returnFormPages = (customReturnNo?: string): string[] => {
    if (!activeBill || !returnForm) return []
    return renderReturnFormPagesHtml(
      {
        slipNo: customReturnNo || savedReturnInfo?.returnNo || 'รอสร้างเลขเอกสาร',
        returnDate: actualReturnDate,
        rentalStartDate: billRentalStartDate,
        scheduledReturnDate: billScheduledReturnDate,
        siteName: activeBill.siteName,
        customerName: activeBill.customerName,
        customerPhone: activeBill.customerPhone,
        customerAddress: activeBill.customerAddress,
        items: inspectionItems
          .filter((i) => i.selected && i.returnQty > 0)
          .map((i) => ({
            name: extraRoundsOf(i) > 0 ? `${i.productName} (ใช้เพิ่ม ${extraRoundsOf(i)} รอบ)` : i.productName,
            returnedQty: i.returnQty,
            normalQty: i.normalQty,
            damagedQty: i.damagedQty,
            lostQty: i.lostQty,
            damageFee: i.totalDamageFee,
          })),
        rentFee: calcResult.actualRentalFee,
        damageFee: calcResult.totalDamageFee,
        paidBefore: calcResult.persistedPaidAmount,
        depositApplied: slipDepositApplied,
        collected: slipCollected,
      },
      business,
      returnForm
    )
  }

  /** Lost / damaged goods of this return on the shop's ใบชำระค่าปรับ form, at the fees typed in the return table. */
  const fineFormPages = (customReturnNo?: string): string[] => {
    if (!activeBill || !fineForm) return []
    return renderFineFormPagesHtml(
      {
        slipNo: customReturnNo || savedReturnInfo?.returnNo || 'รอสร้างเลขเอกสาร',
        returnDate: actualReturnDate,
        rentalStartDate: billRentalStartDate,
        scheduledReturnDate: billScheduledReturnDate,
        siteName: activeBill.siteName,
        customerName: activeBill.customerName,
        customerPhone: activeBill.customerPhone,
        customerAddress: activeBill.customerAddress,
        lines: inspectionItems
          .filter((i) => i.selected && i.returnQty > 0)
          .map((i) => {
            const line = activeBill.items.find((b) => b.rentalBillItemId === i.rentalBillItemId)
            return {
              name: i.productName,
              deliveredQty: line?.deliveredQty ?? i.totalQtyInBill,
              normalQty: i.normalQty || 0,
              damagedQty: i.damagedQty || 0,
              lostQty: i.lostQty || 0,
              repairFeePerUnit: i.repairFeePerUnit || 0,
              replacementFeePerUnit: i.replacementFeePerUnit || 0,
            }
          }),
      },
      business,
      fineForm
    )
  }

  /**
   * Money only (nothing comes back) on the shop's ใบเสร็จรับเงิน form, filled like a normal bill with the real
   * data (owner 2026-11-07): extra rounds typed now = those lines only; otherwise the bill as it stands
   * (its lines + charges). Taking from the deposit is not written on it.
   */
  const receiptData = (receiptNo?: string): BillTemplateData | null => {
    if (!activeBill) return null
    const unitOf = (lineId: string) => activeBill.items.find((b) => b.rentalBillItemId === lineId)?.unit || ''
    const head = {
      customerName: activeBill.customerName,
      customerAddress: activeBill.customerAddress,
      customerPhone: activeBill.customerPhone,
      billNo: receiptNo || savedReturnInfo?.receiptNo || 'รอสร้างเลขเอกสาร',
      billDate: paymentDate || getLocalDateString(new Date()),
      headerRentalDate: activeBill.rentalStartDate,
      headerReturnDate: activeBill.scheduledReturnDate,
      siteName: activeBill.siteName,
    }
    if (extraRoundItems.length > 0) {
      return {
        ...head,
        items: extraRoundItems.map((i) => ({
          code: i.productCode,
          name: `${i.productName} (ใช้เพิ่ม ${extraRoundsOf(i)} รอบ)`,
          quantity: i.outstandingQty,
          unit: unitOf(i.rentalBillItemId),
          price: i.dailyRate,
          rentalType: 'NORMAL' as const,
          usageCount: extraRoundsOf(i),
          lineTotal: extraRoundsFeeOf(i),
        })),
        subtotal: extraRoundsTotal,
        discount: 0,
        shippingFee: 0,
        taxAmount: 0,
        depositAmount: 0,
        grandTotal: extraRoundsTotal,
        paidAmount: 0,
        outstandingAmount: extraRoundsTotal,
      }
    }
    const bill = fullBillToTemplateData(activeBill)
    const charges = (activeBill.charges || []).filter((c) => c.status === 'CONFIRMED' && c.amount > 0)
    const chargeLines = charges.map((c) => {
      const line = activeBill.items.find((b) => b.rentalBillItemId === c.billLineId)
      const rounds = c.basis?.kind === 'EXTRA_ROUNDS' ? Math.max(1, Number(c.basis.rounds) || 1) : 0
      const qty = rounds > 0 ? Math.max(1, Number(c.basis?.quantity) || 1) : 1
      return {
        code: line?.productCode,
        name: rounds > 0 ? `${line?.productName ?? ''} (ใช้เพิ่ม ${rounds} รอบ)` : c.reason,
        quantity: qty,
        unit: rounds > 0 ? line?.unit || '' : '',
        price: Math.round((c.amount / (qty * Math.max(1, rounds))) * 100) / 100,
        rentalType: 'NORMAL' as const,
        usageCount: Math.max(1, rounds),
        lineTotal: c.amount,
      }
    })
    const chargeTotal = charges.reduce((sum, c) => sum + c.amount, 0)
    // The deposit was taken when the bill was made: it is not part of what is paid now.
    return {
      ...bill,
      ...head,
      items: [...bill.items, ...chargeLines],
      subtotal: Math.round((bill.subtotal + chargeTotal) * 100) / 100,
      depositAmount: 0,
    }
  }

  /** The A4 pages of one paper (a form runs to more pages past 20 lines); empty while its form is missing. */
  const docPages = (docType: ReturnDocType, receiptNo?: string, returnNo?: string, continuationNo?: string): string[] => {
    if (docType === 'RETURN_SLIP') return returnFormPages(returnNo)
    if (docType === 'FINE_SLIP') return fineFormPages(returnNo)
    if (docType === 'RECEIPT') {
      const data = receiptData(receiptNo)
      return data && receiptForm ? renderBillFormPagesHtml(data, business, receiptForm) : []
    }
    return mainBillForm ? renderBillFormPagesHtml(continuationBillData(continuationNo), business, mainBillForm) : []
  }

  /** What one preview entry prints as. */
  const printNodesFor = (
    docType: ReturnDocType,
    key: string,
    receiptNo?: string,
    returnNo?: string,
    continuationNo?: string
  ): React.ReactNode[] =>
    docPages(docType, receiptNo, returnNo, continuationNo).map((html, page) => <ReturnFormPage key={`${key}-${page}`} html={html} />)

  // The paper shown in the preview (first page of a form; a missing form says which one to add).
  const renderReturnDoc = (docType: ReturnDocType, customReceiptNo?: string, customReturnNo?: string, customContinuationNo?: string) => {
    if (!activeBill) return null
    const [first] = docPages(docType, customReceiptNo, customReturnNo, customContinuationNo)
    if (first) return <ReturnFormPage html={first} />
    const formName = RETURN_DOC_FORM_NAME[docType]
    return (
      <div className="flex h-full w-full items-center justify-center bg-white p-6 text-center text-xs text-slate-600">
        {shopForms.loaded ? `ไม่พบแบบฟอร์มของ "${formName}" กรุณาเพิ่มที่เมนูจัดการเอกสาร` : 'กำลังโหลดแบบฟอร์ม...'}
      </div>
    )
  }

  // Global Multi-Document Print Handler for Return Flow (Prints all available documents in preview order)
  const handlePrintReturnDocs = async (savedNos?: { returnNo?: string; receiptNo?: string }) => {
    if (!activeBill) return
    const docs =
      printDocs ??
      availableReturnDocs.flatMap((docType, idx) =>
        printNodesFor(docType, `${docType}-${idx}`, savedNos?.receiptNo, savedNos?.returnNo)
      )
    await printDocuments(docs, {
      title: `เอกสารรับคืน_${activeBill.billNo}`,
    })
  }

  // Actions
  const handleBackStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    } else {
      onClose()
    }
  }

  const handleToggleSelectAll = () => {
    const allSelected = inspectionItems.length > 0 && inspectionItems.every((i) => i.selected)
    setInspectionItems((prev) => prev.map((item) => ({ ...item, selected: !allSelected })))
  }

  const handleToggleSelectItem = (idx: number) => {
    setInspectionItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, selected: !item.selected } : item))
    )
  }

  const handleItemDateChange = (
    idx: number,
    field: 'rentalStartDate' | 'scheduledReturnDate' | 'actualReturnDate',
    val: string
  ) => {
    setInspectionItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item))
    )
  }

  // เช่าต่อ of a daily item: the day the new round ends
  const handleContinueEndDateChange = (idx: number, value: string) => {
    setInspectionItems((prev) => prev.map((item, i) => (i === idx ? { ...item, continueEndDate: value || undefined } : item)))
  }

  // เช่าต่อ of a per-round item: how many more rounds
  const handleContinueRoundsChange = (idx: number, value: number) => {
    setInspectionItems((prev) =>
      prev.map((item, i) =>
        i === idx ? { ...item, continueRounds: value > 0 ? Math.floor(value) : undefined, selected: value > 0 ? true : item.selected } : item
      )
    )
  }

  const handleItemQtyChange = (
    rentalBillItemId: string,
    field: ReturnQuantityField,
    val: number
  ) => {
    setInspectionItems((prev) =>
      prev.map((item) => {
        if (item.rentalBillItemId !== rentalBillItemId) return item

        if (field === 'repairFeePerUnit' || field === 'replacementFeePerUnit') {
          const updatedItem = {
            ...item,
            [field]: Math.max(0, val || 0),
          }
          updatedItem.totalDamageFee = getItemDamageFee(updatedItem)
          return updatedItem
        }

        const otherQty = (['normalQty', 'damagedQty', 'lostQty', 'continueQty'] as const)
          .filter((key) => key !== field)
          .reduce((sum, key) => sum + (item[key] || 0), 0)

        const maxAllowed = Math.max(0, item.outstandingQty - otherQty)
        const parsedQty = Math.max(0, Math.min(maxAllowed, Math.floor(val) || 0))

        const updatedItem = {
          ...item,
          [field]: parsedQty,
        }
        // returnQty = goods coming back now; continueQty stays with the customer
        updatedItem.returnQty =
          (updatedItem.normalQty || 0) +
          (updatedItem.damagedQty || 0) +
          (updatedItem.lostQty || 0)
        updatedItem.totalDamageFee = getItemDamageFee(updatedItem)
        // A quantity in ปกติ / ชำรุด / หาย means this item is coming back: tick the row.
        if (parsedQty > 0) updatedItem.selected = true
        return updatedItem
      })
    )
  }

  // Deposit: one action per save — give back what is left of it, or add to it.
  const chooseDepositAction = (next: 'REFUND' | 'ADD') => {
    if (depositAction === next) {
      setDepositAction('NONE')
      return
    }
    setDepositAction(next)
    // Giving back starts from what is left after it paid the bill; adding starts empty.
    setDepositAmount(next === 'REFUND' ? depositLeft : 0)
  }
  // Deposit counts in the net total (owner 2026-11-04): returned = money out, added = money in.
  const depositDelta = depositAction === 'ADD' ? depositAmount : depositAction === 'REFUND' ? -depositAmount : 0
  // Paid more than the bill now comes to: given back with the rest when ออกบิล is pressed (owner 2026-11-09).
  const overpaid = Math.round(Math.max(0, -calcResult.netAmount) * 100) / 100
  const netCash = payableNow - overpaid + depositDelta
  const depositAfter = Math.round((depositLeft + depositDelta) * 100) / 100

  const handleFinalCloseAndConfirmReturn = async () => {
    if (!activeBill) return
    if (pay.blocker) {
      await notice(pay.blocker)
      return
    }

    if (!actualReturnDate) {
      showToast('ยังไม่ได้กำหนดวันรับคืน', 'กรุณาเลือกวันรับคืนก่อนบันทึกรายการ', 'ERROR')
      return
    }

    const returnedItems = inspectionItems.filter((i) => i.selected && (i.normalQty + i.damagedQty + i.lostQty) > 0)
    const continuing = continuationLines
    const hasDepositAction = depositAction !== 'NONE' && depositAmount > 0

    if (depositAction === 'REFUND' && depositAmount > depositLeft + 0.004) {
      showToast('คืนมัดจำเกินยอดคงเหลือ', `มัดจำคงเหลือหลังหักค่าบริการ ${formatBaht(depositLeft)} บาท`, 'ERROR')
      return
    }

    // Goods that continue need a valid end (daily goods: a day after the old end; other goods: rounds).
    // Per-round goods with no rounds typed are simply not continued; a daily row needs a valid end day.
    const continuingRows = inspectionItems.filter(
      (i) => i.selected && (i.continueQty || 0) > 0 && (i.rentalType === 'DAILY' || (i.continueRounds || 0) > 0)
    )
    if (continuingRows.length !== continuing.length) {
      showToast('วันที่คืนของสินค้าเช่าต่อไม่ถูกต้อง', 'วันที่คืนใหม่ต้องเป็นวันหลังกำหนดคืนเดิม', 'ERROR')
      return
    }

    // เพิ่มมัดจำ: recorded first, while the bill is still open.
    const addDeposit = async () => {
      if (depositAction !== 'ADD' || depositAmount <= 0) return
      const note = [activeBill.depositNote, `เพิ่มมัดจำ ${formatBaht(depositAmount)} บาท (${getLocalDateString(new Date())})`]
        .filter(Boolean)
        .join(' | ')
      // Held + the added deposit; the part not received yet stays as it is
      await correctBill(
        activeBill.id,
        { depositAmount: depositHeld + depositAmount + (activeBill.depositOutstanding || 0), depositNote: note },
        ''
      )
    }
    // คืนมัดจำ: recorded last; the bill closes when nothing else is left on it.
    const giveBackDeposit = async () => {
      if (depositAction !== 'REFUND' || depositAmount <= 0) return null
      return refundDeposit(activeBill.id, depositAmount, depositRefundMethod)
    }
    const depositText = hasDepositAction
      ? `${depositAction === 'REFUND' ? 'คืนมัดจำ' : 'เพิ่มมัดจำ'} ${formatBaht(depositAmount)} บาท`
      : ''

    if (returnedItems.length === 0 && continuing.length === 0) {
      // Nothing comes back and nothing continues: only money (a debt, extra rounds, the deposit) is recorded.
      const owed = activeBill.outstandingAmount + extraRoundsTotal
      const useDeposit = Math.min(depositUse, Math.max(0, owed))
      const collected = Math.min(userCollectedAmount, Math.max(0, owed - useDeposit))
      const canPay = collected > 0
      const givesBack = (activeBill.refundDueAmount ?? 0) > 0
      if (!canPay && useDeposit <= 0 && !hasDepositAction && extraRoundsTotal <= 0 && !givesBack) {
        showToast('ไม่มีรายการคืน', 'กรุณาระบุจำนวนสินค้าที่คืนหรือเช่าต่อ หรือเลือกช่องทางและยอดที่รับชำระ', 'ERROR')
        return
      }
      if ((canPay || useDeposit > 0) && (!paymentDate || paymentDate > getLocalDateString(new Date()))) {
        showToast('วันที่รับชำระไม่ถูกต้อง', 'วันที่รับเงินจริงต้องไม่อยู่ในอนาคต', 'ERROR')
        return
      }
      setIsSubmitting(true)
      try {
        await addDeposit()
        await saveExtraRounds()
        let fresh: FullBill | null = null
        let receiptNo: string | undefined
        let paid = 0
        let fromDeposit = 0
        if (useDeposit > 0) {
          const depositResult = await applyDepositToBill(activeBill.id, useDeposit, paymentDate)
          fresh = depositResult.bill
          fromDeposit = depositResult.totalAmount ?? useDeposit
        }
        if (canPay) {
          const paymentResult = await receivePayment(
            activeBill.id,
            withRef(allocateTenders(pay.totals.tenders, collected)[0]),
            paymentDate
          )
          fresh = paymentResult.bill
          if (!fresh) throw new Error('บันทึกแล้วแต่โหลดบิลใหม่ไม่สำเร็จ — กรุณารีเฟรช')
          receiptNo = paymentResult.receiptNo || undefined
          paid = paymentResult.totalAmount ?? collected
        }
        const overpayment = await refundOverpayment(activeBill.id)
        fresh = overpayment.bill ?? fresh
        fresh = (await giveBackDeposit()) ?? fresh
        if (canPay) {
          setPrintDocs(printNodesFor('RECEIPT', 'RECEIPT', receiptNo))
        }
        const fresh2 = fresh
        if (fresh2) setBills((prev) => prev.map((b) => (b.id === fresh2.id ? fresh2 : b)))
        else setBills(await refreshBillsCache())
        showToast(
          canPay || fromDeposit > 0
            ? 'บันทึกรับชำระเงินสำเร็จ'
            : extraRoundsTotal > 0
              ? 'บันทึกค่าเช่ารอบเพิ่มสำเร็จ'
              : overpayment.amount > 0
                ? 'บันทึกคืนเงินสำเร็จ'
                : 'บันทึกมัดจำสำเร็จ',
          [
            extraRoundsTotal > 0 ? `ค่าเช่ารอบเพิ่ม ${formatBaht(extraRoundsTotal)} บาท` : '',
            fromDeposit > 0 ? `หักจากมัดจำ ${formatBaht(fromDeposit)} บาท` : '',
            canPay ? `รับชำระเงิน ${paid.toLocaleString('th-TH')} บาท` : '',
            overpayment.amount > 0 ? `คืนเงินที่ชำระเกิน ${formatBaht(overpayment.amount)} บาท` : '',
            depositText,
          ]
            .filter(Boolean)
            .join(' · ') + ' สำเร็จแล้ว',
          'SUCCESS'
        )
        setDepositAction('NONE')
        if (canPay) {
          setSavedReturnInfo({ receiptNo, paidAmount: paid, depositApplied: fromDeposit, depositLeft: depositAfter })
          setPostSavePrintModal({
            isOpen: true,
            title: 'บันทึกรับชำระเงินสำเร็จ',
            description: 'รับชำระเงินเรียบร้อยแล้ว\nต้องการพิมพ์ใบเสร็จรับเงินหรือไม่?',
          })
        }
      } catch (err: any) {
        if (!isPinCancelled(err)) {
          showToast('เกิดข้อผิดพลาดในการบันทึก', dbErrorMessage(err?.message || '') || 'ไม่สามารถบันทึกรายการได้', 'ERROR')
        }
        // Some steps may already be saved: show the bill as it is now
        try {
          setBills(await refreshBillsCache())
        } catch {
          // the bill list still offers a manual reload
        }
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    // Daily-rate goods carry their own return date; it cannot be in the future.
    const today = getLocalDateString(new Date())
    if (returnedItems.some((i) => i.rentalType === 'DAILY' && !(i.continueQty || 0) && (i.actualReturnDate || '') > today)) {
      showToast('วันที่คืนไม่ถูกต้อง', 'วันที่คืนของสินค้าต้องไม่อยู่ในอนาคต', 'ERROR')
      return
    }

    const remainingOutstandingTotal = inspectionItems.reduce(
      (sum, i) =>
        sum +
        (i.outstandingQty -
          (i.selected
            ? i.normalQty + i.damagedQty + i.lostQty + (continuing.find((c) => c.item === i)?.line.quantity || 0)
            : 0)),
      0
    )
    const fullyReturned = remainingOutstandingTotal === 0

    if (rentalBilling?.allowPartialReturn === false && !fullyReturned) {
      showToast('ไม่อนุญาตให้คืนบางส่วน', 'การตั้งค่าระบบไม่อนุญาตให้คืนสินค้าบางส่วน', 'ERROR')
      return
    }

    // Past the planned end date the server needs to know where the new round starts (Master §17.4).
    let startMode: 'FROM_PREVIOUS_END' | 'FROM_APPROVAL' | undefined
    if (continuing.some((c) => today > (c.item.scheduledReturnDate || ''))) {
      startMode = (await confirmDialog({
        title: 'บิลนี้เลยวันกำหนดคืนแล้ว',
        message: 'เลือกวันเริ่มนับรอบเช่าใหม่',
        confirmLabel: 'ต่อจากวันครบกำหนดเดิม',
        cancelLabel: 'เริ่มตั้งแต่วันนี้',
      }))
        ? 'FROM_PREVIOUS_END'
        : 'FROM_APPROVAL'
    }

    setIsSubmitting(true)
    let returnSaved = false

    try {
      let updatedBill: FullBill | null = null
      let returnNo = ''

      await addDeposit()
      await saveExtraRounds()

      // 1) Goods back (+ damage cases/fees + lost + early-return recalculation) — one return per day.
      if (returnedItems.length > 0) {
        const result = await processReturn({
          billId: activeBill.id,
          returnedDay: actualReturnDate,
          items: returnedItems.map((item) => ({
            lineId: item.rentalBillItemId,
            productName: item.productName,
            normalQty: Number(item.normalQty || 0),
            damagedQty: Number(item.damagedQty || 0),
            lostQty: Number(item.lostQty || 0),
            damageFeePerUnit: Number(item.repairFeePerUnit || 0),
            lossFeePerUnit: Number(item.replacementFeePerUnit || 0),
            note: item.note,
            // A row that also continues uses its date for the new round: its returned part is back today.
            returnedDay:
              item.rentalType === 'DAILY' && !(item.continueQty || 0) ? item.actualReturnDate || undefined : undefined,
          })),
        })
        returnSaved = true
        updatedBill = result.bill
        returnNo = result.returnNo || ''
      }

      // 2) เช่าต่อ: the goods that stay become a new bill (the old bill no longer holds them).
      let childBillId = ''
      let childBillNo = ''
      if (continuing.length > 0) {
        childBillId = await createContinuation({
          parentBillId: activeBill.id,
          reason: '',
          startMode,
          items: continuing.map(({ line }) => ({
            fromLineId: line.fromLineId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            calc: line.calc,
            periods: line.periods,
            startAt: line.startAt,
            endAt: line.endAt,
          })),
        })
        const latest = await refreshBillsCache()
        setBills(latest)
        updatedBill = latest.find((b) => b.id === activeBill.id) ?? updatedBill
        childBillNo = latest.find((b) => b.id === childBillId)?.billNo || ''
      }

      // 3) "หักชำระ" ticked: the deposit pays what the old bill now owes; the bill keeps the rest of it.
      let depositPaid = 0
      const owesNow = Math.max(
        0,
        (updatedBill ?? activeBill).outstandingAmount - ((updatedBill ?? activeBill).depositOutstanding || 0)
      )
      const useDeposit = deductFromDeposit ? Math.min(depositHeld, owesNow) : 0
      if (useDeposit > 0) {
        const depositResult = await applyDepositToBill(activeBill.id, useDeposit, paymentDate)
        updatedBill = depositResult.bill ?? updatedBill
        depositPaid = depositResult.totalAmount ?? useDeposit
      }

      // 4) Money collected at the counter: the old bill first (what it now owes), the rest on the new bill.
      let receiptNo: string | null = null
      let paidAmount: number | null = null
      if (userCollectedAmount > 0) {
        const parentOwes = updatedBill ? Math.max(0, updatedBill.outstandingAmount) : 0
        // Methods in the order taken: the old bill first, then the new bill
        const [toParentTenders, leftTenders] = allocateTenders(pay.totals.tenders, parentOwes)
        const [toChildTenders] = allocateTenders(leftTenders, continuationTotal)
        const toChild = toChildTenders.reduce((sum, t) => sum + t.amount, 0)
        if (toParentTenders.length > 0) {
          const paymentResult = await receivePayment(activeBill.id, withRef(toParentTenders), paymentDate)
          updatedBill = paymentResult.bill
          receiptNo = paymentResult.receiptNo
          paidAmount = paymentResult.totalAmount
        }
        if (childBillId && toChild > 0) {
          const childPayment = await receivePayment(childBillId, withRef(toChildTenders), paymentDate)
          receiptNo = receiptNo ?? childPayment.receiptNo
          paidAmount = (paidAmount ?? 0) + (childPayment.totalAmount ?? toChild)
          setBills(await refreshBillsCache())
        }
      }

      // 5) Paid more than the bill now comes to (e.g. returned early): given back now (owner 2026-11-09).
      const overpayment = await refundOverpayment(activeBill.id)
      updatedBill = overpayment.bill ?? updatedBill

      // 6) คืนมัดจำ last: the bill closes when nothing else is left on it.
      updatedBill = (await giveBackDeposit()) ?? updatedBill

      if (updatedBill) {
        const fresh = updatedBill
        setBills((prev) => prev.map((b) => (b.id === fresh.id ? fresh : b)))
      }

      const parts = [
        returnedItems.length > 0 ? `รับคืนสินค้า ใบคืน ${returnNo}` : '',
        depositPaid > 0 ? `หักจากมัดจำ ${formatBaht(depositPaid)} บาท` : '',
        paidAmount ? `รับชำระ ${paidAmount.toLocaleString('th-TH')} บาท` : '',
        overpayment.amount > 0 ? `คืนเงินที่ชำระเกิน ${formatBaht(overpayment.amount)} บาท` : '',
        continuing.length > 0 ? `เช่าต่อ บิลใหม่ ${childBillNo}` : '',
        depositText,
      ].filter(Boolean)
      showToast(
        returnedItems.length > 0 ? 'บันทึกรับคืนสินค้าสำเร็จ' : 'บันทึกเช่าต่อสำเร็จ',
        `${parts.join(' · ')} สำเร็จแล้ว`,
        'SUCCESS'
      )

      // Keep the documents exactly as previewed (the form resets when the bill is refreshed).
      setPrintDocs(
        availableReturnDocs.flatMap((docType, idx) =>
          printNodesFor(docType, `${docType}-${idx}`, receiptNo || undefined, returnNo || undefined, childBillNo || undefined)
        )
      )
      setSavedReturnInfo({
        returnNo,
        receiptNo: receiptNo || undefined,
        paidAmount: paidAmount ?? undefined,
        depositApplied: depositPaid,
        depositLeft: depositAfter,
      })
      setPostSavePrintModal({
        isOpen: true,
        title: returnedItems.length > 0 ? 'บันทึกรับคืนสินค้าสำเร็จ' : 'บันทึกเช่าต่อสำเร็จ',
        description: `${returnedItems.length > 0 ? 'รับคืนสินค้าเรียบร้อยแล้ว' : 'ออกบิลเช่าต่อเรียบร้อยแล้ว'}\nต้องการพิมพ์เอกสารหรือไม่?`,
      })
    } catch (err: any) {
      // The steps run one after another: reload so the screen shows what was already saved and a
      // retry cannot receive the same goods twice.
      try {
        const latest = await refreshBillsCache()
        setBills(latest)
        setCurrentStep(1)
      } catch {
        // keep the error below; the bill list still offers a manual reload
      }
      if (isPinCancelled(err)) return
      showToast(
        returnSaved ? 'บันทึกรับคืนแล้ว แต่ขั้นต่อไปไม่สำเร็จ' : 'เกิดข้อผิดพลาดในการรับคืนสินค้า',
        dbErrorMessage(err?.message || '') || 'ไม่สามารถบันทึกรายการได้',
        'ERROR'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    // One white work area: the tab bar and the open tab together (owner 2026-11-11)
    <div className="flex flex-col min-h-0 h-full w-full overflow-hidden animate-in fade-in duration-150 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
      {/* Tabs: รับคืนสินค้า / ประวัติการทำรายการ/เอกสาร */}
      {activeBill && (
        <div className="shrink-0 p-2">
          <BillWorkspaceHeader
            tab={tab}
            onTab={setTab}
            returnDisabled={isCancelledOrVoidBill(activeBill)}
          />
        </div>
      )}

      {/* Content of the open tab */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* RETURN WORKFLOW STEPS */}
        {tab === 'RETURN' && activeBill && (
          <>
            {/* STEP 1: one table for the whole return */}
            {currentStep === 1 && (
              <ReturnTableStep
                activeBill={activeBill}
                items={inspectionItems}
                canNext={
                  hasReturnItems ||
                  continuationLines.length > 0 ||
                  extraRoundsTotal > 0 ||
                  // a debt to take, or a deposit still held to give back (owner 2026-11-06)
                  ((activeBill.outstandingAmount > 0 || activeBill.heldDepositAmount > 0) && !isCancelledOrVoidBill(activeBill))
                }
                onToggleSelectAll={handleToggleSelectAll}
                onToggleSelectItem={handleToggleSelectItem}
                onQuantityChange={handleItemQtyChange}
                onReturnDateChange={(idx, value) => handleItemDateChange(idx, 'actualReturnDate', value)}
                onContinueEndDateChange={handleContinueEndDateChange}
                onContinueRoundsChange={handleContinueRoundsChange}
                onBack={handleBackStep}
                onNext={() => setCurrentStep(2)}
              />
            )}

            {/* STEP 2: Preview + payment (Centered A4 Preview without Outer White Card + External Navigation + Double-click Full Preview) */}
            {currentStep === 2 && (() => {
              return (
                <div className="flex-1 min-h-0 h-full w-full grid grid-cols-1 md:grid-cols-[minmax(0,58fr)_minmax(300px,42fr)] lg:grid-cols-[minmax(0,60fr)_minmax(340px,40fr)] gap-2 md:gap-2.5 lg:gap-3 overflow-hidden p-2 pt-0">
                  {/* Left: Document Preview Area (Centered A4, No outer white card, Outside Prev/Next buttons) */}
                  <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-950/40">
                    {/* Previous Button Zone (Outside A4) */}
                    {availableReturnDocs.length > 1 && (
                      <button
                        type="button"
                        onClick={handlePrevReturnDoc}
                        aria-label="เอกสารก่อนหน้า"
                        className="w-7 sm:w-9 h-full flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors z-10 shrink-0 cursor-pointer group"
                        title="เอกสารก่อนหน้า (ใบรับคืน / ใบเสร็จรับเงิน)"
                      >
                        <ChevronLeft className="w-5 h-5 opacity-50 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}

                    {/* Multi-Doc Indicator */}
                    {availableReturnDocs.length > 1 && (
                      <div className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full bg-slate-900/60 text-white text-[10px] font-mono font-bold backdrop-blur-xs shadow-sm">
                        {returnDocIndex + 1} / {availableReturnDocs.length}
                      </div>
                    )}

                    {/* A4 Center Container (double-click the sheet: A4FitPreview opens the full preview) */}
                    <div
                      className="flex-1 min-h-0 min-w-0 h-full relative"
                    >
                      {availableReturnDocs.length > 0 && (
                        <A4FitPreview paddingPx={1} className="h-full w-full" align="center">
                          {renderReturnDoc(availableReturnDocs[returnDocIndex])}
                        </A4FitPreview>
                      )}
                    </div>

                    {/* Next Button Zone (Outside A4) */}
                    {availableReturnDocs.length > 1 && (
                      <button
                        type="button"
                        onClick={handleNextReturnDoc}
                        aria-label="เอกสารถัดไป"
                        className="w-7 sm:w-9 h-full flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors z-10 shrink-0 cursor-pointer group"
                        title="เอกสารถัดไป (ใบรับคืน / ใบเสร็จรับเงิน)"
                      >
                        <ChevronRight className="w-5 h-5 opacity-50 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}
                  </div>

                  {/* Right: Payment & Summary Panel */}
                  <div className="flex min-h-0 min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800 h-full md:p-3.5 lg:p-4">
                    <div className="flex min-h-0 flex-1 flex-col space-y-2 sm:space-y-2.5 overflow-y-auto pr-0.5">
                      {/* 1. Header */}
                      <div className="flex shrink-0 min-w-0 items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700 pb-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <DollarSign className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                          <h3 className="truncate whitespace-nowrap text-sm font-bold text-slate-900 dark:text-slate-100">
                            สรุปยอดและรับชำระเงิน
                          </h3>
                        </div>
                        <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-lg border border-blue-200 dark:border-blue-800 shrink-0">
                          {activeBill.billNo}
                        </span>
                      </div>

                      {/* 2. Fee Breakdown Card: a เช่าต่อ is added to the old bill's total, the deposit is shown there too */}
                      <div className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60 p-2 text-xs">
                        <div className="grid grid-cols-2 gap-x-2.5 gap-y-1">
                          <div>
                            <div className="flex justify-between">
                              <span className="text-slate-600 dark:text-slate-400">ยอดรวมบิลเดิม:</span>
                              <span className="font-bold tabular-nums">{formatBaht(calcResult.persistedGrandTotal)}</span>
                            </div>
                            {/* owner 2026-11-05: the new bill's amount shows only when the money changes (เช่าต่อ) */}
                            {continuationTotal > 0 && (
                              <div className="flex justify-between">
                                <span className="text-slate-600 dark:text-slate-400">ยอดบิลใหม่:</span>
                                <span className="font-bold text-blue-700 dark:text-blue-300 tabular-nums">{formatBaht(continuationTotal)}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">ชำระแล้ว:</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatBaht(calcResult.persistedPaidAmount)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">ค่าเสียหาย/สูญหาย:</span>
                            <span className="font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                              {formatBaht(calcResult.totalDamageFee)}
                            </span>
                          </div>

                          {/* เงินมัดจำ: หักชำระ only when ticked (owner 2026-11-07); what is left is given back from here */}
                          <div className="col-span-2 space-y-0.5 border-t border-slate-200 dark:border-slate-700 pt-1">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="text-slate-600 dark:text-slate-400">เงินมัดจำ</span>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={deductFromDeposit}
                                  onChange={() => setDeductFromDeposit((v) => !v)}
                                  disabled={depositHeld <= 0 || calcResult.netAmount <= 0}
                                  className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                                />
                                หักชำระ
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={depositAction === 'REFUND'}
                                  onChange={() => chooseDepositAction('REFUND')}
                                  disabled={depositLeft <= 0}
                                  className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                                />
                                คืน
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={depositAction === 'ADD'}
                                  onChange={() => chooseDepositAction('ADD')}
                                  className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-500 cursor-pointer"
                                />
                                เพิ่ม
                              </label>
                              <NumericInput
                                value={depositAction === 'NONE' ? depositLeft : depositAmount || ''}
                                onChange={(val) => setDepositAmount(val === '' ? 0 : Math.max(0, val))}
                                disabled={depositAction === 'NONE'}
                                min={0}
                                max={depositAction === 'REFUND' ? depositLeft : undefined}
                                aria-label="จำนวนเงินมัดจำ"
                                className="ml-auto w-24 h-7 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 text-right text-xs font-bold tabular-nums disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-600 dark:disabled:text-slate-400"
                              />
                            </div>
                            {depositAction === 'REFUND' && (
                              <div className="flex items-center justify-end gap-1.5" role="radiogroup" aria-label="คืนมัดจำด้วย">
                                <span className="text-slate-600 dark:text-slate-400">คืนด้วย</span>
                                {(['CASH', 'TRANSFER'] as const).map((m) => (
                                  <button
                                    key={m}
                                    type="button"
                                    role="radio"
                                    aria-checked={depositRefundMethod === m}
                                    onClick={() => setDepositRefundMethod(m)}
                                    className={`${COMMAND_BUTTON_SIZE_CLASSES} border cursor-pointer ${
                                      depositRefundMethod === m
                                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                                        : 'border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    {m === 'CASH' ? 'เงินสด' : 'โอนเงิน'}
                                  </button>
                                ))}
                              </div>
                            )}
                            {/* owner 2026-11-07: the tick row first, then what is left of the deposit */}
                            {depositUse > 0 && (
                              <div className="flex justify-between">
                                <span className="text-slate-600 dark:text-slate-400">หักค่าบริการจากมัดจำ:</span>
                                <span className="font-bold text-blue-700 dark:text-blue-300 tabular-nums">- {formatBaht(depositUse)}</span>
                              </div>
                            )}
                            {depositHeld > 0 && (
                              <div className="flex justify-between font-bold">
                                <span className="text-slate-700 dark:text-slate-300">มัดจำคงเหลือ (ต้องคืนลูกค้า):</span>
                                <span className="text-emerald-700 dark:text-emerald-400 tabular-nums">{formatBaht(depositLeft)}</span>
                              </div>
                            )}
                          </div>
                          {depositAction !== 'NONE' && depositAmount > 0 && (
                            <p className="col-span-2 text-right text-[10px] text-slate-600 dark:text-slate-400">
                              มัดจำคงเหลือหลังบันทึก {formatBaht(depositAfter)} บาท
                            </p>
                          )}

                          <div className="flex justify-between font-extrabold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 pt-0.5 col-span-2">
                            <span>ยอดรวมสุทธิ</span>
                            <span className="tabular-nums">{formatBaht(calcResult.grandTotalCharge + continuationTotal)}</span>
                          </div>

                          <div className="col-span-2">
                      {/* 3. Net Amount Banner */}
                      <div className="shrink-0 pt-1 text-center">
                        <span className="text-[11px] font-bold opacity-80 block leading-tight">
                          {netCash > 0
                            ? 'ลูกค้าต้องชำระเพิ่ม'
                            : netCash < 0
                            ? 'ต้องคืนเงินให้ลูกค้า'
                            : 'ชำระครบถ้วนแล้ว (ไม่มีค่าใช้จ่ายเพิ่มเติม)'}
                        </span>
                        <h2 className="text-lg sm:text-xl font-black tabular-nums leading-tight">
                          {formatBaht(Math.abs(netCash))}
                        </h2>
                        {depositDelta !== 0 && (
                          <span className="mt-0.5 block text-[11px] font-semibold opacity-80">
                            รวม{depositDelta > 0 ? 'มัดจำที่เพิ่ม' : 'มัดจำที่คืน'} {formatBaht(Math.abs(depositDelta))} บาทแล้ว
                          </span>
                        )}
                        {depositAction !== 'REFUND' && depositAfter > 0 && (
                          <span className="mt-0.5 block text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            มัดจำคงเหลือที่ต้องคืนลูกค้า {formatBaht(depositAfter)} บาท (ติ๊ก &quot;คืน&quot; เพื่อคืนตอนนี้ บิลจะปิดเมื่อคืนมัดจำแล้ว)
                          </span>
                        )}
                      </div>
                          </div>
                        </div>
                      </div>

                      {/* 4. Payment Inputs (when something is to be paid) */}
                      {payableNow > 0 && (
                        <div className="shrink-0 space-y-1.5">
                          {/* Payment Method Selector */}
                          <PaymentMethodSelector
                            selectedMethod={paymentChannel}
                            selectedMethods={pay.selectedMethods}
                            onSelectMethod={pay.selectMethod}
                            autoSelectFirst={false}
                            itemsPerRow={3}
                          />

                          {/* Dynamic Payment Content (once a method is chosen) */}
                          {paymentChannel && (
                          <PaymentDynamicContent
                            paymentMethod={paymentChannel}
                            targetAmount={pay.totals.restDue}
                            receivedCashInput={receivedCashInput}
                            onReceivedCashInputChange={setReceivedCashInput}
                            changeAmount={changeAmount}
                            bankRef={bankRef}
                            onBankRefChange={setBankRef}
                            qrCodeUrl={qrCodeUrl}
                            bankQrUrl={business?.bankQrDataUrl}
                            isQrLoading={isQrLoading}
                            promptPayId={promptPayId}
                            onConfirmCash={pay.confirmCash}
                            cashConfirmed={pay.cashConfirmed}
                            split={pay.split}
                            onClearSplit={pay.clearSplit}
                            onOpenQr={pay.qr.open}
                            focusCashSignal={pay.focusCash}
                            cashConfirmEmptyAllowed={pay.cashConfirmEmptyAllowed}
                            unpaidMessage={
                              <>
                                ⚠️ ยอดส่วนต่าง {pay.totals.restDue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}{' '}
                                จะถูกบันทึกเป็น <strong>&quot;ค้างชำระ &quot;</strong> ในระบบ
                              </>
                            }
                          />
                          )}
                        </div>
                      )}
                    </div>

                    {/* 5. Action Buttons Bar: same look and behaviour as the buttons of the POS payment page */}
                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                      <StepNavButton direction="back" onClick={handleBackStep} className="flex-1 min-w-0" />

                      <button
                        type="button"
                        disabled={
                          isSubmitting ||
                          (paymentChannel !== 'UNPAID' && payableNow > 0 && userCollectedAmount <= 0)
                        }
                        onClick={() => handleFinalCloseAndConfirmReturn()}
                        className={`${COMMAND_BUTTON_SIZE_CLASSES} flex-1 min-w-0 bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white flex items-center justify-center shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50 cursor-pointer`}
                      >
                        <FileCheck className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                        <span className="truncate">{isSubmitting ? 'กำลังบันทึกบิล...' : 'ออกบิล'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}
          </>
        )}

        {tab === 'DOCS' && activeBill && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-2 pt-0">
            <BillRecordsTab bill={activeBill} />
          </div>
        )}
      </div>

      {/* Post-Save Print Confirmation Modal */}
      <QrPaymentDialog
        isOpen={pay.qr.isOpen}
        onClose={pay.qr.close}
        amount={pay.qr.amount}
        editable={pay.qr.editable}
        promptPayId={promptPayId}
        bankQrUrl={business?.bankQrDataUrl}
        onConfirm={pay.qr.confirm}
      />

      <PostSavePrintModal
        isOpen={postSavePrintModal.isOpen}
        title={postSavePrintModal.title}
        description={postSavePrintModal.description}
        onPrint={() => {
          handlePrintReturnDocs(savedReturnInfo || undefined)
        }}
        onClose={() => {
          // Stay in the workspace: the panel already shows the saved result; go back with the arrow.
          setPostSavePrintModal({ isOpen: false, title: '', description: '' })
          setPrintDocs(null)
          setCurrentStep(1)
        }}
      />
    </div>
  )
}
