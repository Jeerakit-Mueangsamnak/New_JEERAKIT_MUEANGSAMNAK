'use client'
import { COMMAND_BUTTON_SIZE_CLASSES, StepNavButton } from '@/components/common/ActionButton'

import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import React, { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Edit3, Trash2, Package, Save, DollarSign, UserPlus } from 'lucide-react'
import { FullBill } from '@/lib/types/rental-return'
import { useToast } from '@/components/common/Toast'
import { CustomDatePicker, getLocalDateString, parseLocalDate } from '@/components/common/CustomDatePicker'
import { CustomSelect, SelectOption } from '@/components/common/CustomSelect'
import { NumericInput } from '@/components/common/NumericInput'
import { DataTableFrame, DATA_TABLE_CLASSES, DATA_TABLE_THEAD_CLASSES } from '@/components/common/DataTableFrame'
import { loadProducts } from '@/features/products/services/product-storage'
import { loadCategories } from '@/lib/category-rules-storage'
import { correctBill, createContinuation, reviseBill, setBillCustomer, setBillDocumentDate, type BillRevision } from '@/features/bills/services/bill-service'
import { CartDatesButton, CartDatesModal, CartDeliveryInput, CartPhoneInput } from '@/features/pos/components/CartDetailFields'
import { CustomerUnifiedSelector } from '@/features/pos/components/CustomerUnifiedSelector'
import { CustomItemModal, type CustomItemData } from '@/features/pos/components/CustomItemModal'
import type { Customer } from '@/lib/types/rental-pos'
import { NewCustomerModal } from '@/features/customers/components/NewCustomerModal'
import { useCreateCustomer } from '@/features/customers/hooks/useCreateCustomer'
import { isIdCardUploadError, loadCustomers, syncCustomersFromSupabase } from '@/features/customers/services/customer-storage'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { dbErrorMessage } from '@/lib/db/rpc'
import { isNoChargeBillLine, isNoChargeRental } from '@/features/pos/services/accessory-rules'

export type BillRevisionMode = 'CORRECTION' | 'EXTENSION'

interface BillRevisionViewProps {
  bill: FullBill
  mode: BillRevisionMode
  onClose: () => void
  onSaved: () => void | Promise<void>
}

interface EditableItem {
  rentalBillItemId?: string
  productId: string
  productName: string
  rentalType: 'NORMAL' | 'DAILY' | 'SALE'
  quantity: number
  returnedQty: number
  outstandingQty: number
  unitPrice: number
  usageCount: number
  dailyStartDate: string
  dailyEndDate: string
  scheduledReturnDate: string
  action: 'UPDATE' | 'ADD' | 'REMOVE'
  addRounds: number
  unitName?: string
  /** Rental method "ไม่คิดเงิน": ราคา/หน่วย and รอบ print "-" and cannot be typed (owner 2026-11-09). */
  isNoCharge?: boolean
  /** + รายการนอกร้าน: a typed-in line with no product (no stock), as in the POS cart. */
  isCustom?: boolean
}

interface ProductOption {
  id: string
  name: string
  code: string
  rentalType: 'NORMAL' | 'DAILY' | 'SALE'
  normalPrice: number
  dailyPrice: number
  salePrice: number
  unitName?: string
  isNoCharge?: boolean
  categoryId?: string
  category?: string
}

