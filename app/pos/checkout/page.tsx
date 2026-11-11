'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BillTemplateData } from '@/features/documents/utils/rental-bill-print'
import { A4FitPreview } from '@/features/pos/components/A4FitPreview'
import { FileText, Printer } from 'lucide-react'
import { PaymentMethodSelector, type PaymentMethodType } from '@/features/pos/components/payment/PaymentMethodSelector'
import { PaymentDynamicContent } from '@/features/pos/components/payment/PaymentDynamicContent'
import { type VatMode } from '@/features/pos/components/VatModeButtons'
import { DocumentSummaryLayout, DocumentSummaryPanel, documentSummaryRows } from '@/features/pos/components/DocumentSummaryPanel'
import { RentalBill, Customer, Product } from '@/lib/types/rental-pos'
import { useToast } from '@/components/common/Toast'
import { useNotice } from '@/components/common/ConfirmDialogProvider'
import { PAYMENT_NOT_CHOSEN_NOTICE } from '@/features/pos/hooks/useCashConfirmation'
import { useSplitPayment } from '@/features/pos/hooks/useSplitPayment'
import { allocateTenders } from '@/features/pos/services/split-payment'
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
import { saveBillDraft, confirmBill, deliverBill, type BillDraftInput, type BillLineInput } from '@/features/bills/services/bill-service'
import { fetchBillByIdFromSupabase, fetchBillsFromSupabase, loadBillById } from '@/features/bills/services/bill-storage'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { calculateBillTotals } from '@/lib/calculation-service'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import type { DocumentTemplate } from '@/lib/types/document'
import { loadDocumentNames, refreshSharedTemplates } from '@/features/documents/services/template-library-storage'
import { MAIN_BILL_FORM_NAME, pickBillFormTemplate, printBillForm, renderBillFormPagesHtml } from '@/features/documents/utils/transaction-print'
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
  const [quotationNo, setQuotationNo] = useState<string | null>(null)
  const [draftBillId, setDraftBillId] = useState<string | null>(null)
  // Draft this page already saved on the server but has not confirmed yet (e.g. confirm failed):
  // a retry must update it, not create another one.
  const savedDraftIdRef = useRef<string | null>(null)
  // Goods leave with the customer now (default) — or later / in parts from the bills screen.
  const [deliverNow, setDeliverNow] = useState<boolean>(true)
  // VAT of this bill, chosen here with the two buttons รวม VAT / ไม่รวม VAT (owner 2026-11-04):
  // none pressed = no VAT; the chosen mode is sent with the draft and snapshotted by the server.
  const [vatMode, setVatMode] = useState<VatMode | null>(null)
  // A quotation / old draft that already had VAT on but no mode of its own: it keeps the shop's price mode.
  const [legacyVatOn, setLegacyVatOn] = useState<boolean>(false)

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
      if (cart.quotationNo) setQuotationNo(cart.quotationNo)
      if (cart.draftBillId) setDraftBillId(cart.draftBillId)
      setVatMode(cart.vatMode === 'INCLUSIVE' || cart.vatMode === 'EXCLUSIVE' ? cart.vatMode : null)
      setLegacyVatOn(cart.vatEnabled === true && !cart.vatMode)
    }
    cartLoadedRef.current = true
  }, [])

  // ประเภทเอกสาร = a name of จัดการเอกสาร › แบบฟอร์มบิล: the bill shows and prints on that form, the same
  // form whatever the payment (owner 2026-11-07); any other value is printed on the shop's main bill form. null = still reading.
  const [library, setLibrary] = useState<{ templates: DocumentTemplate[]; formNames: string[] } | null>(null)
  useEffect(() => {
    let alive = true
    refreshSharedTemplates()
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
  const shopVatMode = settings.taxDiscount?.vatMode ?? null
  const effectiveVatMode: VatMode | null = vatMode ?? (legacyVatOn ? shopVatMode : null)

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
  const toggleVatMode = (mode: VatMode) => {
    setLegacyVatOn(false)
    setVatMode(effectiveVatMode === mode ? null : mode)
  }
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
  const [savedBill, setSavedBill] = useState<RentalBill | null>(null)
  // What was saved, frozen before the cart is cleared, so "พิมพ์" prints the real bill
  const [savedPrintData, setSavedPrintData] = useState<BillTemplateData | null>(null)

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
    billNo: `BILL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-DRAFT`,
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
      billId:
        savedDraftIdRef.current ??
        (draftBillId && loadBillById(draftBillId)?.rentalStatus === 'DRAFT' ? draftBillId : null),
      customerId: customer?.id || null,
      quotationId: quotationId || null,
      vatEnabled: vatOn,
      vatMode: vatOn ? effectiveVatMode : null,
      note: note || undefined,
      discountAmount: discount || 0,
      deliveryFee: shippingFee || 0,
      depositAmount: depositAmount || 0,
      isCreditBill: false,
      dueDate: null,
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

  type SettleResult =
    | { ok: true; confirmed: Awaited<ReturnType<typeof confirmBill>>; billId: string; total: number }
    | { ok: false; message: string }

  /** Draft → server total re-check → confirm. Returns the confirmed bill or the reason it stopped. */
  const saveAndConfirmBill = async (
    selectedPaymentMethod: PaymentMethodType,
    isUnpaid: boolean
  ): Promise<SettleResult> => {
    const billId = await saveBillDraft(buildDraftInput())
    savedDraftIdRef.current = billId
    const draft = await fetchBillByIdFromSupabase(billId)
    const total = draft?.grandTotal ?? grandTotal
    const totalWithDeposit = total + depositToCollect
    // One method for the exact amount (QR Code, or an empty cash box) pays whatever the server's total is
    const exact = !pay.part && (selectedPaymentMethod !== 'CASH' || receivedCashInput === '')
    // Otherwise the server's total can differ from the screen's; the money typed in must still cover it
    if (!isUnpaid && !exact && pay.totals.collected + 0.005 < totalWithDeposit) {
      return {
        ok: false,
        message: `ยอดสุทธิจากระบบ (รวมมัดจำ) ${totalWithDeposit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} มากกว่าเงินที่รับมา — บิลบันทึกเป็นแบบร่างไว้แล้ว`,
      }
    }
    // All the money taken (bill + deposit), methods in the order taken; the server cuts it
    // ค่าสินค้าขาย → ค่าขนส่ง → มัดจำ → ค่าเช่า and keeps the rest owed (owner 2026-11-11).
    // ค้างชำระ after cash confirmed for part of the amount sends that cash only.
    const tenders = exact
      ? [{ method: selectedPaymentMethod, amount: totalWithDeposit }]
      : allocateTenders(pay.totals.tenders, totalWithDeposit)[0]
    const send = isUnpaid ? (pay.part ? tenders : []) : totalWithDeposit <= 0 ? [] : tenders
    const confirmed = await confirmBill(
      billId,
      send.map((t) => ({ ...t, reference: t.method === 'CASH' ? undefined : bankRef || undefined }))
    )
    savedDraftIdRef.current = null
    return { ok: true, confirmed, billId, total }
  }

  /** Stock moves only with a real delivery (Master §11.3); failures do not undo the bill. */
  const deliverIfNeeded = async (billId: string, confirmed: Awaited<ReturnType<typeof confirmBill>>) => {
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

  const handleConfirmBill = async () => {
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

      const settled = await saveAndConfirmBill(selectedPaymentMethod, isUnpaid)
      if (!settled.ok) {
        showToast('ยอดเงินที่รับไม่พอ', settled.message, 'ERROR')
        return
      }

      const { confirmed, billId, total } = settled
      await deliverIfNeeded(billId, confirmed)

      const billNo = confirmed?.billNo || ''
      const savedTotal = confirmed?.grandTotal ?? total
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
      const billDesc = allItemsAreSale
        ? `บันทึกข้อมูลบิลขาย ${billNo} เรียบร้อยแล้ว\nต้องการพิมพ์ใบเสร็จรับเงิน / ใบส่งของหรือไม่?`
        : `บันทึกข้อมูลบิลเช่า ${billNo} เรียบร้อยแล้ว\nต้องการพิมพ์สัญญาเช่า / ใบส่งของหรือไม่?`

      showToast(billTitle, `เลขที่บิล: ${billNo}`, 'SUCCESS')
      setPostSavePrintModal({
        isOpen: true,
        title: billTitle,
        description: billDesc,
      })
    } catch (err: unknown) {
      if (isPinCancelled(err)) return
      showToast('เกิดข้อผิดพลาดในการบันทึกบิล', errorMessage(err) || 'โปรดตรวจสอบข้อมูลอีกครั้ง', 'ERROR')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveDraft = async () => {
    if (items.length === 0) {
      showToast('ไม่สามารถบันทึกแบบร่างได้', 'ไม่มีรายการสินค้าในตะกร้า', 'ERROR')
      return
    }

    try {
      validateCartCustomer(items, customer)
    } catch {
      router.push(`${backToPosHref}&customerRequired=1`)
      return
    }

    try {
      setIsSubmitting(true)
      await saveBillDraft(buildDraftInput())
      await fetchBillsFromSupabase()
      clearCart()
      showToast('บันทึกแบบร่างสำเร็จ', 'บันทึกแบบร่างบิลเรียบร้อยแล้ว (ยังไม่ตัดสต็อก ยังไม่มีเลขบิล)', 'SUCCESS')
      router.push('/bills?status=DRAFT')
    } catch (err: unknown) {
      if (isPinCancelled(err)) return
      showToast('เกิดข้อผิดพลาดในการบันทึกแบบร่าง', errorMessage(err) || 'โปรดตรวจสอบข้อมูลอีกครั้ง', 'ERROR')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Back to the cart without losing it: the POS reloads the cart saved before checkout
  // (and keeps the quotation / draft this bill comes from).
  const backToPosParams = new URLSearchParams({ resume: '1' })
  if (quotationId) backToPosParams.set('quotationId', quotationId)
  if (draftBillId) backToPosParams.set('draftBillId', draftBillId)
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
        {billFormPending ? 'กำลังโหลดแบบฟอร์ม...' : `ไม่พบแบบฟอร์มของ "${formName}" กรุณาเพิ่มที่เมนูจัดการเอกสาร`}
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
        backHref={backToPosHref}
        backLabel="ย้อนกลับไป POS"
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
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSubmitting}
                className="shrink-0 whitespace-nowrap rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 active:scale-[0.99] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
              >
                <FileText className="w-4 h-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                <span className="truncate">บันทึกแบบร่าง</span>
              </button>

              <button
                type="button"
                onClick={handleConfirmBill}
                disabled={isSubmitting}
                className="flex-1 min-w-0 rounded-xl bg-emerald-700 px-2 py-2.5 hover:bg-emerald-800 active:scale-[0.99] text-white font-black text-xs sm:text-sm md:text-base flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
              >
                <Printer className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                <span className="truncate">
                  {isSubmitting ? 'กำลังบันทึกบิล...' : draftBillId ? 'ออกบิลจากแบบร่าง' : 'ออกบิล'}
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
        description={postSavePrintModal.description}
        onPrint={() => {
          const printData = savedPrintData ?? billData
          if (billFormPending) {
            showToast('กำลังโหลดแบบฟอร์ม', 'กรุณากดพิมพ์อีกครั้ง', 'INFO')
            return
          }
          if (!billForm) {
            showToast('พิมพ์ไม่ได้', `ไม่พบแบบฟอร์มของ "${formName}" — บิลบันทึกแล้ว`, 'ERROR')
            return
          }
          printBillForm(printData, settings.business, billForm)
          clearCart()
          setPostSavePrintModal({ isOpen: false, title: '', description: '' })
          router.push('/pos')
        }}
        onClose={() => {
          clearCart()
          setPostSavePrintModal({ isOpen: false, title: '', description: '' })
          router.push('/pos')
        }}
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
