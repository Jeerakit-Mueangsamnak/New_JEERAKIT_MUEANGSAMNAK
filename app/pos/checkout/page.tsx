'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { RentalBillTemplate, BillTemplateData } from '@/templates/rental-bill/RentalBillTemplate'
import { billBusinessFields, printRentalBillDocument } from '@/features/documents/utils/rental-bill-print'
import { A4FitPreview } from '@/features/pos/components/A4FitPreview'
import {
  ArrowLeft,
  FileCheck,
  CreditCard,
  FileText,
} from 'lucide-react'
import { PaymentMethodSelector, type PaymentMethodType } from '@/features/pos/components/payment/PaymentMethodSelector'
import { PaymentDynamicContent } from '@/features/pos/components/payment/PaymentDynamicContent'
import { RentalBill, Customer, Product } from '@/lib/types/rental-pos'
import { useToast } from '@/components/common/Toast'
import { PostSavePrintModal } from '@/components/common/PostSavePrintModal'
import { getLocalDateString } from '@/components/common/CustomDatePicker'
import {
  loadActiveCart,
  clearActiveCart,
  isSaleCartItem,
  defaultBillDocumentType,
  validateCartCustomer,
  cartLineUnitPriceForServer,
  isCashShort,
} from '@/features/pos/services/cart-storage'
import { saveBillDraft, confirmBill, deliverBill, type BillDraftInput, type BillLineInput } from '@/features/bills/services/bill-service'
import { fetchBillByIdFromSupabase, fetchBillsFromSupabase, loadBillById } from '@/features/bills/services/bill-storage'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { calculateBillTotals } from '@/lib/calculation-service'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'

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
  const [quotationId, setQuotationId] = useState<string | null>(null)
  const [quotationNo, setQuotationNo] = useState<string | null>(null)
  const [draftBillId, setDraftBillId] = useState<string | null>(null)
  // Draft this page already saved on the server but has not confirmed yet (e.g. confirm failed):
  // a retry must update it, not create another one.
  const savedDraftIdRef = useRef<string | null>(null)
  // Goods leave with the customer now (default) — or later / in parts from the bills screen.
  const [deliverNow, setDeliverNow] = useState<boolean>(true)
  // VAT ON/OFF of this bill, chosen in the cart; sent with the draft and snapshotted by the server.
  const [vatEnabled, setVatEnabled] = useState<boolean>(false)

  useEffect(() => {
    const cart = loadActiveCart()
    if (cart) {
      if (cart.customer) setCustomer(cart.customer)
      if (cart.items && cart.items.length > 0) setItems(cart.items)
      if (cart.discount !== undefined) setDiscount(cart.discount)
      if (cart.shippingFee !== undefined) setShippingFee(cart.shippingFee)
      if (cart.depositAmount !== undefined) setDepositAmount(cart.depositAmount)
      if (cart.documentType) setDocumentType(cart.documentType)
      if (cart.shippingAddress) setShippingAddress(cart.shippingAddress)
      if (cart.remark) setRemark(cart.remark)
      if (cart.headerRentalDate) setHeaderRentalDate(new Date(cart.headerRentalDate))
      if (cart.headerReturnDate) setHeaderReturnDate(new Date(cart.headerReturnDate))
      if (cart.quotationId) setQuotationId(cart.quotationId)
      if (cart.quotationNo) setQuotationNo(cart.quotationNo)
      if (cart.draftBillId) setDraftBillId(cart.draftBillId)
      setVatEnabled(cart.vatEnabled === true)
    }
  }, [])

  const totals = calculateBillTotals({
    settings,
    items,
    discount,
    shippingFee,
    depositAmount,
    enableVat: vatEnabled,
  })
  const tax = totals.vatAmount
  const subtotal = totals.subtotal
  const grandTotal = totals.grandTotal

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

  const [mobileTab, setMobileTab] = useState<'PAYMENT' | 'PREVIEW'>('PAYMENT')

  const receivedCash = receivedCashInput === '' ? grandTotal : (parseFloat(receivedCashInput) || 0)
  const changeAmount = paymentMethod === 'CASH' ? Math.max(0, receivedCash - grandTotal) : 0

  // Format template data for live preview
  const billData: BillTemplateData = {
    documentType: documentType || defaultBillDocumentType(items),
    // A quotation is not a payment request: no bank block, no "paid" lines on the blue area
    showBankDetails: quotationId ? false : undefined,
    showPaymentSummary: quotationId ? false : undefined,
    // Shop details come from Settings → ข้อมูลร้าน (never made-up values)
    ...billBusinessFields(settings.business),
    customerName: customer?.customerName || 'ลูกค้าทั่วไป',
    customerAddress: customer?.address,
    customerPhone: customer?.phone,
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
    })),
    subtotal,
    discount: discount || 0,
    shippingFee: shippingFee || 0,
    taxAmount: tax,
    depositAmount: depositAmount || 0,
    grandTotal,
    paidAmount: paymentMethod && paymentMethod !== 'UNPAID' ? grandTotal : 0,
    outstandingAmount: paymentMethod === 'UNPAID' || paymentMethod === null ? grandTotal : 0,
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
      if (isSaleCartItem(it)) {
        return { productId: it.product.id, mode: 'SALE', quantity: it.quantity, unitPrice }
      }
      if (it.rentalType === 'DAILY') {
        return {
          productId: it.product.id,
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
        productId: it.product.id,
        mode: 'RENTAL',
        quantity: it.quantity,
        unitPrice,
        calc: 'PER_PERIOD',
        periods: Math.max(1, Number(it.usageCount) || 1),
        startAt: headerStart.toISOString(),
        endAt: (headerEnd > headerStart ? headerEnd : endOfDay(headerStart)).toISOString(),
      }
    })

    const note = [remark?.trim(), shippingAddress?.trim() ? `ส่งที่: ${shippingAddress.trim()}` : '']
      .filter(Boolean)
      .join('\n')

    return {
      billId:
        savedDraftIdRef.current ??
        (draftBillId && loadBillById(draftBillId)?.rentalStatus === 'DRAFT' ? draftBillId : null),
      customerId: customer?.id || null,
      quotationId: quotationId || null,
      vatEnabled,
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
    } catch (error: unknown) {
      showToast('ข้อมูลลูกค้าไม่ครบถ้วน', error instanceof Error ? error.message : String(error), 'ERROR')
      return false
    }
    if (isCashShort(selectedPaymentMethod, receivedCash, grandTotal)) {
      showToast('เงินสดไม่ถูกต้อง', 'เงินสดที่รับมาต้องไม่น้อยกว่ายอดชำระ', 'ERROR')
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
    // The server's total can differ from the screen's; the cash typed in must still cover it
    if (!isUnpaid && receivedCashInput !== '' && isCashShort(selectedPaymentMethod, receivedCash, total)) {
      return {
        ok: false,
        message: `ยอดสุทธิจากระบบ ${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })} มากกว่าเงินสดที่รับมา — บิลบันทึกเป็นแบบร่างไว้แล้ว`,
      }
    }
    const confirmed = await confirmBill(
      billId,
      isUnpaid || total <= 0 ? [] : [{ method: selectedPaymentMethod, amount: total, reference: bankRef || undefined }]
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
    setIsSubmitting(true)
    try {
      const selectedPaymentMethod = paymentMethod
      if (!selectedPaymentMethod) {
        showToast('กรุณาเลือกช่องทางชำระเงิน', '', 'ERROR')
        return
      }
      if (!validateCheckout(selectedPaymentMethod)) return

      const allItemsAreSale = items.length > 0 && items.every((it) => isSaleCartItem(it))
      const isUnpaid = selectedPaymentMethod === 'UNPAID'

      const settled = await saveAndConfirmBill(selectedPaymentMethod, isUnpaid)
      if (!settled.ok) {
        showToast('เงินสดไม่ถูกต้อง', settled.message, 'ERROR')
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
        paidAmount: isUnpaid ? 0 : savedTotal,
        outstandingAmount: isUnpaid ? savedTotal : 0,
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
    } catch (error: unknown) {
      showToast('ข้อมูลลูกค้าไม่ครบถ้วน', error instanceof Error ? error.message : String(error), 'ERROR')
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

  const handleCancel = () => {
    router.push('/pos')
  }

  return (
    <div className="pos-checkout-print-root flex h-full min-h-0 w-full flex-1 flex-col bg-slate-100 p-2 sm:p-2.5 dark:bg-slate-900 md:grid md:h-full md:max-h-full md:min-h-0 md:grid-cols-[minmax(0,58fr)_minmax(300px,42fr)] lg:grid-cols-[minmax(0,60fr)_minmax(340px,40fr)] md:gap-2.5 md:overflow-hidden lg:gap-3 lg:p-3">
      {/* Mobile View Switcher (< md screens) */}
      <div className="md:hidden flex items-center bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm shrink-0 mb-1.5">
        <button
          type="button"
          onClick={() => setMobileTab('PAYMENT')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileTab === 'PAYMENT'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>ฟอร์มชำระเงิน</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('PREVIEW')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileTab === 'PREVIEW'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>ดูตัวอย่างบิล A4</span>
        </button>
      </div>

      {/* Left: real A4 preview. The A4 sheet never scrolls; it is scaled to fit available space. */}
      <div className={`h-full min-h-0 w-full flex-1 overflow-hidden flex-col bg-slate-100/60 dark:bg-slate-950/40 rounded-xl border border-slate-200/80 dark:border-slate-800 ${
        mobileTab === 'PREVIEW' ? 'flex' : 'hidden md:flex'
      }`}>
        <div className="flex-1 min-h-0 w-full h-full overflow-hidden">
          <A4FitPreview
            paddingPx={1}
            className="h-full w-full"
            align="center"
          >
            <RentalBillTemplate data={savedPrintData ?? billData} />
          </A4FitPreview>
        </div>
      </div>

      {/* Right Column - Payment Panel */}
      <div className={`mt-0 flex min-h-0 min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800 md:mt-0 md:h-full md:p-3.5 lg:p-4 ${
        mobileTab === 'PAYMENT' ? 'flex flex-1' : 'hidden md:flex'
      }`}>

        <div className="flex min-h-0 flex-1 flex-col space-y-2 sm:space-y-2.5 overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 min-w-0 items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-700">
            <Link
              href="/pos"
              className="flex shrink-0 items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs font-semibold"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">ย้อนกลับไป POS</span>
            </Link>
            <h3 className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-900 dark:text-slate-100 sm:text-base">
              ชำระเงิน
            </h3>
          </div>

          {/* Amount Due Card */}
          <div className="flex shrink-0 items-center justify-between gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 p-2.5 sm:p-3 text-white shadow-lg lg:p-3.5">
            <span className="text-[11px] sm:text-xs text-blue-100 font-medium">ยอดสุทธิ</span>
            <span className="whitespace-nowrap text-2xl sm:text-3xl font-black tracking-tight tabular-nums">
              {grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span>
          </div>

          {/* Payment Method Selector — one row, equal-size buttons */}
          <PaymentMethodSelector
            selectedMethod={paymentMethod}
            onSelectMethod={setPaymentMethod}
            showPromptPay={false}
            autoSelectFirst={false}
            showLabel={false}
            itemsPerRow={3}
            labels={{ TRANSFER: 'เงินโอน' }}
          />

          {/* Dynamic Inputs per Method */}
          {paymentMethod ? (
            <PaymentDynamicContent
              paymentMethod={paymentMethod}
              targetAmount={grandTotal}
              receivedCashInput={receivedCashInput}
              onReceivedCashInputChange={setReceivedCashInput}
              changeAmount={changeAmount}
              bankRef={bankRef}
              onBankRefChange={setBankRef}
            />
          ) : null}
        </div>

        {/* Action Buttons Group (Confirm, Save Draft, Cancel) */}
        <div className="flex shrink-0 flex-col gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={deliverNow}
              onChange={(e) => setDeliverNow(e.target.checked)}
              className="w-4 h-4 text-emerald-700 dark:text-emerald-400 rounded"
            />
            <span>ลูกค้ารับของเลย (บันทึกส่งมอบทันที) — ไม่ติ๊ก = ส่งภายหลังที่หน้าจัดการบิล</span>
          </label>
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 min-w-0 rounded-xl bg-slate-100 dark:bg-slate-700/80 px-2 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.99] text-slate-700 dark:text-slate-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all min-h-[44px] cursor-pointer"
            >
              <span className="truncate">ยกเลิก</span>
            </button>

            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSubmitting}
              className="flex-1 min-w-0 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-slate-900 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 px-2 py-2.5 shadow-md shadow-amber-500/20 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className="truncate">แบบร่าง</span>
            </button>

            <button
              type="button"
              onClick={handleConfirmBill}
              disabled={isSubmitting || !paymentMethod}
              className="flex-1 min-w-0 rounded-xl bg-emerald-700 px-2 py-2.5 hover:bg-emerald-800 active:scale-[0.99] text-white font-black text-xs sm:text-sm md:text-base flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
            >
              <FileCheck className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
              <span className="truncate">
                {isSubmitting ? 'กำลังบันทึกบิล...' : draftBillId ? 'ออกบิลจากแบบร่าง' : 'ออกบิล'}
              </span>
            </button>
          </div>
        </div>

      </div>

      {/* Post-Save Print Confirmation Modal */}
      <PostSavePrintModal
        isOpen={postSavePrintModal.isOpen}
        title={postSavePrintModal.title}
        description={postSavePrintModal.description}
        onPrint={() => {
          printRentalBillDocument(savedPrintData ?? billData)
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
    </div>
  )
}