function localDate(value?: string | null): string {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 1
  const start = new Date(`${a}T00:00:00`)
  const end = new Date(`${b}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000)
  return Math.max(1, diffDays)
}

type RevisionBill = Pick<FullBill, 'items' | 'rentalStartDate' | 'scheduledReturnDate' | 'discountAmount' | 'billDiscountAmount' | 'shippingFee'>
type RevisionLine = Pick<
  EditableItem,
  'rentalBillItemId' | 'productId' | 'rentalType' | 'quantity' | 'unitPrice' | 'usageCount' | 'dailyStartDate' | 'dailyEndDate' | 'action'
> &
  Partial<Pick<EditableItem, 'productName' | 'unitName' | 'isCustom'>>
type BillItem = FullBill['items'][number]

// Table look shared with the return table (ReturnTableStep): tight centred cells, small number boxes and date buttons.
const cell = 'px-1 text-center'
const numberBox =
  'w-full min-w-0 h-7 px-0.5 text-center font-bold border rounded-lg text-[11px] focus:outline-none border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-emerald-500'
const TABLE_DATE_BUTTON =
  'h-7 px-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-[11px] font-mono font-semibold justify-center [&>span]:text-center hover:border-slate-300'

const round2 = (n: number) => Math.round(n * 100) / 100
const startOfDay = (d: string) => new Date(`${d}T00:00:00`).toISOString()
const endOfDay = (d: string) => new Date(`${d}T23:59:59`).toISOString()
/** Days of a daily-rate line: both ends count, as in POS and เช่าต่อ. */
const dailyDays = (start: string, end: string) => daysBetween(start, end) + 1

/** A line already on the bill whose quantity, price, rounds or dates were changed on screen. */
function lineEdited(item: RevisionLine, orig: BillItem): boolean {
  if (item.quantity !== Number(orig.quantity) || item.unitPrice !== Number(orig.dailyRate || 0)) return true
  if (item.rentalType === 'NORMAL') return (item.usageCount || 1) !== Number(orig.usageCount || 1)
  if (item.rentalType === 'DAILY') {
    return item.dailyStartDate !== localDate(orig.rentalStartDate) || item.dailyEndDate !== localDate(orig.scheduledReturnDate)
  }
  return false
}

/** Money of one line as the screen shows it: an untouched line keeps the bill's own figure. */
function lineAmount(item: RevisionLine, orig: BillItem | undefined): number {
  if (orig && !lineEdited(item, orig)) return Number(orig.lineTotal || 0)
  const periods =
    item.rentalType === 'SALE' ? 1 : item.rentalType === 'DAILY' ? dailyDays(item.dailyStartDate, item.dailyEndDate) : item.usageCount || 1
  return item.quantity * item.unitPrice * periods
}

/**
 * What แก้ไขบิล sends to bill_revise (owner 2026-11-17): every line that stays (only what changed), every added
 * line, and the bill's own discount and fees. A removed line is simply not sent. Line discounts stay as they are,
 * so the discount box (bill + line discounts) sends only the bill's own part.
 */
export function buildRevision(
  bill: RevisionBill,
  items: RevisionLine[],
  header: { start: string; end: string },
  discountAmount: number,
  shippingFee: number
): BillRevision {
  const lineDiscounts = Math.max(0, Number(bill.discountAmount || 0) - Number(bill.billDiscountAmount || 0))
  const headerMoved = header.start !== localDate(bill.rentalStartDate) || header.end !== localDate(bill.scheduledReturnDate)
  const lines: BillRevision['lines'] = []
  for (const item of items) {
    if (item.action === 'REMOVE') continue
    const orig = item.rentalBillItemId ? bill.items.find((it) => it.rentalBillItemId === item.rentalBillItemId) : undefined
    if (orig) {
      const line: Record<string, unknown> = { line_id: orig.rentalBillItemId }
      if (item.quantity !== Number(orig.quantity)) line.ordered_qty = item.quantity
      if (item.unitPrice !== Number(orig.dailyRate || 0)) line.unit_price = item.unitPrice
      if (item.rentalType === 'NORMAL') {
        if ((item.usageCount || 1) !== Number(orig.usageCount || 1)) line.period_count = item.usageCount || 1
        if (headerMoved) {
          line.rental_start_at = startOfDay(header.start)
          line.rental_end_at = endOfDay(header.end)
        }
      } else if (item.rentalType === 'DAILY' && lineEdited({ ...item, quantity: Number(orig.quantity), unitPrice: Number(orig.dailyRate || 0) }, orig)) {
        line.rental_start_at = startOfDay(item.dailyStartDate)
        line.rental_end_at = endOfDay(item.dailyEndDate)
        line.period_count = dailyDays(item.dailyStartDate, item.dailyEndDate)
      }
      lines.push(line)
      continue
    }
    const daily = item.rentalType === 'DAILY'
    lines.push({
      ...(item.isCustom ? { product_id: null, product_name: item.productName ?? '', unit_name: item.unitName ?? null } : { product_id: item.productId }),
      line_mode: item.rentalType === 'SALE' ? 'SALE' : 'RENTAL',
      ordered_qty: item.quantity,
      unit_price: item.unitPrice,
      ...(item.rentalType === 'SALE'
        ? {}
        : {
            rental_calculation_type: daily ? 'PER_DAY' : 'PER_PERIOD',
            period_count: daily ? dailyDays(item.dailyStartDate, item.dailyEndDate) : item.usageCount || 1,
            rental_start_at: startOfDay(daily ? item.dailyStartDate : header.start),
            rental_end_at: endOfDay(daily ? item.dailyEndDate : header.end),
          }),
    })
  }
  return { billDiscountAmount: round2(Math.max(0, discountAmount - lineDiscounts)), feesTotal: round2(shippingFee), lines }
}

/**
 * The POS keeps a bill's delivery place and contact phone in its note as "ส่งที่: …" and "โทร: …" lines
 * (app/pos/checkout).
 */
export const DELIVERY_LABEL = 'ส่งที่'
export const PHONE_LABEL = 'โทร'

export function noteLineValue(note: string | null | undefined, label: string): string {
  const line = (note || '').split('\n').find((l) => l.startsWith(`${label}:`))
  return line ? line.slice(label.length + 1).trim() : ''
}

export function deliveryPlaceOfNote(note?: string | null): string {
  return noteLineValue(note, DELIVERY_LABEL)
}

/** The note with its "label:" line set to `value` (added at the end if missing, dropped when empty); other lines stay. */
export function noteWithLine(note: string | null | undefined, label: string, value: string): string {
  const lines = (note || '').split('\n')
  const at = lines.findIndex((line) => line.startsWith(`${label}:`))
  const next = value.trim() ? `${label}: ${value.trim()}` : ''
  if (at >= 0) lines.splice(at, 1, ...(next ? [next] : []))
  else if (next) lines.push(next)
  return lines.join('\n').trim()
}

export function noteWithDeliveryPlace(note: string | null | undefined, place: string): string {
  return noteWithLine(note, DELIVERY_LABEL, place)
}

/**
 * The customer picked in แก้ไขบิล (owner 2026-11-19): the bill's own name typed again keeps the bill's customer; a typed
 * name that is exactly one saved customer's name is that customer; any other typed name is ลูกค้าทั่วไป (guest).
 */
export function resolveBillCustomer(picked: Customer, current: Customer, customers: Customer[]): Customer {
  if (picked.id) return picked
  const name = picked.customerName.trim().toLowerCase()
  if (name === current.customerName.trim().toLowerCase()) return current
  const same = customers.filter((c) => (c.customerName || '').trim().toLowerCase() === name)
  return same.length === 1 ? same[0] : picked
}

export function BillRevisionView({ bill, mode, onClose, onSaved }: BillRevisionViewProps) {
  const { showToast } = useToast()
  const confirmDialog = useConfirm()
  const [documentDate, setDocumentDate] = useState<string>('')
  const [headerRentalDate, setHeaderRentalDate] = useState<string>('')
  const [headerReturnDate, setHeaderReturnDate] = useState<string>('')
  const [discountAmount, setDiscountAmount] = useState<number>(0)
  const [shippingFee, setShippingFee] = useState<number>(0)
  const [items, setItems] = useState<EditableItem[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  // สถานที่จัดส่ง (owner 2026-11-19): the "ส่งที่:" line of the bill's note, as the POS saved it
  const [deliveryPlace, setDeliveryPlace] = useState('')
  // เบอร์โทรติดต่อ: the "โทร:" line of the note, as the POS saved it
  const [contactPhone, setContactPhone] = useState('')
  const [customItemOpen, setCustomItemOpen] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  // ลูกค้า (owner 2026-11-19): may be changed to another saved customer, or to a typed name (ลูกค้าทั่วไป)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [customers, setCustomers] = useState<Customer[]>(() => loadCustomers())
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const createCustomer = useCreateCustomer()

  useEffect(() => {
    let alive = true
    void syncCustomersFromSupabase()
      .then((list) => alive && setCustomers(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // Initialize data from bill
  useEffect(() => {
    if (!bill) return
    setDocumentDate(localDate(bill.documentDate || bill.billDate))
    setHeaderRentalDate(localDate(bill.rentalStartDate) || getLocalDateString(new Date()))
    setHeaderReturnDate(localDate(bill.scheduledReturnDate) || getLocalDateString(new Date()))
    setDiscountAmount(Number(bill.discountAmount || 0))
    setShippingFee(Number(bill.shippingFee || 0))
    setDeliveryPlace(bill.siteName || deliveryPlaceOfNote(bill.remark))
    setContactPhone(noteLineValue(bill.remark, PHONE_LABEL))
    setItems(
      bill.items.map((item) => ({
        rentalBillItemId: item.rentalBillItemId,
        productId: item.productId,
        productName: item.productName,
        rentalType: (item.rentalType || 'NORMAL') as 'NORMAL' | 'DAILY' | 'SALE',
        quantity: item.quantity,
        returnedQty: item.returnedQty,
        outstandingQty: item.outstandingQty,
        unitPrice: Number(item.dailyRate || 0),
        usageCount: Number(item.usageCount || 1),
        dailyStartDate: localDate(item.rentalStartDate) || localDate(bill.rentalStartDate) || getLocalDateString(new Date()),
        dailyEndDate: localDate(item.scheduledReturnDate) || localDate(bill.scheduledReturnDate) || getLocalDateString(new Date()),
        scheduledReturnDate: localDate(item.scheduledReturnDate || bill.scheduledReturnDate) || getLocalDateString(new Date()),
        action: 'UPDATE',
        addRounds: 0,
        unitName: item.unit || 'ชิ้น',
        isNoCharge: isNoChargeBillLine(item),
      }))
    )
  }, [bill, mode])

  // Load product list for combobox
  useEffect(() => {
    const list = loadProducts()
    setProducts(
      list.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        rentalType: p.rentalType,
        normalPrice: p.normalPrice,
        dailyPrice: p.dailyPrice,
        salePrice: p.salePrice ?? 0,
        unitName: p.unit,
        isNoCharge: p.rentalType !== 'SALE' && isNoChargeRental(p),
        categoryId: p.categoryId,
        category: p.category,
      }))
    )
  }, [])

  // หมวดหมู่สินค้า + สินค้า, same as the appointment form (owner 2026-11-17): the category narrows the product list,
  // picking a product adds it to the bill at once; the product list shows names only.
  const categories = useMemo(() => loadCategories().filter((c) => c.isActive !== false), [])
  const categoryOptions: SelectOption[] = useMemo(
    () => [{ value: '', label: 'ทุกหมวดหมู่' }, ...categories.map((c) => ({ value: c.id, label: c.name }))],
    [categories]
  )
  const productSelectOptions: SelectOption[] = useMemo(() => {
    const selected = categories.find((c) => c.id === categoryId)
    return products
      .filter((p) => !selected || p.categoryId === selected.id || p.category === selected.name)
      .map((p) => ({ value: p.id, label: p.name }))
  }, [products, categories, categoryId])

  const activeItems = useMemo(() => items.filter((item) => item.action !== 'REMOVE'), [items])

  // Live Subtotal: an untouched line keeps the bill's own figure, a changed or added one is priced on screen
  const calculatedSubtotal = useMemo(
    () =>
      activeItems.reduce((sum, item) => {
        const orig = item.rentalBillItemId ? bill?.items.find((it) => it.rentalBillItemId === item.rentalBillItemId) : undefined
        return sum + lineAmount(item, orig)
      }, 0),
    [activeItems, bill]
  )

  // แก้ไขบิล (owner 2026-11-17): the bill priced again as the server does — bill discount, fees, then the bill's own
  // VAT; fees and adjustments already on the bill stay. Deposit is held apart.
  const calculatedGrandTotal = useMemo(() => {
    if (bill && mode !== 'EXTENSION') {
      const lineDiscounts = Math.max(0, Number(bill.discountAmount || 0) - Number(bill.billDiscountAmount || 0))
      const net = Math.max(0, calculatedSubtotal - Math.max(0, (discountAmount || 0) - lineDiscounts)) + (shippingFee || 0)
      const rate = bill.vatMode === 'EXCLUSIVE' ? Number(bill.vatRatePercent || 0) : 0
      const extra = Number(bill.grandTotal || 0) - Number(bill.billAmount || 0)
      return Math.max(0, round2(net * (1 + rate / 100)) + extra)
    }
    return Math.max(0, calculatedSubtotal - (discountAmount || 0) + (shippingFee || 0))
  }, [calculatedSubtotal, discountAmount, shippingFee, bill, mode])

  const updateItem = (index: number, patch: Partial<EditableItem>) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        const updated = { ...item, ...patch }

        // If returnedQty or outstandingQty changed, keep quantity synchronized
        if (patch.returnedQty !== undefined || patch.outstandingQty !== undefined) {
          const ret = patch.returnedQty !== undefined ? patch.returnedQty : item.returnedQty
          const out = patch.outstandingQty !== undefined ? patch.outstandingQty : item.outstandingQty
          updated.quantity = Math.max(1, ret + out)
        }

        // If quantity changed directly, update outstandingQty
        if (patch.quantity !== undefined && patch.outstandingQty === undefined) {
          updated.outstandingQty = Math.max(0, patch.quantity - (item.returnedQty || 0))
        }

        return updated
      })
    )
  }

  const addProduct = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    const unitPrice =
      product.rentalType === 'DAILY'
        ? product.dailyPrice
        : product.rentalType === 'SALE'
          ? product.salePrice
          : product.normalPrice

    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        rentalType: product.rentalType,
        quantity: 1,
        returnedQty: 0,
        outstandingQty: product.rentalType === 'SALE' ? 0 : 1,
        unitPrice,
        usageCount: 1,
        dailyStartDate: headerRentalDate || getLocalDateString(new Date()),
        dailyEndDate: headerReturnDate || getLocalDateString(new Date()),
        scheduledReturnDate: headerReturnDate || getLocalDateString(new Date()),
        action: 'ADD',
        addRounds: 0,
        unitName: product.unitName || 'ชิ้น',
        isNoCharge: product.isNoCharge,
      },
    ])
  }

  /** + รายการนอกร้าน (owner 2026-11-19): typed-in lines, the same window as the POS cart; dates follow the bill. */
  const addCustomItems = (rows: CustomItemData[]) => {
    const start = headerRentalDate || getLocalDateString(new Date())
    const end = headerReturnDate || getLocalDateString(new Date())
    setItems((prev) => [
      ...prev,
      ...rows.map((row) => {
        const count = row.rentalType === 'SALE' ? 1 : Math.max(1, Math.floor(Number(row.count) || 1))
        // A daily line counts both ends: N days = start … start + N - 1
        const dailyEnd = new Date(`${start}T00:00:00`)
        dailyEnd.setDate(dailyEnd.getDate() + count - 1)
        return {
          productId: '',
          productName: row.name,
          rentalType: row.rentalType,
          quantity: row.quantity,
          returnedQty: 0,
          outstandingQty: row.rentalType === 'SALE' ? 0 : row.quantity,
          unitPrice: row.unitPrice,
          usageCount: row.rentalType === 'NORMAL' ? count : 1,
          dailyStartDate: start,
          dailyEndDate: row.rentalType === 'DAILY' ? getLocalDateString(dailyEnd) : end,
          scheduledReturnDate: end,
          action: 'ADD' as const,
          addRounds: 0,
          unitName: row.unit,
          isCustom: true,
        }
      }),
    ])
    setCustomItemOpen(false)
  }

  // The bill's customer, shown as in the cart
  const billCustomer: Customer = useMemo(
    () => ({
      id: bill.customerId || '',
      customerName: bill.customerName,
      phone: bill.customerPhone || '',
      address: '',
      taxId: '',
      status: 'ACTIVE',
    }),
    [bill.customerId, bill.customerName, bill.customerPhone]
  )
  useEffect(() => setCustomer(billCustomer), [billCustomer])
  // เช่าต่อ, credit bills and bills made by เช่าต่อ keep their customer (the server refuses the change too)
  const customerLocked = mode === 'EXTENSION' || Boolean(bill.isCreditBill || bill.parentBillId)

  const pickCustomer = (picked: Customer | null) => {
    if (!picked) {
      setCustomer(null)
      return
    }
    if (picked.isSuspended) {
      showToast('ลูกค้าถูกระงับสิทธิ์', `ลูกค้า ${picked.customerName} ถูกระงับสิทธิ์ ไม่สามารถทำรายการได้`, 'ERROR')
      return
    }
    setCustomer(resolveBillCustomer(picked, billCustomer, customers))
  }

  const handleAddCustomer = async (newCustomer: Customer): Promise<boolean> => {
    try {
      // The server assigns the customer id; select the saved record, not the form copy (as the POS does).
      const saved = await createCustomer(newCustomer)
      setCustomers(loadCustomers())
      setCustomer(saved)
      showToast('เพิ่มลูกค้าสำเร็จ', `เพิ่มลูกค้า ${newCustomer.customerName} เรียบร้อยแล้ว`, 'SUCCESS')
      return true
    } catch (err: any) {
      if (isIdCardUploadError(err)) {
        setCustomers(loadCustomers())
        setCustomer(err.saved)
        showToast('บันทึกข้อมูลลูกค้าแล้ว', err.message, 'INFO')
        return true
      }
      if (err?.tag === 'DUPLICATE_CUSTOMER') return false
      showToast('ไม่สามารถเพิ่มลูกค้าได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
      return false
    }
  }

  const handleSave = async () => {
    if (!bill) return
    if (!headerReturnDate) {
      showToast('กรุณาระบุวันกำหนดคืน', 'ไม่พบวันกำหนดคืนที่ต้องการบันทึก', 'ERROR')
      return
    }
    if (headerRentalDate && headerReturnDate < headerRentalDate) {
      showToast('ช่วงวันเช่าไม่ถูกต้อง', 'วันกำหนดคืนต้องไม่ก่อนวันเริ่มเช่า', 'ERROR')
      return
    }

    setIsSaving(true)
    try {
      const startOf = (d: string) => new Date(`${d}T00:00:00`).toISOString()
      const endOf = (d: string) => new Date(`${d}T23:59:59`).toISOString()
      const nextDay = (d: string) => {
        const dt = new Date(`${d}T00:00:00`)
        dt.setDate(dt.getDate() + 1)
        return getLocalDateString(dt)
      }

      if (mode === 'EXTENSION') {
        // เช่าต่อ = a new child bill for the goods still out (Master §17); the parent stays as it was.
        const lines = items
          .filter((i) => i.rentalBillItemId && i.action !== 'REMOVE' && i.rentalType !== 'SALE' && i.outstandingQty > 0)
          .map((i) => {
            const prevEnd = i.scheduledReturnDate
            if (i.rentalType === 'DAILY') {
              const start = nextDay(prevEnd)
              const end = i.dailyEndDate > prevEnd ? i.dailyEndDate : headerReturnDate
              return {
                fromLineId: i.rentalBillItemId as string,
                quantity: i.outstandingQty,
                unitPrice: i.unitPrice,
                calc: 'PER_DAY' as const,
                periods: daysBetween(start, end) + 1,
                startAt: startOf(start),
                endAt: endOf(end),
              }
            }
            return {
              fromLineId: i.rentalBillItemId as string,
              quantity: i.outstandingQty,
              unitPrice: i.unitPrice,
              calc: 'PER_PERIOD' as const,
              periods: Math.max(1, i.addRounds || 1),
              startAt: startOf(nextDay(prevEnd)),
              endAt: endOf(headerReturnDate > prevEnd ? headerReturnDate : nextDay(prevEnd)),
            }
          })
        if (lines.length === 0) {
          showToast('ไม่มีรายการเช่าต่อ', 'ไม่มีสินค้าที่ลูกค้ายังถืออยู่ในบิลนี้', 'ERROR')
          return
        }
        const isLate = getLocalDateString(new Date()) > localDate(bill.scheduledReturnDate)
        const startMode = isLate
          ? (await confirmDialog({
              title: 'บิลนี้เลยวันกำหนดคืนแล้ว',
              message: 'เลือกวันเริ่มนับรอบเช่าใหม่',
              confirmLabel: 'ต่อจากวันครบกำหนดเดิม',
              cancelLabel: 'เริ่มตั้งแต่วันนี้',
            }))
            ? ('FROM_PREVIOUS_END' as const)
            : ('FROM_APPROVAL' as const)
          : undefined
        await createContinuation({ parentBillId: bill.id, reason: '', startMode, items: lines })
      } else {
        // แก้ไขบิล (owner 2026-11-17): add / remove / change goods and money; the server moves the stock and prices
        // the bill again in the same step (bill_revise).
        if (activeItems.length === 0) {
          showToast('บิลต้องมีสินค้าอย่างน้อย 1 รายการ', 'ถ้าจะเอาออกทั้งหมด ให้ใช้ยกเลิกบิล', 'ERROR')
          return
        }
        // วันที่ออกเอกสาร (owner 2026-11-17): printed text only — bill number, money and stock untouched; never a future day
        const dateChanged = Boolean(documentDate) && documentDate !== localDate(bill.documentDate || bill.billDate)
        if (dateChanged && documentDate > getLocalDateString(new Date())) {
          showToast('วันที่เอกสารไม่ถูกต้อง', 'วันที่ออกเอกสารต้องไม่อยู่ในอนาคต', 'ERROR')
          return
        }
        const revision = buildRevision(bill, items, { start: headerRentalDate, end: headerReturnDate }, discountAmount, shippingFee)
        const untouched =
          revision.lines.length === bill.items.length &&
          revision.lines.every((l) => l.line_id && Object.keys(l).length === 1) &&
          revision.billDiscountAmount === round2(Number(bill.billDiscountAmount || 0)) &&
          revision.feesTotal === round2(Number(bill.shippingFee || 0))
        const placeChanged = deliveryPlace.trim() !== (bill.siteName || deliveryPlaceOfNote(bill.remark))
        const phoneChanged = contactPhone.trim() !== noteLineValue(bill.remark, PHONE_LABEL)
        if (!customer) {
          showToast('กรุณาเลือกลูกค้า', 'เลือกลูกค้าในระบบ หรือพิมพ์ชื่อลูกค้าทั่วไป', 'ERROR')
          return
        }
        const customerChanged =
          customer.id !== billCustomer.id || (!customer.id && customer.customerName.trim() !== billCustomer.customerName.trim())
        if (untouched && !dateChanged && !placeChanged && !phoneChanged && !customerChanged) {
          showToast('ไม่มีการแก้ไข', 'ยังไม่ได้เปลี่ยนลูกค้า วันที่ สินค้า จำนวน ราคา ส่วนลด ค่าขนส่ง สถานที่จัดส่ง หรือเบอร์โทร', 'INFO')
          return
        }
        // The customer first: a refused change (credit / เช่าต่อ bill) stops before anything else is saved
        if (customerChanged) await setBillCustomer(bill.id, customer.id || null, customer.id ? null : customer.customerName)
        if (!untouched) await reviseBill(bill.id, revision)
        if (dateChanged) await setBillDocumentDate(bill.id, documentDate)
        // The delivery place and contact phone are lines of the bill's note (bill_correct: PIN + audit, as any note fix)
        if (placeChanged || phoneChanged) {
          const note = noteWithLine(noteWithDeliveryPlace(bill.remark, deliveryPlace), PHONE_LABEL, contactPhone)
          await correctBill(bill.id, { note: note || null }, 'แก้ไขสถานที่จัดส่ง / เบอร์โทรติดต่อ')
        }
      }

      showToast(
        mode === 'EXTENSION' ? 'บันทึกการเช่าต่อสำเร็จ' : 'แก้ไขบิลสำเร็จ',
        'บันทึกข้อมูลและประวัติการแก้ไขเรียบร้อยแล้ว',
        'SUCCESS'
      )
      await onSaved()
    } catch (err: any) {
      if (isPinCancelled(err)) return
      showToast('เกิดข้อผิดพลาดในการแก้ไขบิล', dbErrorMessage(err?.message || '') || 'ไม่สามารถบันทึกการแก้ไขบิลได้', 'ERROR')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    // One white work area (owner 2026-11-17), full width like the return / payment work areas: the bills page
    // already gives the grey edge, so no second padding here. Title, fields, items, summary and buttons inside.
    <div className="flex flex-col min-h-0 h-full w-full overflow-hidden animate-in fade-in duration-150 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm text-slate-900 dark:text-slate-100">
      {/* 1. Title */}
      <div className="border-b border-slate-200 dark:border-slate-700 px-3 py-2 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`p-2 rounded-xl text-white shrink-0 ${
                mode === 'EXTENSION' ? 'bg-cyan-700' : 'bg-violet-600'
              }`}
            >
              {mode === 'EXTENSION' ? <CalendarPlus className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                <span>{mode === 'EXTENSION' ? 'เช่าต่อ / เพิ่มสินค้า' : 'แก้ไขบิลเช่า'}</span>
                <span className="font-mono text-blue-600 dark:text-blue-400 font-black">{bill.billNo}</span>
              </h2>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                ลูกค้า: <strong className="text-slate-800 dark:text-slate-200">{bill.customerName}</strong> {bill.customerPhone ? `(${bill.customerPhone})` : ''}
              </p>
            </div>
          </div>
          {/* + รายการนอกร้าน, as in the POS cart header (แก้ไขบิล only: เช่าต่อ carries the goods still out) */}
          {mode !== 'EXTENSION' && (
            <button
              type="button"
              onClick={() => setCustomItemOpen(true)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              + รายการนอกร้าน
            </button>
          )}
      </div>


        {/* หมวดหมู่สินค้า / สินค้า (owner 2026-11-17: same dropdowns as the appointment form) */}
        <div className="p-2 border-b border-slate-200 dark:border-slate-700 shrink-0 grid grid-cols-2 gap-1.5 sm:gap-2">
          <div className="space-y-1 min-w-0">
            <label className="text-[10px] sm:text-[11px] font-bold text-slate-700 dark:text-slate-300 block truncate">หมวดหมู่สินค้า</label>
            <CustomSelect
              value={categoryId}
              onChange={(val) => setCategoryId(String(val))}
              options={categoryOptions}
              placeholder="ทุกหมวดหมู่"
            />
          </div>
          <div className="space-y-1 min-w-0">
            <label className="text-[10px] sm:text-[11px] font-bold text-slate-700 dark:text-slate-300 block truncate">สินค้า</label>
            <CustomSelect
              value=""
              onChange={(val) => addProduct(String(val))}
              options={productSelectOptions}
              placeholder="เลือกสินค้า..."
              emptyText="ไม่มีสินค้าในหมวดนี้"
              searchable
            />
          </div>
        </div>

        {/* 3. Items: the table takes the free height and scrolls inside */}
          {/* Shared table frame, same as the return table: sticky header, rows scroll, count bar under them */}
          <DataTableFrame fill rowCount={items.length} className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent">
            <table className={`${DATA_TABLE_CLASSES} text-[10px] leading-tight`}>
              <colgroup>
                {/* ลำดับ / สินค้า / คืนแล้ว / กำลังเช่า / จำนวนในบิล / ราคาต่อหน่วย / วันที่เช่า / วันที่กำหนดคืน / รอบ / จัดการ — no text between <col>s (hydration) */}
                <col className="w-[40px] sm:w-[44px]" />
                <col className="w-auto" />
                <col className="w-[52px] sm:w-[60px]" />
                <col className="w-[52px] sm:w-[60px]" />
                <col className="w-[52px] sm:w-[60px]" />
                <col className="w-[64px] sm:w-[76px]" />
                <col className="w-[96px] sm:w-[115px]" />
                <col className="w-[96px] sm:w-[115px]" />
                <col className="w-[40px] sm:w-[48px]" />
                <col className="w-[38px] sm:w-[44px]" />
              </colgroup>
              <thead className={`${DATA_TABLE_THEAD_CLASSES} border-b border-slate-200 dark:border-slate-700 shadow-sm text-xs`}>
                <tr>
                  <th className="px-1 text-center">ลำดับ</th>
                  <th className="px-1 text-left">รายการสินค้า</th>
                  <th className="px-1 text-center">คืนแล้ว</th>
                  <th className="px-1 text-center">กำลังเช่า</th>
                  <th className="px-1 text-center">จำนวน</th>
                  <th className="px-1 text-center">ราคา/หน่วย</th>
                  <th className="px-1 text-center">วันที่เช่า</th>
                  <th className="px-1 text-center">กำหนดคืน</th>
                  <th className="px-1 text-center">รอบ</th>
                  <th className="px-1 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {items.map((item, index) => {
                  const isRemoved = item.action === 'REMOVE'
                  const isDaily = item.rentalType === 'DAILY'
                  const isNormal = item.rentalType === 'NORMAL'

                  return (
                    <tr
                      key={item.rentalBillItemId || `${item.productId}-${index}`}
                      className={`transition-colors ${
                        isRemoved
                          ? 'bg-red-50/40 dark:bg-red-950/20 opacity-50 line-through'
                          : item.action === 'ADD'
                            ? 'bg-emerald-50/30 dark:bg-emerald-950/20'
                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-700/30'
                      }`}
                    >
                      <td className={`${cell} font-bold text-slate-600 dark:text-slate-400`}>{index + 1}</td>
                      {/* Product Name */}
                      <td className="px-1 font-bold text-slate-800 dark:text-slate-200 overflow-hidden">
                        <div className="truncate">{item.productName}</div>
                        <div className="text-[10px] text-slate-600 dark:text-slate-400 font-mono flex items-center gap-1 mt-0.5 truncate">
                          <span
                            className={`px-1 py-0.2 rounded font-bold text-[10px] shrink-0 ${
                              isDaily
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                : item.rentalType === 'SALE'
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
                            }`}
                          >
                            {isDaily ? 'รายวัน' : item.rentalType === 'SALE' ? 'ขายขาด' : 'ตามรอบ'}
                          </span>
                          <span className="truncate">หน่วย: {item.unitName || 'ชิ้น'}</span>
                        </div>
                      </td>

                      {/* Returned Qty (Editable, snug fit) */}
                      <td className={cell}>
                        <NumericInput
                          disabled
                          min={0}
                          allowDecimals={false}
                          value={item.returnedQty === 0 ? '' : item.returnedQty}
                          defaultValueOnBlur={0}
                          onChange={(val) =>
                            updateItem(index, { returnedQty: val === '' ? 0 : Number(val) })
                          }
                          className={`${numberBox} disabled:opacity-50`}
                        />
                      </td>

                      {/* Outstanding Qty / กำลังเช่า (Editable, snug fit) */}
                      <td className={cell}>
                        <NumericInput
                          disabled
                          min={0}
                          allowDecimals={false}
                          value={item.outstandingQty === 0 ? '' : item.outstandingQty}
                          defaultValueOnBlur={0}
                          onChange={(val) =>
                            updateItem(index, { outstandingQty: val === '' ? 0 : Number(val) })
                          }
                          className={`${numberBox} disabled:opacity-50`}
                        />
                      </td>

                      {/* Total Quantity in Bill */}
                      <td className={cell}>
                        <NumericInput
                          disabled={isRemoved}
                          min={1}
                          allowDecimals={false}
                          value={item.quantity}
                          defaultValueOnBlur={1}
                          onChange={(val) => {
                            if (val !== '') {
                              updateItem(index, { quantity: Math.max(1, Number(val)) })
                            }
                          }}
                          className={`${numberBox} disabled:opacity-50`}
                        />
                      </td>

                      {/* Unit Price — a "ไม่คิดเงิน" line has none: "-" like its รอบ */}
                      <td className={cell}>
                        {item.isNoCharge ? (
                          <span className="text-slate-600 dark:text-slate-400 font-mono text-center block">-</span>
                        ) : (
                          <NumericInput
                            disabled={isRemoved}
                            min={0}
                            allowDecimals={true}
                            value={item.unitPrice === 0 ? '' : item.unitPrice}
                            defaultValueOnBlur={0}
                            onChange={(val) =>
                              updateItem(index, { unitPrice: val === '' ? 0 : Number(val) })
                            }
                            className={`${numberBox} disabled:opacity-50`}
                          />
                        )}
                      </td>

                      {/* Daily Start Date (Calendar Popover - Editable ONLY for DAILY) */}
                      <td className={cell}>
                        {isDaily && !isRemoved ? (
                          <CustomDatePicker
                            value={parseLocalDate(item.dailyStartDate)}
                            onChange={(val) =>
                              updateItem(index, { dailyStartDate: val ? getLocalDateString(val) : '' })
                            }
                            showClear={false}
                            hideIcon
                            align="right"
                            className="text-xs"
                            buttonClassName={TABLE_DATE_BUTTON}
                          />
                        ) : (
                          <span className="text-slate-600 dark:text-slate-400 font-mono text-center block">-</span>
                        )}
                      </td>

                      {/* Daily End Date (Calendar Popover - Editable ONLY for DAILY) */}
                      <td className={cell}>
                        {isDaily && !isRemoved ? (
                          <CustomDatePicker
                            value={parseLocalDate(item.dailyEndDate)}
                            onChange={(val) =>
                              updateItem(index, {
                                dailyEndDate: val ? getLocalDateString(val) : '',
                                scheduledReturnDate: val ? getLocalDateString(val) : '',
                              })
                            }
                            showClear={false}
                            hideIcon
                            align="right"
                            className="text-xs"
                            buttonClassName={TABLE_DATE_BUTTON}
                          />
                        ) : (
                          <span className="text-slate-600 dark:text-slate-400 font-mono text-center block">-</span>
                        )}
                      </td>

                      {/* Usage Count / รอบ (For NORMAL items) */}
                      <td className={cell}>
                        {isNormal && !isRemoved && !item.isNoCharge ? (
                          <NumericInput
                            disabled={isRemoved}
                            min={1}
                            allowDecimals={false}
                            value={item.usageCount || 1}
                            defaultValueOnBlur={1}
                            onChange={(val) => {
                              if (val !== '') {
                                updateItem(index, { usageCount: Math.max(1, Number(val)) })
                              }
                            }}
                            className={numberBox}
                          />
                        ) : (
                          <span className="text-slate-600 dark:text-slate-400 font-mono">-</span>
                        )}
                      </td>

                      {/* Action: Remove / Restore */}
                      <td className={cell}>
                        {item.action === 'ADD' ? (
                          <button
                            type="button"
                            onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                            className="p-1 rounded-lg text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            title="ลบรายการที่เพิ่ม"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(index, { action: item.action === 'REMOVE' ? 'UPDATE' : 'REMOVE' })
                            }
                            className={`p-1 rounded-lg cursor-pointer ${
                              isRemoved
                                ? 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                                : 'text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
                            }`}
                            title={isRemoved ? 'นำรายการกลับมา' : 'ทำเครื่องหมายลบรายการ'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DataTableFrame>

        {/* 4. Bottom (owner 2026-11-19): the cart's input set on the left (ลูกค้า, สถานที่จัดส่ง, เบอร์โทร, dates, ส่วนลด, ค่าขนส่ง) with
            ย้อนกลับ under it; the summary with ยกเลิก / บันทึก under it on the right */}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 p-2 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-3">
          <div className="w-full sm:w-80 flex flex-col gap-2">
            {customerLocked ? (
              <CustomerUnifiedSelector selectedCustomer={billCustomer} customers={[]} onSelectCustomer={() => {}} disabled />
            ) : (
              <CustomerUnifiedSelector selectedCustomer={customer} customers={customers} onSelectCustomer={pickCustomer} />
            )}
            {mode !== 'EXTENSION' && (
              <>
                <CartDeliveryInput value={deliveryPlace} onChange={setDeliveryPlace} />
                {/* เบอร์โทรติดต่อ + เพิ่มลูกค้า in one row (the cart's ประเภทเอกสาร is not part of a bill) */}
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 min-w-0">
                    <CartPhoneInput value={contactPhone} onChange={setContactPhone} />
                  </div>
                  {!customerLocked && (
                    <button
                      type="button"
                      onClick={() => setShowAddCustomer(true)}
                      className="px-2.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs flex items-center gap-1 shrink-0 shadow-sm transition-all whitespace-nowrap"
                      title="เพิ่มลูกค้าใหม่"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>เพิ่มลูกค้า</span>
                    </button>
                  )}
                </div>
              </>
            )}
            <CartDatesButton
              documentDate={parseLocalDate(documentDate)}
              rentalDate={parseLocalDate(headerRentalDate)}
              returnDate={parseLocalDate(headerReturnDate)}
              withDocumentDate={mode !== 'EXTENSION'}
              onClick={() => setShowDatePicker(true)}
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1 min-w-0">
                <label className="text-[10px] sm:text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 truncate">
                  <DollarSign className="w-3 h-3 text-emerald-700 dark:text-emerald-400 shrink-0" />
                  <span className="truncate">ส่วนลด (บาท)</span>
                </label>
                <NumericInput
                  min={0}
                  allowDecimals={true}
                  value={discountAmount === 0 ? '' : discountAmount}
                  defaultValueOnBlur={0}
                  onChange={(val) => setDiscountAmount(val === '' ? 0 : Number(val))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1 text-xs font-mono font-bold text-right focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-0"
                />
              </div>
              <div className="space-y-1 min-w-0">
                <label className="text-[10px] sm:text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 truncate">
                  <Package className="w-3 h-3 text-cyan-700 dark:text-cyan-400 shrink-0" />
                  <span className="truncate">ค่าขนส่ง (บาท)</span>
                </label>
                <NumericInput
                  min={0}
                  allowDecimals={true}
                  value={shippingFee === 0 ? '' : shippingFee}
                  defaultValueOnBlur={0}
                  onChange={(val) => setShippingFee(val === '' ? 0 : Number(val))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1 text-xs font-mono font-bold text-right focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-0"
                />
              </div>
            </div>
            <StepNavButton direction="back" onClick={onClose} className="self-start" />
          </div>
          <div className="w-full sm:w-80 flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>ค่าเช่าคำนวณใหม่:</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {calculatedSubtotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>ส่วนลด:</span>
                <span className="font-mono font-bold text-red-700 dark:text-red-400">
                  {(discountAmount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>ค่าขนส่ง:</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {(shippingFee || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-700/60 pt-2 space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">ยอดรวมสุทธิใหม่:</span>
                <span className="text-base font-black text-emerald-700 dark:text-emerald-400 font-mono">
                  {calculatedGrandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-600 dark:text-slate-400">
                <span>ชำระแล้วเดิม:</span>
                <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {(bill.paidAmount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {calculatedGrandTotal < (bill.paidAmount || 0) ? (
                <div className="flex justify-between text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                  <span>ต้องคืนเงินลูกค้า:</span>
                  <span className="font-mono font-black">
                    {((bill.paidAmount || 0) - calculatedGrandTotal).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between text-[11px] font-bold text-red-700 dark:text-red-400">
                  <span>ยอดค้างชำระใหม่:</span>
                  <span className="font-mono font-black">
                    {Math.max(0, calculatedGrandTotal - (bill.paidAmount || 0)).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all cursor-pointer`}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSave()}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} px-3 text-white shadow-md transition-all flex items-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                mode === 'EXTENSION'
                  ? 'bg-cyan-700 hover:bg-cyan-800 shadow-cyan-600/25'
                  : 'bg-emerald-700 hover:bg-emerald-800 shadow-emerald-600/25'
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'กำลังบันทึก...' : mode === 'EXTENSION' ? 'ยืนยันเช่าต่อ' : 'บันทึกการแก้ไข'}</span>
            </button>
          </div>
          </div>
        </div>

      <NewCustomerModal isOpen={showAddCustomer} onClose={() => setShowAddCustomer(false)} onSave={handleAddCustomer} />

      {customItemOpen && <CustomItemModal onAdd={addCustomItems} onClose={() => setCustomItemOpen(false)} submitLabel="เพิ่มลงบิล" />}

      {/* The cart's step-by-step date window (shared with the POS cart) */}
      <CartDatesModal
        isOpen={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        documentDate={parseLocalDate(documentDate)}
        rentalDate={parseLocalDate(headerRentalDate)}
        returnDate={parseLocalDate(headerReturnDate)}
        withDocumentDate={mode !== 'EXTENSION'}
        onDocumentDate={(d) => setDocumentDate(getLocalDateString(d))}
        onRentalDate={(d) => setHeaderRentalDate(getLocalDateString(d))}
        onReturnDate={(d) => setHeaderReturnDate(getLocalDateString(d))}
      />
    </div>
  )
}
