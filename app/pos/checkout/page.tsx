'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BillTemplateData } from '@/features/documents/utils/rental-bill-print'
import { A4FitPreview } from '@/features/pos/components/A4FitPreview'
import { Printer, Save } from 'lucide-react'
import { StepNavButton } from '@/components/common/ActionButton'
import { PaymentMethodSelector, type PaymentMethodType } from '@/features/pos/components/payment/PaymentMethodSelector'
import { PaymentDynamicContent } from '@/features/pos/components/payment/PaymentDynamicContent'
import { useDocumentVatMode } from '@/features/pos/hooks/useDocumentVatMode'
import { DocumentSummaryLayout, DocumentSummaryPanel, documentSummaryRows } from '@/features/pos/components/DocumentSummaryPanel'
import { Customer, Product } from '@/lib/types/rental-pos'
import { useToast } from '@/components/common/Toast'
import { useNotice } from '@/components/common/ConfirmDialogProvider'
import { PAYMENT_NOT_CHOSEN_NOTICE } from '@/features/pos/hooks/useCashConfirmation'
import { useSplitPayment } from '@/features/pos/hooks/useSplitPayment'
import { QrPaymentDialog } from '@/features/pos/components/payment/QrPaymentDialog'
import { PostSavePrintModal } from '@/components/common/PostSavePrintModal'
import { getLocalDateString } from '@/components/common/CustomDatePicker'
import { isVatRateConfigured } from '@/features/settings/services/settings-storage'
import {
  loadActiveCart,
  saveActiveCart,
  clearActiveCart,
  isSaleCartItem,
  validateCartCustomer,
  cartLineUnitPriceForServer,
  customerContactPhones,
} from '@/features/pos/services/cart-storage'
import { issueBill, deliverBill, type BillDraftInput, type BillLineInput } from '@/features/bills/services/bill-service'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { calculateBillTotals } from '@/lib/calculation-service'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import type { DocumentTemplate } from '@/lib/types/document'
import { loadDocumentNames, getSharedTemplates } from '@/features/documents/services/template-library-storage'
import {
  FINE_FORM_NAME,
  MAIN_BILL_FORM_NAME,
  RETURN_FORM_NAME,
  billPrintForms,
  pickBillFormTemplate,
  renderBillFormPagesHtml,
} from '@/features/documents/utils/transaction-print'
import { isNoChargeRental } from '@/features/pos/services/accessory-rules'

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : '')

const safeFormatDateStr = (d?: Date | string | null): string => {
  if (!d) return '-'
  try {
    const dt = new Date(d)
    if (isNaN(dt.getTime())) return '-'
    return getLocalDateString(dt)
  } catch {
    return '-'
  }
}

