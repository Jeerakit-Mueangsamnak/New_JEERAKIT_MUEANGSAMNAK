'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Customer } from '@/lib/types/rental-pos'
import {
  Trash2,
  Pencil,
  UserPlus,
  ShoppingBag,
  ArrowRight,
  FileText
} from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { NewCustomerModal } from '@/features/customers/components/NewCustomerModal'
import { getLocalDateString } from '@/components/common/CustomDatePicker'
import { CartDatesButton, CartDatesModal, CartDeliveryInput, CartPhoneInput } from '@/features/pos/components/CartDetailFields'
import { CustomSelect } from '@/components/common/CustomSelect'
import { CustomerUnifiedSelector } from '@/features/pos/components/CustomerUnifiedSelector'
import {
  type ActiveCartData,
  CartItem,
  clearActiveCart,
  customerContactPhones,
  isSaleCartItem,
  saveActiveCart,
  validateCartCustomer,
} from '@/features/pos/services/cart-storage'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { calculateBillTotals } from '@/lib/calculation-service'
import { isVatRateConfigured } from '@/features/settings/services/settings-storage'
import { useDocumentVatMode } from '@/features/pos/hooks/useDocumentVatMode'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { loadDocumentNames, getSharedTemplates } from '@/features/documents/services/template-library-storage'
import { billFormDocumentNames } from '@/features/documents/utils/transaction-print'
import { isNoChargeRental } from '@/features/pos/services/accessory-rules'

export type { CartItem }

interface CartPanelProps {
  onCheckout: () => void
  customers?: Customer[]
  /** Resolves false when saving failed, so the customer form stays open. */
  onAddCustomer?: (newCustomer: Customer) => Promise<boolean | void> | void
  isQuotationMode?: boolean
  items?: CartItem[]
  setItems?: React.Dispatch<React.SetStateAction<CartItem[]>>
  customer?: Customer | null
  setCustomer?: React.Dispatch<React.SetStateAction<Customer | null>>
  quotationId?: string
  quotationNo?: string
  draftBillId?: string
  /** Pencil icon on a cart line: reopen the quantity screen for that line. */
  onEditItem?: (item: CartItem) => void
  /** + รายการนอกร้าน: a line typed in at the counter (bills only). */
  onAddCustomItem?: () => void
  initialDiscount?: number
  initialShippingFee?: number
  initialDepositAmount?: number

  initialShippingAddress?: string
  initialRentalStartDate?: string
  initialRentalEndDate?: string
  /** VAT ON/OFF of a loaded draft bill / quotation; a new cart starts with VAT off. */
  initialVatEnabled?: boolean
  /** รวม / ไม่รวม VAT chosen on the payment page; the cart only carries it back to the payment page. */
  initialVatMode?: 'INCLUSIVE' | 'EXCLUSIVE' | null
  /** Document date (yyyy-mm-dd) of a quotation being edited. */
  initialDocumentDate?: string
  /** Opened from checkout because the customer was missing: the customer field starts blinking. */
  initialCustomerAttention?: boolean
  /** Contact phone of this bill (restored when coming back from checkout). */
  initialContactPhone?: string
  /** ประเภทเอกสาร picked before (restored when coming back from checkout). */
  initialDocumentType?: string
  /** The dates were picked before (held cart) or come with the document (quotation / draft / appointment). */
  initialDatesPicked?: boolean
}

