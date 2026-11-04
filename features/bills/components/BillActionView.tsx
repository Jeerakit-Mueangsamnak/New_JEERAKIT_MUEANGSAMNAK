'use client'

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
import { ReturnSlipPlaceholder } from '@/features/documents/components/ReturnSlipPlaceholder'
import { PaymentReceiptPlaceholder } from '@/features/documents/components/PaymentReceiptPlaceholder'
import { DamageReceiptPlaceholder } from '@/features/documents/components/DamageReceiptPlaceholder'
import { PaymentMethodSelector, PaymentMethodType } from '@/features/pos/components/payment/PaymentMethodSelector'
import { PaymentDynamicContent } from '@/features/pos/components/payment/PaymentDynamicContent'
import { useToast } from '@/components/common/Toast'
import { PostSavePrintModal } from '@/components/common/PostSavePrintModal'
import { BusinessSettings } from '@/lib/types/rental-pos'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { correctBill, createContinuation, processReturn, receivePayment } from '@/features/bills/services/bill-service'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { RentalBillTemplate, type BillTemplateData } from '@/templates/rental-bill/RentalBillTemplate'
import { billBusinessFields } from '@/features/documents/utils/rental-bill-print'
import { buildContinuationLine, formatBaht } from '@/features/bills/utils/bill-workspace'
import { refreshBillsCache } from '@/features/bills/services/bill-storage'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { ReturnTableStep } from '@/features/bills/components/ReturnTableStep'
import type { ReturnQuantityField } from '@/features/bills/components/ReturnTableStep'
import { BillWorkspaceHeader, type BillWorkspaceTab } from '@/features/bills/components/BillWorkspaceHeader'
import { BillDocumentsTab } from '@/features/bills/components/BillDocumentsTab'
import { BillHistoryTab } from '@/features/bills/components/BillHistoryTab'
import { isCancelledOrVoidBill } from '@/features/bills/utils/bill-list-presentation'
import { loadProducts } from '@/features/products/services/product-storage'
import {
  computeItemRentalCalculation,
  computeReturnCalculation,
} from '@/features/bills/services/return-calculation'

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
  const [savedReturnInfo, setSavedReturnInfo] = useState<{
    returnNo?: string
    receiptNo?: string
    paidAmount?: number
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
  const [paymentChannel, setPaymentChannel] = useState<PaymentMethodType>('CASH')
  const [receivedCashInput, setReceivedCashInput] = useState<string>('')
  const [bankRef, setBankRef] = useState<string>('')
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('')
  const [isQrLoading, setIsQrLoading] = useState<boolean>(false)

  const promptPayId = business?.promptPayValue || ''

  // --- Submitting State ---
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)

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
            usageCount: item.usageCount || 1,
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
    }
  }, [activeBill])

  // Calculations for Return (Reacts to changed dates & items)
  const calcResult: ReturnCalculationResult = useMemo(() => {
    if (!activeBill) return computeReturnCalculation('2026-01-01', '2026-01-01', actualReturnDate, [], 0, false, 0, rentalBilling)
    return computeReturnCalculation(
      billRentalStartDate,
      billScheduledReturnDate,
      actualReturnDate,
      inspectionItems.filter((i) => i.selected && (i.normalQty + i.damagedQty + i.lostQty) > 0),
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

  // What the customer pays now: what the old bill still needs + the new เช่าต่อ bill
  const payableNow = Math.max(0, calcResult.netAmount) + continuationTotal

  // Dynamic Documents available for Return Step 4 Preview
  const availableReturnDocs = useMemo<Array<'RETURN_SLIP' | 'RECEIPT' | 'DAMAGE_RECEIPT' | 'CONTINUATION_BILL'>>(() => {
    const continuing = continuationLines.length > 0
    // Nothing coming back: only the receipt (a debt is paid) or the new เช่าต่อ bill.
    if (!inspectionItems.some((i) => i.selected && getReturnedQty(i) > 0)) {
      return continuing ? ['CONTINUATION_BILL'] : ['RECEIPT']
    }
    const docs: Array<'RETURN_SLIP' | 'RECEIPT' | 'DAMAGE_RECEIPT' | 'CONTINUATION_BILL'> = ['RETURN_SLIP']
    const isPaid = paymentChannel !== 'UNPAID' && userCollectedAmount > 0
    const hasDamageOrLost = inspectionItems.some((i) => i.selected && ((i.damagedQty || 0) > 0 || (i.lostQty || 0) > 0)) || calcResult.totalDamageFee > 0
    const hasRentalOrLate = (calcResult.actualRentalFee + calcResult.lateFeeTotal) > 0

    if (isPaid) {
      if (hasRentalOrLate || !hasDamageOrLost) {
        docs.push('RECEIPT')
      }
      if (hasDamageOrLost) {
        docs.push('DAMAGE_RECEIPT')
      }
    } else if (hasDamageOrLost && calcResult.totalDamageFee > 0) {
      docs.push('DAMAGE_RECEIPT')
    }
    if (continuing) docs.push('CONTINUATION_BILL')
    return docs
  }, [paymentChannel, userCollectedAmount, calcResult.totalDamageFee, calcResult.actualRentalFee, calcResult.lateFeeTotal, inspectionItems, continuationLines.length])

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

  // What is paid now follows the method chosen (owner 2026-11-04): cash = the amount handed over, capped at what
  // is due (less than due = the rest stays unpaid); QR Code = in full; ค้างชำระ = nothing.
  useEffect(() => {
    if (currentStep !== 2) return
    const cashHandedOver = receivedCashInput === '' ? payableNow : parseFloat(receivedCashInput) || 0
    setUserCollectedAmount(
      paymentChannel === 'UNPAID' ? 0 : paymentChannel === 'CASH' ? Math.min(cashHandedOver, payableNow) : payableNow
    )
  }, [currentStep, paymentChannel, receivedCashInput, payableNow])

  const currentPayableAmount = useMemo(
    () => (payableNow > 0 ? (paymentChannel === 'UNPAID' ? 0 : userCollectedAmount) : 0),
    [payableNow, userCollectedAmount, paymentChannel]
  )

  const targetPayableForCash = payableNow > 0 ? userCollectedAmount : 0

  const receivedCash = receivedCashInput === '' ? targetPayableForCash : (parseFloat(receivedCashInput) || 0)
  const changeAmount = paymentChannel === 'CASH' ? Math.max(0, receivedCash - targetPayableForCash) : 0

  // Generate QR Code dynamically
  useEffect(() => {
    setQrCodeUrl('')
    setIsQrLoading(false)
  }, [paymentChannel, currentPayableAmount, promptPayId])

  // Derived saved document numbers & damage allocation values (safe preview without counter consumption)
  const savedDamageDocNo = 'รอสร้างเลขเอกสาร'
  const savedReceiptDocNo = 'รอสร้างเลขเอกสาร'

  const isDamageFullySettled = calcResult.remainingDebtAmount === 0 && userCollectedAmount >= calcResult.netAmount
  const damageCollectedValue = isDamageFullySettled ? calcResult.totalDamageFee : (userCollectedAmount === 0 ? 0 : undefined)
  const damageOutstandingValue = isDamageFullySettled ? 0 : calcResult.totalDamageFee

  // The new bill as the shared A4 bill template shows it (the number is given by the server when saved)
  const continuationBillData = (billNo?: string): BillTemplateData => ({
    ...billBusinessFields(business),
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

  // Unified Return Document Renderer for Preview, Full Preview, and Central Multi-Document Print
  const renderReturnDoc = (
    docType: 'RETURN_SLIP' | 'RECEIPT' | 'DAMAGE_RECEIPT' | 'CONTINUATION_BILL',
    customReceiptNo?: string,
    customDamageDocNo?: string,
    customReturnNo?: string,
    customContinuationNo?: string
  ) => {
    if (!activeBill) return null

    if (docType === 'CONTINUATION_BILL') {
      return <RentalBillTemplate data={continuationBillData(customContinuationNo)} />
    }

    if (docType === 'RETURN_SLIP') {
      return (
        <ReturnSlipPlaceholder
          businessName={business?.businessName}
          businessAddress={business?.address}
          businessTaxId={business?.taxId}
          businessPhone={business?.phone}
          logoDataUrl={business?.logoDataUrl}
          customerName={activeBill.customerName}
          customerPhone={activeBill.customerPhone}
          slipNo={customReturnNo || savedReturnInfo?.returnNo || 'รอสร้างเลขเอกสาร'}
          billNo={activeBill.billNo}
          returnDate={actualReturnDate}
          rentalStartDate={billRentalStartDate}
          scheduledReturnDate={billScheduledReturnDate}
          actualRentalDays={calcResult.actualRentalDays}
          lateDays={calcResult.lateDays}
          lateFeeTotal={calcResult.lateFeeTotal}
          totalDamageFee={calcResult.totalDamageFee}
          grandTotalCharge={calcResult.grandTotalCharge}
          netAmount={calcResult.netAmount}
          userCollectedAmount={savedReturnInfo?.paidAmount ?? userCollectedAmount}
          items={inspectionItems
            .filter((i) => i.selected && i.returnQty > 0)
            .map((i) => {
              const itemReturnDay = (i.rentalType === 'DAILY' && i.actualReturnDate) || actualReturnDate
              const itemCalc = computeItemRentalCalculation(
                i,
                {
                  rentalStartDate: billRentalStartDate,
                  scheduledReturnDate: billScheduledReturnDate,
                  actualReturnDate: itemReturnDay,
                },
                rentalBilling
              )
              return {
                name: i.productName,
                returnedQty: i.returnQty,
                normalQty: i.normalQty,
                damagedQty: i.damagedQty,
                lostQty: i.lostQty,
                damageFee: i.totalDamageFee,
                rentalStartDate: i.rentalStartDate || billRentalStartDate,
                scheduledReturnDate: i.scheduledReturnDate || billScheduledReturnDate,
                actualReturnDate: itemReturnDay,
                actualRentalDays: itemCalc.actualRentalDays,
                overdueDays: itemCalc.overdueDays,
                isOverdue: itemCalc.isOverdue,
                rentalType: i.rentalType,
              }
            })}
        />
      )
    }

    if (docType === 'DAMAGE_RECEIPT') {
      return (
        <DamageReceiptPlaceholder
          businessName={business?.businessName}
          businessAddress={business?.address}
          businessTaxId={business?.taxId}
          businessPhone={business?.phone}
          logoDataUrl={business?.logoDataUrl}
          customerName={activeBill.customerName}
          customerPhone={activeBill.customerPhone}
          customerAddress={activeBill.customerAddress}
          receiptNo={customDamageDocNo || savedDamageDocNo}
          billNo={activeBill.billNo}
          paymentDate={paymentDate}
          paymentChannel={paymentChannel}
          totalDamageFee={calcResult.repairFeeTotal}
          totalLossFee={calcResult.replacementFeeTotal}
          grandTotalDamage={calcResult.totalDamageFee}
          collectedAmount={damageCollectedValue}
          outstandingRemaining={damageOutstandingValue}
          items={inspectionItems
            .filter(
              (i) =>
                (i.damagedQty > 0 || i.lostQty > 0) &&
                (i.repairFeePerUnit > 0 || i.replacementFeePerUnit > 0 || i.totalDamageFee > 0)
            )
            .flatMap((i) => {
              const list = []
              if (i.damagedQty > 0) {
                list.push({
                  name: i.productName,
                  code: i.productCode,
                  type: 'DAMAGED' as const,
                  quantity: i.damagedQty,
                  feePerUnit: i.repairFeePerUnit,
                  totalFee: i.repairFeePerUnit * i.damagedQty,
                })
              }
              if (i.lostQty > 0) {
                list.push({
                  name: i.productName,
                  code: i.productCode,
                  type: 'LOST' as const,
                  quantity: i.lostQty,
                  feePerUnit: i.replacementFeePerUnit,
                  totalFee: i.replacementFeePerUnit * i.lostQty,
                })
              }
              return list
            })}
        />
      )
    }

    // Default: 'RECEIPT'
    return (
      <PaymentReceiptPlaceholder
        businessName={business?.businessName}
        businessAddress={business?.address}
        businessTaxId={business?.taxId}
        businessPhone={business?.phone}
        logoDataUrl={business?.logoDataUrl}
        customerName={activeBill.customerName}
        customerPhone={activeBill.customerPhone}
        customerAddress={activeBill.customerAddress}
        receiptNo={customReceiptNo || savedReturnInfo?.receiptNo || savedReceiptDocNo}
        billNo={activeBill.billNo}
        paymentDate={paymentDate}
        amount={savedReturnInfo?.paidAmount ?? (userCollectedAmount || payableNow)}
        paymentChannel={paymentChannel}
        outstandingRemaining={Math.max(0, payableNow - userCollectedAmount)}
        originalBillTotal={calcResult.grandTotalCharge + continuationTotal}
        note={`รับชำระส่วนต่างบิลเช่า ${activeBill.billNo}`}
      />
    )
  }

  // Global Multi-Document Print Handler for Return Flow (Prints all available documents in preview order)
  const handlePrintReturnDocs = async (savedNos?: { returnNo?: string; receiptNo?: string; damageNo?: string }) => {
    if (!activeBill) return
    const docs =
      printDocs ??
      availableReturnDocs.map((docType, idx) => (
        <div key={`${docType}-${idx}`} className="w-full">
          {renderReturnDoc(docType, savedNos?.receiptNo, savedNos?.damageNo, savedNos?.returnNo)}
        </div>
      ))
    await printDocuments(docs, {
      title: `เอกสารรับคืน_${activeBill.billNo}`,
    })
  }

  const handleSelectPaymentMethod = (method: PaymentMethodType) => {
    setPaymentChannel(method)
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

  // Double-click on a row selects that item (the tick box keeps toggling).
  const handleSelectItem = (idx: number) => {
    setInspectionItems((prev) => prev.map((item, i) => (i === idx ? { ...item, selected: true } : item)))
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

  // Deposit: one action per save — return part of it or add to it (the system only records it, Master §18).
  const chooseDepositAction = (next: 'REFUND' | 'ADD') => {
    if (depositAction === next) {
      setDepositAction('NONE')
      return
    }
    setDepositAction(next)
    // Returning starts from the whole deposit; adding starts empty.
    setDepositAmount(next === 'REFUND' ? activeBill?.heldDepositAmount || 0 : 0)
  }
  // Deposit counts in the net total (owner 2026-11-04): returned = money out, added = money in.
  const depositDelta = depositAction === 'ADD' ? depositAmount : depositAction === 'REFUND' ? -depositAmount : 0
  const netCash = payableNow + depositDelta
  const depositAfter =
    (activeBill?.heldDepositAmount || 0) + (depositAction === 'ADD' ? depositAmount : depositAction === 'REFUND' ? -depositAmount : 0)

  const handleFinalCloseAndConfirmReturn = async () => {
    if (!activeBill) return

    if (!actualReturnDate) {
      showToast('ยังไม่ได้กำหนดวันรับคืน', 'กรุณาเลือกวันรับคืนก่อนบันทึกรายการ', 'ERROR')
      return
    }

    const returnedItems = inspectionItems.filter((i) => i.selected && (i.normalQty + i.damagedQty + i.lostQty) > 0)
    const continuing = continuationLines
    const heldDeposit = activeBill.heldDepositAmount || 0
    const hasDepositAction = depositAction !== 'NONE' && depositAmount > 0

    if (depositAction !== 'NONE' && depositAmount > 0 && depositAction === 'REFUND' && depositAmount > heldDeposit) {
      showToast('คืนมัดจำเกินยอดที่ถืออยู่', `มัดจำที่ถืออยู่ ${formatBaht(heldDeposit)} บาท`, 'ERROR')
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

    // Records the deposit change; done before the return so the bill is still open for the correction.
    const applyDeposit = async () => {
      const next = depositAction === 'REFUND' ? heldDeposit - depositAmount : heldDeposit + depositAmount
      const note = [
        activeBill.depositNote,
        `${depositAction === 'REFUND' ? 'คืนมัดจำ' : 'เพิ่มมัดจำ'} ${formatBaht(depositAmount)} บาท (${getLocalDateString(new Date())})`,
      ]
        .filter(Boolean)
        .join(' | ')
      await correctBill(activeBill.id, { depositAmount: next, depositNote: note }, '')
    }
    const depositText = hasDepositAction
      ? `${depositAction === 'REFUND' ? 'คืนมัดจำ' : 'เพิ่มมัดจำ'} ${formatBaht(depositAmount)} บาท`
      : ''

    if (returnedItems.length === 0 && continuing.length === 0) {
      // Nothing comes back and nothing continues: only money (a debt, a deposit) is recorded.
      const collected = Math.min(userCollectedAmount, activeBill.outstandingAmount)
      const canPay = activeBill.outstandingAmount > 0 && paymentChannel !== 'UNPAID' && collected > 0
      if (!canPay && !hasDepositAction) {
        showToast('ไม่มีรายการคืน', 'กรุณาระบุจำนวนสินค้าที่คืนหรือเช่าต่อ หรือเลือกช่องทางและยอดที่รับชำระ', 'ERROR')
        return
      }
      if (canPay && (!paymentDate || paymentDate > getLocalDateString(new Date()))) {
        showToast('วันที่รับชำระไม่ถูกต้อง', 'วันที่รับเงินจริงต้องไม่อยู่ในอนาคต', 'ERROR')
        return
      }
      setIsSubmitting(true)
      try {
        if (hasDepositAction) await applyDeposit()
        let fresh: FullBill | null = null
        let receiptNo: string | undefined
        let paid = 0
        if (canPay) {
          const paymentResult = await receivePayment(
            activeBill.id,
            [{ method: paymentChannel, amount: collected, reference: bankRef || undefined }],
            paymentDate
          )
          fresh = paymentResult.bill
          if (!fresh) throw new Error('บันทึกแล้วแต่โหลดบิลใหม่ไม่สำเร็จ — กรุณารีเฟรช')
          receiptNo = paymentResult.receiptNo || undefined
          paid = paymentResult.totalAmount ?? collected
        }
        if (canPay) {
          setPrintDocs([
            <div key="RECEIPT" className="w-full">
              {renderReturnDoc('RECEIPT', receiptNo)}
            </div>,
          ])
        }
        const fresh2 = fresh
        if (fresh2) setBills((prev) => prev.map((b) => (b.id === fresh2.id ? fresh2 : b)))
        else setBills(await refreshBillsCache())
        showToast(
          canPay ? 'บันทึกรับชำระเงินสำเร็จ' : 'บันทึกมัดจำสำเร็จ',
          [canPay ? `รับชำระเงิน ${paid.toLocaleString('th-TH')} บาท` : '', depositText].filter(Boolean).join(' · ') + ' สำเร็จแล้ว',
          'SUCCESS'
        )
        setDepositAction('NONE')
        if (canPay) {
          setSavedReturnInfo({ receiptNo, paidAmount: paid })
          setPostSavePrintModal({
            isOpen: true,
            title: 'บันทึกรับชำระเงินสำเร็จ',
            description: 'รับชำระเงินเรียบร้อยแล้ว\nต้องการพิมพ์ใบเสร็จรับเงินหรือไม่?',
          })
        }
      } catch (err: any) {
        if (!isPinCancelled(err)) {
          showToast('เกิดข้อผิดพลาดในการบันทึก', err?.message || 'ไม่สามารถบันทึกรายการได้', 'ERROR')
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
      let suggestedRefund = 0

      if (hasDepositAction) await applyDeposit()

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
        suggestedRefund = result.suggestedRefund
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

      // 3) Money collected at the counter: the old bill first (what it now owes), the rest on the new bill.
      let receiptNo: string | null = null
      let paidAmount: number | null = null
      if (paymentChannel !== 'UNPAID' && userCollectedAmount > 0) {
        let left = userCollectedAmount
        const parentOwes = updatedBill ? Math.max(0, updatedBill.outstandingAmount) : 0
        const toParent = Math.min(left, parentOwes)
        if (toParent > 0) {
          const paymentResult = await receivePayment(activeBill.id, [
            { method: paymentChannel, amount: toParent, reference: bankRef || undefined },
          ], paymentDate)
          updatedBill = paymentResult.bill
          receiptNo = paymentResult.receiptNo
          paidAmount = paymentResult.totalAmount
          left -= toParent
        }
        const toChild = Math.min(left, continuationTotal)
        if (childBillId && toChild > 0) {
          const childPayment = await receivePayment(childBillId, [
            { method: paymentChannel, amount: toChild, reference: bankRef || undefined },
          ], paymentDate)
          receiptNo = receiptNo ?? childPayment.receiptNo
          paidAmount = (paidAmount ?? 0) + (childPayment.totalAmount ?? toChild)
          setBills(await refreshBillsCache())
        }
      }

      if (updatedBill) {
        const fresh = updatedBill
        setBills((prev) => prev.map((b) => (b.id === fresh.id ? fresh : b)))
      }

      const parts = [
        returnedItems.length > 0 ? `รับคืนสินค้า ใบคืน ${returnNo}` : '',
        paidAmount ? `รับชำระ ${paidAmount.toLocaleString('th-TH')} บาท` : '',
        continuing.length > 0 ? `เช่าต่อ บิลใหม่ ${childBillNo}` : '',
        depositText,
      ].filter(Boolean)
      showToast(
        returnedItems.length > 0 ? 'บันทึกรับคืนสินค้าสำเร็จ' : 'บันทึกเช่าต่อสำเร็จ',
        suggestedRefund > 0
          ? `${parts.join(' · ')} — ลูกค้าจ่ายเกิน ${suggestedRefund.toLocaleString('th-TH')} กดปุ่ม "คืนเงินรับชำระ" เพื่อคืนเงิน`
          : `${parts.join(' · ')} สำเร็จแล้ว`,
        'SUCCESS'
      )

      // Keep the documents exactly as previewed (the form resets when the bill is refreshed).
      setPrintDocs(
        availableReturnDocs.map((docType, idx) => (
          <div key={`${docType}-${idx}`} className="w-full">
            {renderReturnDoc(docType, receiptNo || undefined, undefined, returnNo || undefined, childBillNo || undefined)}
          </div>
        ))
      )
      setSavedReturnInfo({ returnNo, receiptNo: receiptNo || undefined, paidAmount: paidAmount ?? undefined })
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
        err?.message || 'ไม่สามารถบันทึกรายการได้',
        'ERROR'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-0 h-full w-full overflow-hidden animate-in fade-in duration-150 gap-2 sm:gap-2.5">
      {/* Bill identity + tabs (รับคืน / รับชำระ / เอกสาร / ประวัติ) */}
      {activeBill && (
        <BillWorkspaceHeader
          tab={tab}
          onTab={setTab}
          returnDisabled={isCancelledOrVoidBill(activeBill)}
        />
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
                  (activeBill.outstandingAmount > 0 && !isCancelledOrVoidBill(activeBill))
                }
                onToggleSelectAll={handleToggleSelectAll}
                onToggleSelectItem={handleToggleSelectItem}
                onSelectItem={handleSelectItem}
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
                <div className="flex-1 min-h-0 h-full w-full grid grid-cols-1 md:grid-cols-[minmax(0,58fr)_minmax(300px,42fr)] lg:grid-cols-[minmax(0,60fr)_minmax(340px,40fr)] gap-2 md:gap-2.5 lg:gap-3 overflow-hidden">
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
                      <A4FitPreview paddingPx={1} className="h-full w-full" align="center">
                        {renderReturnDoc(availableReturnDocs[returnDocIndex])}
                      </A4FitPreview>
                    </div>

                    {/* Next Button Zone (Outside A4) */}
                    {availableReturnDocs.length > 1 && (
                      <button
                        type="button"
                        onClick={handleNextReturnDoc}
                        aria-label="เอกสารถัดไป"
                        className="w-7 sm:w-9 h-full flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors z-10 shrink-0 cursor-pointer group"
                        title="เอกสารถัดไป (ใบรับคืน / ใบเสร็จรับเงิน / ใบเสร็จค่าชำรุด)"
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
                              <span className="font-bold tabular-nums">{formatBaht(calcResult.persistedGrandTotal + continuationTotal)}</span>
                            </div>
                            {continuationTotal > 0 && (
                              <p className="text-right text-[10px] text-blue-700 dark:text-blue-300">รวมเช่าต่อ {formatBaht(continuationTotal)}</p>
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

                          {/* เงินมัดจำ: one row, one action. Neither box ticked = the amount stays as it is. */}
                          <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 dark:border-slate-700 pt-1">
                            <span className="text-slate-600 dark:text-slate-400">เงินมัดจำ</span>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={depositAction === 'REFUND'}
                                onChange={() => chooseDepositAction('REFUND')}
                                disabled={activeBill.heldDepositAmount <= 0}
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
                              value={depositAction === 'NONE' ? activeBill.heldDepositAmount : depositAmount || ''}
                              onChange={(val) => setDepositAmount(val === '' ? 0 : Math.max(0, val))}
                              disabled={depositAction === 'NONE'}
                              min={0}
                              max={depositAction === 'REFUND' ? activeBill.heldDepositAmount : undefined}
                              aria-label="จำนวนเงินมัดจำ"
                              className="ml-auto w-24 h-7 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 text-right text-xs font-bold tabular-nums disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-600 dark:disabled:text-slate-400"
                            />
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
                            : calcResult.netAmount < 0
                            ? 'คืนเงินมัดจำให้ลูกค้า'
                            : 'ชำระครบถ้วนแล้ว (ไม่มีค่าใช้จ่ายเพิ่มเติม)'}
                        </span>
                        <h2 className="text-lg sm:text-xl font-black tabular-nums leading-tight">
                          {netCash !== 0 ? '' : calcResult.netAmount < 0 ? '- ' : ''}
                          {formatBaht(netCash !== 0 ? Math.abs(netCash) : Math.abs(calcResult.netAmount))}
                        </h2>
                        {depositDelta !== 0 && (
                          <span className="mt-0.5 block text-[11px] font-semibold opacity-80">
                            รวม{depositDelta > 0 ? 'มัดจำที่เพิ่ม' : 'มัดจำที่คืน'} {formatBaht(Math.abs(depositDelta))} บาทแล้ว
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
                            onSelectMethod={handleSelectPaymentMethod}
                            itemsPerRow={3}
                          />

                          {/* Dynamic Payment Content */}
                          <PaymentDynamicContent
                            paymentMethod={paymentChannel}
                            targetAmount={userCollectedAmount}
                            receivedCashInput={receivedCashInput}
                            onReceivedCashInputChange={setReceivedCashInput}
                            changeAmount={changeAmount}
                            bankRef={bankRef}
                            onBankRefChange={setBankRef}
                            qrCodeUrl={qrCodeUrl}
                            bankQrUrl={business?.bankQrDataUrl}
                            isQrLoading={isQrLoading}
                            promptPayId={promptPayId}
                            unpaidMessage={
                              <>
                                ⚠️ ยอดส่วนต่าง {payableNow.toLocaleString('th-TH', { minimumFractionDigits: 2 })}{' '}
                                จะถูกบันทึกเป็น <strong>&quot;ค้างชำระ &quot;</strong> ในระบบ
                              </>
                            }
                          />
                        </div>
                      )}
                    </div>

                    {/* 5. Action Buttons Bar: same look and behaviour as the buttons of the POS payment page */}
                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={handleBackStep}
                        className="flex-1 min-w-0 rounded-xl bg-slate-100 dark:bg-slate-700/80 px-2 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.99] text-slate-700 dark:text-slate-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all min-h-[44px] cursor-pointer"
                      >
                        <span className="truncate">ย้อนกลับ</span>
                      </button>

                      <button
                        type="button"
                        disabled={
                          isSubmitting ||
                          (paymentChannel !== 'UNPAID' && payableNow > 0 && userCollectedAmount <= 0)
                        }
                        onClick={() => handleFinalCloseAndConfirmReturn()}
                        className="flex-1 min-w-0 rounded-xl bg-emerald-700 px-2 py-2.5 hover:bg-emerald-800 active:scale-[0.99] text-white font-black text-xs sm:text-sm md:text-base flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
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

        {tab === 'DOCS' && activeBill && <BillDocumentsTab bill={activeBill} />}
        {tab === 'HISTORY' && activeBill && <BillHistoryTab bill={activeBill} />}
      </div>

      {/* Post-Save Print Confirmation Modal */}
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