export default function CheckoutPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const { settings } = useSystemSettings()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [items, setItems] = useState<Array<{
    product: Product
    quantity: number
    unitPrice: number
    rentalType: 'NORMAL' | 'DAILY' | 'SALE'
    usageCount?: number
    billableDays?: number
    dailyStartDate?: Date | string | null
    dailyEndDate?: Date | string | null
    lineTotal: number
    itemType?: 'RENT' | 'SALE'
    requiresReturn?: boolean
    productName?: string
    unitName?: string
    /** รายการนอกร้าน (no product, no stock) */
    isCustom?: boolean
  }>>([])
  const [billDate, setBillDate] = useState<Date | null>(new Date())
  const [headerRentalDate, setHeaderRentalDate] = useState<Date | null>(new Date())
  const [headerReturnDate, setHeaderReturnDate] = useState<Date | null>(null)
  const [discount, setDiscount] = useState<number>(0)
  const [shippingFee, setShippingFee] = useState<number>(0)
  const [depositAmount, setDepositAmount] = useState<number>(0)
  const [documentType, setDocumentType] = useState<string>('')
  const [shippingAddress, setShippingAddress] = useState<string>('')
  const [remark, setRemark] = useState<string>('')
  const [contactPhone, setContactPhone] = useState<string>('')
  const cartLoadedRef = useRef(false)
  const [quotationId, setQuotationId] = useState<string | null>(null)
  // Goods leave with the customer now (default) — or later / in parts from the bills screen.
  const [deliverNow, setDeliverNow] = useState<boolean>(true)
  // VAT of this bill, chosen here with the two buttons รวม VAT / ไม่รวม VAT (owner 2026-11-04):
  // none pressed = no VAT; the chosen mode is sent with the draft and snapshotted by the server.
  // รวม / ไม่รวม VAT of this bill (shared with the POS cart and the quotation page)
  const vat = useDocumentVatMode()
  const loadVat = vat.load

  useEffect(() => {
    const cart = loadActiveCart()
    if (cart) {
      if (cart.customer) setCustomer(cart.customer)
      if (cart.items && cart.items.length > 0) setItems(cart.items)
      if (cart.discount !== undefined) setDiscount(cart.discount)
      if (cart.shippingFee !== undefined) setShippingFee(cart.shippingFee)
      if (cart.depositAmount !== undefined) setDepositAmount(cart.depositAmount)
      if (cart.documentType) setDocumentType(cart.documentType)
      // The issue date picked in the cart (📝) is the bill's date on the form, not today.
      if (cart.documentDate) setBillDate(new Date(`${cart.documentDate.slice(0, 10)}T00:00:00`))
      if (cart.shippingAddress) setShippingAddress(cart.shippingAddress)
      if (cart.remark) setRemark(cart.remark)
      if (cart.contactPhone) setContactPhone(cart.contactPhone)
      if (cart.headerRentalDate) setHeaderRentalDate(new Date(cart.headerRentalDate))
      if (cart.headerReturnDate) setHeaderReturnDate(new Date(cart.headerReturnDate))
      if (cart.quotationId) setQuotationId(cart.quotationId)
      loadVat(cart.vatMode, cart.vatEnabled)
    }
    cartLoadedRef.current = true
  }, [loadVat])

  // ประเภทเอกสาร = a name of จัดการเอกสาร › แบบฟอร์มบิล: the bill shows and prints on that form, the same
  // form whatever the payment (owner 2026-11-07); any other value is printed on the shop's main bill form. null = still reading.
  const [library, setLibrary] = useState<{ templates: DocumentTemplate[]; formNames: string[] } | null>(null)
  useEffect(() => {
    let alive = true
    getSharedTemplates()
      .then((templates) => {
        if (!alive) return
        const formNames = loadDocumentNames().filter((n) => n.targetGroup === 'BILL').map((n) => n.name)
        setLibrary({ templates, formNames })
      })
      .catch((err: unknown) => {
        console.error('Reading the bill forms failed:', err)
        if (alive) setLibrary({ templates: [], formNames: [] })
      })
    return () => {
      alive = false
    }
  }, [])
  // Names already read by the POS cart are known while this page reads the forms again.
  const formNames = library
    ? library.formNames
    : loadDocumentNames().filter((n) => n.targetGroup === 'BILL').map((n) => n.name)
  // A cart kept from before the forms (บิลเช่า/ขาย, nothing picked) prints on the main bill form.
  const formName = formNames.includes(documentType) ? documentType : MAIN_BILL_FORM_NAME
  const billForm = library ? pickBillFormTemplate(library.templates, formName) : undefined
  // Printing waits for the forms; it never prints without one.
  const billFormPending = library === null

  // The mode in use: the button pressed here, else the shop's price mode for a bill that came with VAT on.
  const effectiveVatMode = vat.effective

  // Discount / shipping / deposit / VAT are chosen here: keep them in the saved cart so going back to the POS
  // and forward again does not lose them.
  useEffect(() => {
    if (!cartLoadedRef.current) return
    const cart = loadActiveCart()
    if (cart) {
      saveActiveCart({ ...cart, discount, shippingFee, depositAmount, vatEnabled: effectiveVatMode !== null, vatMode: effectiveVatMode })
    }
  }, [discount, shippingFee, depositAmount, effectiveVatMode])

  // VAT of this bill: the rate comes only from Settings (the owner sets it); รวม / ไม่รวม is this bill's own button.
  const vatConfigured = isVatRateConfigured(settings)
  const vatOn = effectiveVatMode !== null && vatConfigured
  const vatInclusive = vatOn && effectiveVatMode === 'INCLUSIVE'
  const toggleVatMode = vat.toggle
  const totals = calculateBillTotals({
    settings,
    items,
    discount,
    shippingFee,
    depositAmount,
    enableVat: vatOn,
    vatMode: vatOn ? effectiveVatMode : null,
  })
  const tax = totals.vatAmount
  const subtotal = totals.subtotal
  const grandTotal = totals.grandTotal
  // Owner 2026-11-02: the customer pays the bill and the deposit together at the counter.
  // The payment record stays the bill total; the deposit is kept on the bill itself.
  const depositToCollect = Math.max(0, Number(depositAmount) || 0)
  const amountToCollect = totals.totalPayableWithDeposit

  const clearCart = () => {
    clearActiveCart()
    setItems([])
    setCustomer(null)
  }

  // Payment State
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType | null>(null)
  const [receivedCashInput, setReceivedCashInput] = useState<string>('')
  const [bankRef, setBankRef] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  // What was saved, frozen before the cart is cleared, so "พิมพ์" prints the real bill
  const [savedPrintData, setSavedPrintData] = useState<BillTemplateData | null>(null)

  // Print window after ออกบิล: the title stays; the shop's bill forms are listed to tick (owner 2026-11-12)
  const [postSavePrintModal, setPostSavePrintModal] = useState<{ isOpen: boolean; title: string }>({ isOpen: false, title: '' })

  const notice = useNotice()
  // เงินสด / QR Code / both (the first one pressed is taken first, the other takes the rest)
  const pay = useSplitPayment({
    due: amountToCollect,
    method: paymentMethod,
    setMethod: setPaymentMethod,
    cashInput: receivedCashInput,
    setCashInput: setReceivedCashInput,
  })
  const changeAmount = paymentMethod === 'CASH' ? pay.totals.change : 0

  // Format template data for live preview
  const billData: BillTemplateData = {
    customerName: customer?.customerName || 'ลูกค้าทั่วไป',
    customerAddress: customer?.address,
    customerPhone: contactPhone.trim() || customerContactPhones(customer) || undefined,
    customerTaxId: customer?.taxId,
    billNo: 'รอสร้างเลขเอกสาร',
    billDate: safeFormatDateStr(billDate),
    headerRentalDate: safeFormatDateStr(headerRentalDate),
    headerReturnDate: safeFormatDateStr(headerReturnDate),
    siteName: shippingAddress ? shippingAddress.trim() : undefined,

    items: items.map((i) => ({
      code: i.product.product_code || i.product.code,
      name: i.product.product_name || i.product.name,
      quantity: i.quantity,
      unit: i.product.unit_name || i.product.unit || 'ชิ้น',
      price: i.unitPrice,
      rentalType: i.rentalType,
      usageCount: i.usageCount,
      billableDays: i.billableDays,
      dailyStartDate: safeFormatDateStr(i.dailyStartDate),
      dailyEndDate: safeFormatDateStr(i.dailyEndDate),
      lineTotal: i.lineTotal,
      // "ไม่คิดเงิน" rental: the printed form shows ราคา / การเช่า / จำนวนเงิน as "-" (owner 2026-11-09).
      isNoCharge: i.rentalType !== 'SALE' && isNoChargeRental(i.product),
    })),
    subtotal,
    discount: discount || 0,
    shippingFee: shippingFee || 0,
    taxAmount: tax,
    vatRatePercent: tax > 0 ? Math.round(totals.vatRate * 10000) / 100 : undefined,
    depositAmount: depositAmount || 0,
    grandTotal,
    // ค้างชำระ keeps cash already confirmed (owner 2026-11-11); what is not taken stays owed, deposit included
    paidAmount: !paymentMethod ? 0 : paymentMethod === 'UNPAID' ? Math.min(grandTotal, pay.totals.collected) : grandTotal,
    outstandingAmount: !paymentMethod ? amountToCollect : paymentMethod === 'UNPAID' ? pay.totals.remaining : 0,
    remark: remark || undefined,
  }

  // The saved bill on each of the shop's bill forms, for the print window (a return / fine form needs a return)
  const printChoices = useMemo(
    () =>
      postSavePrintModal.isOpen && savedPrintData && library
        ? billPrintForms(library.templates, [RETURN_FORM_NAME, FINE_FORM_NAME]).map((t) => ({
            name: t.name.trim(),
            pages: renderBillFormPagesHtml(savedPrintData, settings.business, t),
          }))
        : [],
    [postSavePrintModal.isOpen, savedPrintData, library, settings.business]
  )
  const leaveAfterSave = () => {
    clearCart()
    setPostSavePrintModal({ isOpen: false, title: '' })
    router.push('/pos')
  }

  /** Cart → server draft (Master v4.3.1 §12): the server prices it, checks price overrides
   *  (PIN + reason) and keeps the deposit on the bill. Dates: daily items bill the days picked
   *  on their card; per-round items use the header dates only as return reminders. */
  const buildDraftInput = (): BillDraftInput => {
    const startOfDay = (d?: Date | string | null) => {
      const dt = d ? new Date(d) : new Date()
      return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0)
    }
    const endOfDay = (d?: Date | string | null) => {
      const dt = d ? new Date(d) : new Date()
      return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59)
    }
    const headerStart = startOfDay(headerRentalDate)
    const headerEnd = endOfDay(headerReturnDate ?? headerRentalDate)

    const lines: BillLineInput[] = items.map((it) => {
      const unitPrice = cartLineUnitPriceForServer(it)
      // รายการนอกร้าน: no product id; its own name and unit go with the line
      const product = it.isCustom
        ? { productId: null, productName: it.productName || it.product.name, unitName: it.unitName || it.product.unit }
        : { productId: it.product.id }
      if (isSaleCartItem(it)) {
        return { ...product, mode: 'SALE', quantity: it.quantity, unitPrice }
      }
      if (it.rentalType === 'DAILY') {
        return {
          ...product,
          mode: 'RENTAL',
          quantity: it.quantity,
          unitPrice,
          calc: 'PER_DAY',
          periods: Math.max(1, Number(it.billableDays) || 1),
          startAt: startOfDay(it.dailyStartDate ?? headerRentalDate).toISOString(),
          endAt: endOfDay(it.dailyEndDate ?? it.dailyStartDate ?? headerReturnDate ?? headerRentalDate).toISOString(),
        }
      }
      return {
        ...product,
        mode: 'RENTAL',
        quantity: it.quantity,
        unitPrice,
        calc: 'PER_PERIOD',
        periods: Math.max(1, Number(it.usageCount) || 1),
        startAt: headerStart.toISOString(),
        endAt: (headerEnd > headerStart ? headerEnd : endOfDay(headerStart)).toISOString(),
      }
    })

    const note = [
      remark?.trim(),
      shippingAddress?.trim() ? `ส่งที่: ${shippingAddress.trim()}` : '',
      contactPhone.trim() ? `โทร: ${contactPhone.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    return {
      customerId: customer?.id || null,
      // A typed name with no customer record stays on the bill only (owner 2026-11-16)
      guestName: customer && !customer.id ? customer.customerName : null,
      quotationId: quotationId || null,
      vatEnabled: vatOn,
      vatMode: vatOn ? effectiveVatMode : null,
      note: note || undefined,
      discountAmount: discount || 0,
      deliveryFee: shippingFee || 0,
      depositAmount: depositAmount || 0,
      isCreditBill: false,
      dueDate: null,
      // วันที่ออกเอกสาร picked at the POS is kept on the bill (owner 2026-11-17)
      documentDate: billDate ? getLocalDateString(billDate) : null,
      lines,
    }
  }

  /** Screen-side guard before anything is sent: items, payment method, customer, cash. */
  const validateCheckout = (selectedPaymentMethod: PaymentMethodType): boolean => {
    if (items.length === 0) {
      showToast('ไม่สามารถออกบิลได้', 'ไม่มีรายการสินค้าในตะกร้า', 'ERROR')
      return false
    }
    try {
      validateCartCustomer(items, customer)
    } catch {
      // No pop-up: back to the cart, where the customer field blinks until it is clicked.
      router.push(`${backToPosHref}&customerRequired=1`)
      return false
    }
    // A bill is paid in full here (or ค้างชำระ); cash + QR together must cover the whole amount
    if (selectedPaymentMethod !== 'UNPAID' && pay.totals.remaining > 0.004) {
      showToast('ยังรับเงินไม่ครบ', `ขาดอีก ${pay.totals.remaining.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`, 'ERROR')
      return false
    }
    return true
  }

  /**
   * One server step (owner 2026-11-24: no draft bills): save + confirm together; a refusal saves nothing.
   * The server cuts the money to its own total (bill + deposit), methods in the order taken, then
   * ค่าสินค้าขาย → ค่าขนส่ง → มัดจำ → ค่าเช่า, the rest owed (owner 2026-11-11).
   */
  const issueThisBill = (selectedPaymentMethod: PaymentMethodType, isUnpaid: boolean) => {
    // One method for the exact amount (QR Code, or an empty cash box) pays whatever the server's total is
    const exact = !isUnpaid && !pay.part && (selectedPaymentMethod !== 'CASH' || receivedCashInput === '')
    // ค้างชำระ after cash confirmed for part of the amount sends that cash only
    const taken = exact
      ? [{ method: selectedPaymentMethod, amount: amountToCollect }]
      : isUnpaid && !pay.part
        ? []
        : pay.totals.tenders
    return issueBill(buildDraftInput(), {
      tenders: taken.map((t) => ({ ...t, reference: t.method === 'CASH' ? undefined : bankRef || undefined })),
      payExact: exact,
      allowShort: isUnpaid,
    })
  }

  /** Stock moves only with a real delivery (Master §11.3); failures do not undo the bill. */
  const deliverIfNeeded = async (billId: string, confirmed: Awaited<ReturnType<typeof issueBill>>) => {
    if (!deliverNow || !confirmed) return
    const lines = confirmed.items
      .filter((it) => (it.remainingQty ?? 0) > 0)
      .map((it) => ({ lineId: it.rentalBillItemId, quantity: it.remainingQty ?? 0 }))
    if (lines.length === 0) return
    try {
      await deliverBill(billId, lines)
    } catch (deliveryErr: unknown) {
      showToast('ออกบิลแล้ว แต่บันทึกส่งของไม่สำเร็จ', `${errorMessage(deliveryErr)} — ส่งของได้ที่หน้าจัดการบิล`, 'ERROR')
    }
  }

  const handleConfirmBill = async (showDocumentPicker = true) => {
    const selectedPaymentMethod = paymentMethod
    if (!selectedPaymentMethod) {
      await notice(PAYMENT_NOT_CHOSEN_NOTICE)
      return
    }
    if (pay.blocker) {
      await notice(pay.blocker)
      return
    }
    setIsSubmitting(true)
    try {
      if (!validateCheckout(selectedPaymentMethod)) return

      const allItemsAreSale = items.length > 0 && items.every((it) => isSaleCartItem(it))
      const isUnpaid = selectedPaymentMethod === 'UNPAID'

      const confirmed = await issueThisBill(selectedPaymentMethod, isUnpaid)
      if (confirmed) await deliverIfNeeded(confirmed.id, confirmed)

      const billNo = confirmed?.billNo || ''
      const savedTotal = confirmed?.grandTotal ?? grandTotal
      setSavedPrintData({
        ...billData,
        billNo,
        grandTotal: savedTotal,
        // The server's numbers: what the bill got and what is still owed (an unpaid deposit included)
        paidAmount: confirmed ? confirmed.paidAmount : isUnpaid ? 0 : savedTotal,
        outstandingAmount: confirmed ? confirmed.outstandingAmount : isUnpaid ? savedTotal : 0,
      })
      clearCart()

      const billTitle = allItemsAreSale ? 'บันทึกการขายสำเร็จ' : 'บันทึกบิลเช่าสำเร็จ'

      showToast(billTitle, `เลขที่บิล: ${billNo}`, 'SUCCESS')
      if (showDocumentPicker) {
        setPostSavePrintModal({ isOpen: true, title: billTitle })
      } else {
        // Same save/confirm/delivery flow as ออกบิล; this button only skips document selection.
        leaveAfterSave()
      }
    } catch (err: unknown) {
      if (isPinCancelled(err)) return
      showToast('เกิดข้อผิดพลาดในการบันทึกบิล', errorMessage(err) || 'โปรดตรวจสอบข้อมูลอีกครั้ง', 'ERROR')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Back to the cart without losing it: the POS reloads the cart saved before checkout
  // (and keeps the quotation this bill comes from).
  const backToPosParams = new URLSearchParams({ resume: '1' })
  if (quotationId) backToPosParams.set('quotationId', quotationId)
  const backToPosHref = `/pos?${backToPosParams.toString()}`

  // The bill on the left: the shop form picked in ประเภทเอกสาร (else the main bill form).
  let billPreview: React.ReactNode
  if (billForm) {
    billPreview = (
      <A4FitPreview paddingPx={1} className="h-full w-full" align="center">
        <div
          className="h-full w-full bg-white p-8 font-sans text-xs text-slate-900"
          // Pages come from renderDocumentTemplate, which already sanitizes the HTML.
          dangerouslySetInnerHTML={{ __html: renderBillFormPagesHtml(savedPrintData ?? billData, settings.business, billForm)[0] ?? '' }}
        />
      </A4FitPreview>
    )
  } else {
    billPreview = (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-600 dark:text-slate-400">
        {billFormPending ? 'กำลังโหลดแบบฟอร์ม...' : `ไม่พบแบบฟอร์มของ "${formName}" กรุณาเพิ่มที่ ตั้งค่าระบบ › เทมเพลต`}
      </div>
    )
  }

  return (
    <>
    <DocumentSummaryLayout
      className="pos-checkout-print-root"
      formTabLabel="ฟอร์มชำระเงิน"
      previewTabLabel="ดูตัวอย่างบิล A4"
      preview={billPreview}
    >
      <DocumentSummaryPanel
        title="ชำระเงิน"
        discount={discount}
        onDiscountChange={setDiscount}
        shippingFee={shippingFee}
        onShippingFeeChange={setShippingFee}
        depositAmount={depositAmount}
        onDepositAmountChange={setDepositAmount}
        disabled={isSubmitting}
        vatRate={settings.taxDiscount?.vatRate}
        vatMode={vatOn ? effectiveVatMode : null}
        onToggleVat={toggleVatMode}
        rows={documentSummaryRows({ totals, vatInclusive, depositAmount: depositToCollect })}
        totalLabel="ยอดคงต้องชำระ"
        totalAmount={amountToCollect}
        footer={
          <>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deliverNow}
                onChange={(e) => setDeliverNow(e.target.checked)}
                className="w-4 h-4 text-emerald-700 dark:text-emerald-400 rounded"
              />
              <span>รับของแล้ว</span>
            </label>
            {/* 3 equal buttons, each as wide as the longest label; never wider than the panel (owner 2026-11-17) */}
            <div className="grid w-fit max-w-full grid-flow-col auto-cols-[minmax(0,1fr)] gap-2 self-end">
              <StepNavButton
                direction="back"
                onClick={() => router.push(backToPosHref)}
                disabled={isSubmitting}
                className="min-w-0 min-h-[44px] gap-1.5 text-xs sm:text-sm"
              />

              <button
                type="button"
                onClick={() => handleConfirmBill(false)}
                disabled={isSubmitting}
                className="min-w-0 whitespace-nowrap rounded-xl border-2 border-emerald-700 bg-white px-3 py-2.5 hover:bg-emerald-50 active:scale-[0.99] text-emerald-800 dark:border-emerald-600 dark:bg-slate-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span className="truncate">บันทึก</span>
              </button>

              <button
                type="button"
                onClick={() => handleConfirmBill()}
                disabled={isSubmitting}
                className="min-w-0 whitespace-nowrap rounded-xl bg-emerald-700 px-3 py-2.5 hover:bg-emerald-800 active:scale-[0.99] text-white font-black text-xs sm:text-sm md:text-base flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
              >
                <Printer className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                <span className="truncate">
                  {isSubmitting ? 'กำลังบันทึกบิล...' : 'ออกบิล'}
                </span>
              </button>
            </div>
          </>
        }
      >
        {/* Payment Method Selector — one row, equal-size buttons */}
        <PaymentMethodSelector
          selectedMethod={paymentMethod}
          selectedMethods={pay.selectedMethods}
          onSelectMethod={pay.selectMethod}
          autoSelectFirst={false}
          showLabel={false}
          itemsPerRow={3}
        />

        {/* Dynamic Inputs per Method */}
        {paymentMethod ? (
          <PaymentDynamicContent
            paymentMethod={paymentMethod}
            targetAmount={pay.totals.restDue}
            receivedCashInput={receivedCashInput}
            onReceivedCashInputChange={setReceivedCashInput}
            changeAmount={changeAmount}
            bankRef={bankRef}
            onBankRefChange={setBankRef}
            bankQrUrl={settings.business?.bankQrDataUrl}
            promptPayId={settings.business?.promptPayValue}
            onConfirmCash={pay.confirmCash}
            cashConfirmed={pay.cashConfirmed}
            split={pay.split}
            onClearSplit={pay.clearSplit}
            onOpenQr={pay.qr.open}
            focusCashSignal={pay.focusCash}
            cashConfirmEmptyAllowed={pay.cashConfirmEmptyAllowed}
          />
        ) : null}
      </DocumentSummaryPanel>
    </DocumentSummaryLayout>

      <QrPaymentDialog
        isOpen={pay.qr.isOpen}
        onClose={pay.qr.close}
        amount={pay.qr.amount}
        editable={pay.qr.editable}
        promptPayId={settings.business?.promptPayValue}
        bankQrUrl={settings.business?.bankQrDataUrl}
        onConfirm={pay.qr.confirm}
      />

      {/* Post-Save Print Confirmation Modal */}
      <PostSavePrintModal
        isOpen={postSavePrintModal.isOpen}
        title={postSavePrintModal.title}
        forms={printChoices}
        defaultSelected={[formName]}
        loading={billFormPending}
        printTitle={savedPrintData?.billNo}
        onPrinted={leaveAfterSave}
        onClose={leaveAfterSave}
      />

      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }

          html,
          body {
            width: 210mm !important;
            height: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #ffffff !important;
          }

          body * {
            visibility: hidden !important;
          }

          #pos-print-document,
          #pos-print-document * {
            visibility: visible !important;
          }

          #pos-print-document {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 210mm !important;
            height: 297mm !important;
            transform: none !important;
            transform-origin: top left !important;
            overflow: hidden !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .pos-a4-fit-stage {
            width: 210mm !important;
            height: 297mm !important;
          }

          .pos-a4-fit-viewport {
            overflow: visible !important;
          }
        }
      `}</style>
    </>
  )
}