export function CartPanel({
  onCheckout,
  customers = [],
  onAddCustomer,
  isQuotationMode = false,
  items: externalItems,
  setItems: setExternalItems,
  customer: externalCustomer,
  setCustomer: setExternalCustomer,
  quotationId,
  quotationNo,
  draftBillId,
  onEditItem,
  onAddCustomItem,
  initialDiscount,
  initialShippingFee,
  initialDepositAmount,

  initialShippingAddress,
  initialRentalStartDate,
  initialRentalEndDate,
  initialVatEnabled,
  initialVatMode,
  initialDocumentDate,
  initialCustomerAttention = false,
  initialContactPhone,
  initialDocumentType,
  initialDatesPicked,
}: CartPanelProps) {
  const { showToast } = useToast()
  const { settings } = useSystemSettings()
  const { user } = useAuth()
  // VAT belongs to THIS bill / quotation only (never written to the shop settings) and starts off for
  // every new cart. Owner 2026-11-04: the rate comes from Settings; รวม / ไม่รวม VAT is this document's own
  // button (quotations here, bills on the payment page).
  const vatConfigured = isVatRateConfigured(settings)
  // รวม / ไม่รวม VAT of this document (shared with the payment and quotation pages)
  const vat = useDocumentVatMode({ mode: initialVatMode, vatEnabled: initialVatEnabled })
  const loadVat = vat.load
  // Missing / incomplete customer: the customer field blinks red until it is clicked (no pop-up message).
  const [customerAttention, setCustomerAttention] = useState<boolean>(initialCustomerAttention)
  useEffect(() => {
    if (initialVatEnabled === undefined && initialVatMode === undefined) return
    loadVat(initialVatMode, Boolean(initialVatEnabled))
  }, [initialVatEnabled, initialVatMode, loadVat])
  const effectiveVatMode = vat.effective
  const vatOn = effectiveVatMode !== null && vatConfigured
  
  const [internalCustomer, setInternalCustomer] = useState<Customer | null>(null)
  const [internalItems, setInternalItems] = useState<CartItem[]>([])

  const customer = externalCustomer !== undefined ? externalCustomer : internalCustomer
  const setCustomer = setExternalCustomer || setInternalCustomer

  const items = externalItems !== undefined ? externalItems : internalItems
  const setItems = setExternalItems || setInternalItems

  const [discount, setDiscount] = useState<number>(0)
  const [shippingFee, setShippingFee] = useState<number>(0)
  const [depositAmount, setDepositAmount] = useState<number>(0)
  const [shippingAddress, setShippingAddress] = useState<string>('')
  // Contact phone of this bill: starts as the customer's phone, can be typed over; saved with the bill.
  const [contactPhone, setContactPhone] = useState<string>(initialContactPhone ?? '')
  const phoneFirstRun = useRef(true)
  useEffect(() => {
    if (phoneFirstRun.current) {
      phoneFirstRun.current = false
      if (initialContactPhone) return
    }
    setContactPhone(customerContactPhones(customer))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, customer?.phone, customer?.phone2])
  const [headerRentalDate, setHeaderRentalDate] = useState<Date | null>(new Date())
  const [headerReturnDate, setHeaderReturnDate] = useState<Date | null>(new Date())
  // A name of จัดการเอกสาร › แบบฟอร์มบิล: the bill prints on the form saved under that name. Empty = not picked.
  const [documentType, setDocumentType] = useState<string>(initialDocumentType ?? '')
  // A bill must have its ประเภทเอกสาร picked every time (owner 2026-11-09): blinks red like the customer field.
  const [documentTypeAttention, setDocumentTypeAttention] = useState(false)
  const [billFormNames, setBillFormNames] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    getSharedTemplates()
      .then((templates) => alive && setBillFormNames(billFormDocumentNames(loadDocumentNames(), templates)))
      .catch((err: unknown) => console.error('Reading the bill forms failed:', err))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (initialDocumentType !== undefined) setDocumentType(initialDocumentType)
  }, [initialDocumentType])
  const [documentDate, setDocumentDate] = useState<Date | null>(new Date())
  // A bill must have its dates picked in the date window (owner 2026-11-11): until then they show --/--
  // and the row blinks red like the customer field when ชำระเงิน is pressed.
  const [datesPicked, setDatesPicked] = useState(false)
  const [datesAttention, setDatesAttention] = useState(false)
  useEffect(() => {
    if (initialDatesPicked !== undefined) setDatesPicked(initialDatesPicked)
  }, [initialDatesPicked])
  const showDates = isQuotationMode || datesPicked

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }
  const clearCart = () => {
    setItems([])
    setCustomer(null)
    vat.clear()
  }

  const totals = calculateBillTotals({
    settings,
    items,
    discount: Number(discount) || 0,
    shippingFee: Number(shippingFee) || 0,
    depositAmount: Number(depositAmount) || 0,
    enableVat: vatOn,
    vatMode: vatOn ? effectiveVatMode : null,
  })
  const subtotal = totals.subtotal
  const tax = totals.vatAmount
  const taxRate = totals.vatRate
  const grandTotal = totals.grandTotal

  const validateRentalPeriods = (): boolean => {
    const day = (value?: Date | string | null) => {
      if (!value) return null
      const parsed = new Date(value)
      return Number.isFinite(parsed.getTime()) ? getLocalDateString(parsed) : null
    }
    const roundRentalExists = items.some((item) => item.rentalType === 'NORMAL' && !isSaleCartItem(item))
    const startDay = day(headerRentalDate)
    const endDay = day(headerReturnDate)
    if (roundRentalExists && (!startDay || !endDay || endDay < startDay)) {
      showToast('ช่วงวันเช่าไม่ถูกต้อง', 'วันกำหนดคืนต้องไม่ก่อนวันเริ่มเช่า', 'ERROR')
      return false
    }

    const invalidDailyItem = items.find((item) => {
      if (item.rentalType !== 'DAILY' || isSaleCartItem(item)) return false
      const start = day(item.dailyStartDate)
      const end = day(item.dailyEndDate)
      return !start || !end || end < start
    })
    if (invalidDailyItem) {
      showToast('ช่วงวันเช่าไม่ถูกต้อง', `กรุณาตรวจสอบวันเริ่มและวันสิ้นสุดของ ${invalidDailyItem.productName || invalidDailyItem.product.name}`, 'ERROR')
      return false
    }
    return true
  }

  const [customerList, setCustomerList] = useState<Customer[]>(customers)
  
  // Add Customer Modal State
  const [showAddCustomerModal, setShowAddCustomerModal] = useState<boolean>(false)

  // Sequential Date Picker State
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false)

  // Sync prop changes
  useEffect(() => {
    if (customers.length > 0) {
      setCustomerList(customers)
    }
  }, [customers])

  useEffect(() => {
    if (initialDiscount !== undefined) setDiscount(initialDiscount)
  }, [initialDiscount])

  useEffect(() => {
    if (initialDocumentDate) setDocumentDate(new Date(`${initialDocumentDate.slice(0, 10)}T00:00:00`))
  }, [initialDocumentDate])

  useEffect(() => {
    if (initialShippingFee !== undefined) setShippingFee(initialShippingFee)
  }, [initialShippingFee])

  useEffect(() => {
    if (initialDepositAmount !== undefined) setDepositAmount(initialDepositAmount)
  }, [initialDepositAmount])

  useEffect(() => {
    if (initialShippingAddress !== undefined) setShippingAddress(initialShippingAddress)
  }, [initialShippingAddress])

  useEffect(() => {
    if (initialRentalStartDate) setHeaderRentalDate(new Date(initialRentalStartDate))
  }, [initialRentalStartDate])

  useEffect(() => {
    if (initialRentalEndDate) setHeaderReturnDate(new Date(initialRentalEndDate))
  }, [initialRentalEndDate])

  // A restored cart keeps the phone typed for it (declared after the customer effect, so it wins).
  useEffect(() => {
    if (initialContactPhone !== undefined) setContactPhone(initialContactPhone)
  }, [initialContactPhone])

  /** The cart as the payment page and the header cart icon read it. */
  const buildActiveCart = (): ActiveCartData => ({
    customer,
    items,
    discount: Number(discount) || 0,
    shippingFee: Number(shippingFee) || 0,
    depositAmount: Number(depositAmount) || 0,
    taxRate: taxRate,
    vatEnabled: vatOn,
    vatMode: vatOn ? effectiveVatMode : null,
    shippingAddress,
    contactPhone: contactPhone.trim() || undefined,
    headerRentalDate: getLocalDateString(headerRentalDate ?? new Date()),
    headerReturnDate: getLocalDateString(headerReturnDate ?? new Date()),
    documentType,
    documentDate: getLocalDateString(documentDate ?? new Date()),
    datesPicked,
    subtotal,
    tax,
    grandTotal,
    quotationId: quotationId || undefined,
    quotationNo: quotationNo || undefined,
    draftBillId: draftBillId || undefined,
    quotationMode: isQuotationMode || undefined,
    ownerId: user?.id,
  })

  // Held cart (owner 2026-11-09): every change of a bill cart is kept on this device, so switching menus
  // never loses it (header cart icon). Nothing reaches the database until the bill is saved. Emptying the
  // cart removes it; an empty cart at mount never does (the page may be about to restore one).
  const keptItemCount = useRef(0)
  const latestCart = useRef(buildActiveCart)
  latestCart.current = buildActiveCart
  useEffect(() => {
    if (isQuotationMode) return
    if (items.length > 0) saveActiveCart(latestCart.current())
    else if (keptItemCount.current > 0) clearActiveCart('BILL')
    keptItemCount.current = items.length
  }, [isQuotationMode, items, customer, contactPhone, shippingAddress, headerRentalDate, headerReturnDate, documentType, documentDate, datesPicked, vat.mode, draftBillId, quotationId])

  const handleOpenAddCustomerModal = () => {
    setShowAddCustomerModal(true)
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
      
      {/* Top Header & Customer Selector & Dates */}
      <div className="p-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isQuotationMode ? (
              <FileText className="w-4 h-4 text-amber-700 dark:text-amber-400" />
            ) : (
              <ShoppingBag className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            )}
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
              {isQuotationMode ? 'รายการใบเสนอราคา' : 'ตะกร้าสินค้า'}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {onAddCustomItem && !isQuotationMode && (
              <button
                type="button"
                onClick={onAddCustomItem}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-semibold transition-colors whitespace-nowrap"
              >
                + รายการนอกร้าน
              </button>
            )}
            {items.length > 0 && (
              <button
                onClick={clearCart}
                className="text-xs text-red-700 dark:text-red-400 hover:text-red-700 font-semibold transition-colors"
              >
                ล้างตะกร้า
              </button>
            )}
          </div>
        </div>

        {/* 4-Row Cart Header Controls */}
        <div className="space-y-2">
          {/* Row 1: Unified Customer Selector (Full Width) */}
          <div className="w-full">
            <CustomerUnifiedSelector
              selectedCustomer={customer}
              customers={customerList}
              attention={customerAttention}
              onAttentionDismiss={() => setCustomerAttention(false)}
              onSelectCustomer={(cust) => {
                if (cust?.isSuspended) {
                  showToast('ลูกค้าถูกระงับสิทธิ์', `ลูกค้า ${cust.customerName} ถูกระงับสิทธิ์ ไม่สามารถทำรายการได้`, 'ERROR')
                  setCustomer(null)
                  return
                }
                setCustomer(cust)
              }}
            />
          </div>

          {/* Row 2: Shipping Address / Project (Full Width) */}
          <CartDeliveryInput value={shippingAddress} onChange={setShippingAddress} />

          {/* Contact phone of the bill (a bill only: a quotation does not keep it) */}
          {!isQuotationMode && <CartPhoneInput value={contactPhone} onChange={setContactPhone} />}

          {/* Row 3: Document Type (Left) + Add Customer Button (Right) */}
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0" onMouseDown={() => documentTypeAttention && setDocumentTypeAttention(false)}>
              <CustomSelect
                ariaLabel="ประเภทเอกสาร"
                value={documentType}
                onChange={(v) => {
                  setDocumentType(String(v))
                  setDocumentTypeAttention(false)
                }}
                buttonClassName={`h-9 px-2.5 py-0 rounded-xl ${documentTypeAttention ? 'field-attention' : ''}`}
                options={billFormNames.map((name) => ({ value: name, label: name }))}
                placeholder="ประเภทเอกสาร"
                align="left"
              />
            </div>
            <button
              type="button"
              onClick={handleOpenAddCustomerModal}
              className="px-2.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs flex items-center gap-1 shrink-0 shadow-sm transition-all whitespace-nowrap"
              title="เพิ่มลูกค้าใหม่"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>เพิ่มลูกค้า</span>
            </button>
          </div>

          {/* Row 4: Date Picker (Full Width) */}
          <CartDatesButton
            documentDate={documentDate}
            rentalDate={headerRentalDate}
            returnDate={headerReturnDate}
            showDates={showDates}
            attention={datesAttention}
            onClick={() => {
              setDatesAttention(false)
              setShowDatePicker(true)
            }}
          />
        </div>
      </div>

      {/* Cart Items List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center text-slate-600 dark:text-slate-400">
            <ShoppingBag className="w-12 h-12 stroke-1 mb-2 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">ตะกร้ายังว่างอยู่</p>
          </div>
        ) : (
          items.map((item) => {
            // "ไม่คิดเงิน" rental (owner 2026-11-09): the line shows only its จำนวน and หน่วย; the amount,
            // price and period are "-" (the price is a per-unit figure, so "-" everywhere money would be).
            const noCharge = item.rentalType !== 'SALE' && isNoChargeRental(item.product)
            return (
              <div
                key={item.id}
                className="px-2.5 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-900/30 flex items-start justify-between gap-2 group"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                      {item.productName || item.product.name || item.product.product_name}
                    </span>
                    <span className="font-extrabold text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                      {noCharge ? '-' : `${item.lineTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`}
                    </span>
                  </div>

                  {/* Calculation detail */}
                  <div className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                    {noCharge ? (
                      <span className="text-slate-700 dark:text-slate-300">
                        ไม่คิดเงิน · {item.quantity} {item.unitName || item.product.unit || item.product.unit_name || 'ชิ้น'}
                      </span>
                    ) : item.rentalType === 'DAILY' ? (
                      <span className="text-blue-600 dark:text-blue-400">
                        {item.unitPrice.toLocaleString('th-TH')} บาท × {item.quantity} {item.unitName || item.product.unit || item.product.unit_name || 'ชิ้น'} × {item.billableDays} วัน
                      </span>
                    ) : item.rentalType === 'NORMAL' ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {item.unitPrice.toLocaleString('th-TH')} บาท × {item.quantity} {item.unitName || item.product.unit || item.product.unit_name || 'ชิ้น'} × {item.usageCount} รอบ
                      </span>
                    ) : (
                      <span className="text-purple-600 dark:text-purple-400 font-bold">
                        {item.unitPrice.toLocaleString('th-TH')} บาท × {item.quantity} {item.unitName || item.product.unit || item.product.unit_name || 'ชิ้น'} (ขาย)
                      </span>
                    )}
                  </div>
                </div>

                {/* One icon per text line (each h-4 = one text-xs line, gap-1 = space-y-1),
                    so the icons never reach below the 2 lines of text. */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="flex h-4 w-4 items-center justify-center text-slate-600 dark:text-slate-400 hover:text-red-500 transition-colors"
                    title="ลบรายการ"
                    aria-label="ลบรายการ"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {onEditItem && (
                    <button
                      type="button"
                      onClick={() => onEditItem(item)}
                      className="flex h-4 w-4 items-center justify-center text-slate-600 dark:text-slate-400 hover:text-blue-600 transition-colors"
                      title="แก้ไขจำนวน"
                      aria-label="แก้ไขจำนวน"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Totals + next step. Discount, shipping, deposit, VAT and the net amount are set on the next page
          (ชำระเงิน for a bill, สรุปใบเสนอราคา for a quotation — the same central panel, owner 2026-11-04). */}
      {items.length > 0 && (
        <div className="p-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80 space-y-2">
          <div className="flex justify-between items-baseline pt-2 border-t border-slate-200 dark:border-slate-700">
            <span className="font-bold text-sm text-slate-900 dark:text-slate-100">ยอดสินค้ารวม</span>
            <span className="font-black text-xl text-blue-600 dark:text-blue-400 whitespace-nowrap">
              {subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span>
          </div>

          {/* Action buttons */}
          <div className="pt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                if (!validateRentalPeriods()) return
                // A quotation may be for a walk-in customer; a bill needs the customer details first.
                if (!isQuotationMode) {
                  let missing = false
                  try {
                    validateCartCustomer(items, customer)
                  } catch {
                    setCustomerAttention(true)
                    missing = true
                  }
                  if (!documentType) {
                    setDocumentTypeAttention(true)
                    missing = true
                  }
                  if (!datesPicked) {
                    setDatesAttention(true)
                    missing = true
                  }
                  if (missing) return
                }

                saveActiveCart(buildActiveCart())
                onCheckout()
              }}
              disabled={items.length === 0}
              className="w-full col-span-2 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              {isQuotationMode && <FileText className="w-4 h-4" />}
              <span>{isQuotationMode ? 'สรุปใบเสนอราคา' : 'ชำระเงิน'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

        </div>
      )}

      {/* Add New Customer Modal (Enhanced Customer Model with Thai Address & ID Card) */}
      <NewCustomerModal
        isOpen={showAddCustomerModal}
        onClose={() => setShowAddCustomerModal(false)}
        onSave={(newC) => {
          // The POS page saves the customer and shows the result itself (success or failure).
          if (onAddCustomer) return onAddCustomer(newC)
          setCustomer(newC)
          showToast('เพิ่มลูกค้าสำเร็จ', `เลือกลูกค้า ${newC.customerName} เข้าสู่ตะกร้าเรียบร้อยแล้ว`, 'SUCCESS')
        }}
      />

      {/* Sequential Date Picker Modal (shared with แก้ไขบิลเช่า) */}
      <CartDatesModal
        isOpen={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        documentDate={documentDate}
        rentalDate={headerRentalDate}
        returnDate={headerReturnDate}
        onDocumentDate={(d) => {
          setDocumentDate(d)
          setHeaderRentalDate(null)
          setHeaderReturnDate(null)
        }}
        onRentalDate={(d) => {
          setHeaderRentalDate(d)
          setHeaderReturnDate(null)
        }}
        onReturnDate={(d) => {
          setHeaderReturnDate(d)
          setDatesPicked(true)
        }}
      />

    </div>
  )
}
