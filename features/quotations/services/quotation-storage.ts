/**
 * Quotation cache + commands for the UI (Master v4.3.1 §10). Supabase is the source of truth:
 * reads via features/quotations/api/quotation-repository.ts, writes through the quotation RPCs,
 * then the cache is reloaded. Quotations never move stock or money.
 */
import { Quotation, QuotationStatus, Customer, Product } from '@/lib/types/rental-pos'
import { CartItem, cartLineListPrice, isSaleCartItem } from '@/features/pos/services/cart-storage'
import { validateProductMode } from '@/features/products/services/product-storage'
import {
  fetchQuotationsFromSupabase as fetchQuotationsFromRepository,
  saveQuotationDraft,
  sendQuotation,
  setQuotationStatus,
} from '@/features/quotations/api/quotation-repository'

let _cachedQuotations: Quotation[] | null = null

export function setCachedQuotations(quotations: Quotation[]): void {
  _cachedQuotations = quotations
}

export function loadQuotations(): Quotation[] {
  return _cachedQuotations || []
}

export async function fetchQuotationsFromSupabase(): Promise<Quotation[]> {
  _cachedQuotations = await fetchQuotationsFromRepository()
  return _cachedQuotations
}

export function getQuotationById(id: string): Quotation | null {
  return loadQuotations().find((q) => q.id === id || q.quotationNo === id) || null
}

/** Number is assigned by the server when the quotation is sent; drafts show a temporary label. */
export function generateQuotationNo(): string {
  return 'ร่างใบเสนอราคา'
}

/** Statuses still waiting for the customer's answer (filter "รอยืนยัน"). */
export const QUOTATION_WAITING_STATUSES: QuotationStatus[] = ['DRAFT', 'SENT', 'WAITING']

/**
 * List badge + what the row may do. CONVERTED / REJECTED are final on the server: no accept,
 * no edit, no cancel (copy is always allowed). Quotations have no expiry (owner 2026-10-18);
 * an old EXPIRED row is shown as closed.
 */
export function quotationStatusView(status: QuotationStatus): {
  label: string
  tone: 'accepted' | 'converted' | 'closed' | 'waiting'
  actionable: boolean
  editable: boolean
  cancellable: boolean
} {
  if (status === 'ACCEPTED') return { label: 'ตอบรับแล้ว', tone: 'accepted', actionable: true, editable: true, cancellable: true }
  if (status === 'CONVERTED') return { label: 'เปิดบิลแล้ว', tone: 'converted', actionable: false, editable: false, cancellable: false }
  if (status === 'REJECTED' || status === 'CANCELLED' || status === 'EXPIRED') {
    return { label: 'ยกเลิกแล้ว', tone: 'closed', actionable: false, editable: false, cancellable: false }
  }
  return { label: 'รอยืนยัน', tone: 'waiting', actionable: true, editable: true, cancellable: true }
}

/**
 * Rounds (NORMAL) or billable days (DAILY) of a cart line, as checkout reads them; 1 for a sale.
 * A NORMAL line keeps billableDays = 1, so it must not win over usageCount.
 */
export function quotationPeriodOf(item: Pick<CartItem, 'rentalType' | 'itemType' | 'usageCount' | 'billableDays' | 'product'>): number {
  if (isSaleCartItem(item)) return 1
  const n = item.rentalType === 'DAILY' ? item.billableDays : item.usageCount
  return Math.max(1, Number(n) || 1)
}

/**
 * Saves a quotation made in POS and sends it (number assigned once, kept on later edits).
 * `incoming.id` of an existing, still editable quotation revises it in place; any other id
 * (a new or copied quotation) creates a new one. Returns the saved quotation's id.
 */
export async function addQuotation(incoming: Quotation): Promise<string> {
  const existing = loadQuotations().find((q) => q.id === incoming.id)
  const id = await saveQuotationDraft(incoming, Boolean(existing && quotationStatusView(existing.status).editable))
  await sendQuotation(id)
  await fetchQuotationsFromSupabase()
  return id
}

/** Status change from the quotations screen. CANCELLED in the app = REJECTED on the server. */
export async function updateQuotationStatus(id: string, status: QuotationStatus, remark?: string): Promise<Quotation[]> {
  const q = getQuotationById(id)
  if (!q) throw new Error('ไม่พบใบเสนอราคา')
  if (status === 'ACCEPTED') {
    if (q.status === 'DRAFT') await sendQuotation(q.id)
    await setQuotationStatus(q.id, 'ACCEPTED', remark)
  } else if (status === 'REJECTED' || status === 'CANCELLED') {
    await setQuotationStatus(q.id, 'REJECTED', remark)
  }
  return fetchQuotationsFromSupabase()
}

export interface QuotationToPosValues {
  discount: number
  shippingFee: number
  depositAmount: number
  vatEnabled: boolean
  shippingAddress: string
  rentalStartDate: string
  rentalEndDate: string
  documentDate: string
}

export interface QuotationToPosResult {
  quotationId: string
  quotationNo: string
  customer: Customer
  cartItems: CartItem[]
  values: QuotationToPosValues
}

/**
 * Shared helper: Maps Quotation domain model into POS runtime state (Customer, CartItems, and financial values).
 * Used identically in runtime POS (/pos?quotationId=...) and test suites to prevent drift.
 */
export function mapQuotationToPos(
  quote: Quotation,
  products: Product[] = [],
  customers: Customer[] = []
): QuotationToPosResult {
  // 1. Set customer
  const matchedCustomer = customers.find((c) => c.id === quote.customerId)
  const customer: Customer = matchedCustomer || {
    id: quote.customerId,
    customerName: quote.customerName,
    phone: quote.phone || (quote as Quotation & { customerPhone?: string }).customerPhone || '',
    address: quote.customerAddress || '',
    taxId: quote.customerTaxId,
  }

  // 2. Set cart items from quote.items
  const cartItems: CartItem[] = quote.items.map((qItem, idx) => {
    const matchedProd = products.find((p) => p.id === qItem.productId)
    if (!matchedProd || matchedProd.status !== 'ACTIVE') {
      throw new Error(`ไม่พบสินค้า "${qItem.productName}" ที่เปิดใช้งานในระบบ กรุณาตรวจสอบใบเสนอราคาก่อนแปลงเป็นบิล`)
    }
    const isSale = qItem.rentalType === 'SALE'
    try {
      validateProductMode(matchedProd, isSale ? 'SALE' : 'RENT')
    } catch (error) {
      throw new Error(`${qItem.productName}: ${error instanceof Error ? error.message : 'ประเภทสินค้าไม่ถูกต้อง'}`)
    }
    const baseProduct: Product = {
      ...matchedProd,
      normalPrice: qItem.unitPrice,
      dailyPrice: qItem.unitPrice,
      rentPrice: isSale ? matchedProd.rentPrice : qItem.unitPrice,
      salePrice: isSale ? qItem.unitPrice : matchedProd.salePrice,
    }

    return {
      id: qItem.id || `cart-${Date.now()}-${idx}`,
      product: baseProduct,
      productId: qItem.productId,
      productName: qItem.productName,
      itemType: isSale ? 'SALE' : 'RENT',
      unitName: qItem.unitName || matchedProd.unit || 'ชิ้น',
      calculationType: matchedProd.calculationType,
      calculationLabel: matchedProd.calculationLabel,
      rentalType: qItem.rentalType,
      quantity: qItem.quantity,
      unitPrice: qItem.unitPrice,
      // baseProduct carries the quoted price, so keep the product's own price to detect the override
      listUnitPrice: cartLineListPrice({ product: matchedProd, rentalType: qItem.rentalType, itemType: isSale ? 'SALE' : 'RENT' }),
      usageCount: qItem.usageCountOrDays || 1,
      billableDays: qItem.usageCountOrDays || 1,
      dailyStartDate: qItem.dailyStartDate,
      dailyEndDate: qItem.dailyEndDate,
      // The saved line total is already net of its share of the quotation discount, and the same
      // discount comes back as the bill discount below — so the cart line carries the gross amount.
      lineTotal: Math.round(qItem.unitPrice * qItem.quantity * (isSale ? 1 : Math.max(1, qItem.usageCountOrDays || 1)) * 100) / 100,
    }
  })

  // 3. Set financial & dates
  const values: QuotationToPosValues = {
    discount: quote.discountAmount,
    shippingFee: quote.shippingFee,
    depositAmount: quote.depositAmount,
    vatEnabled: quote.vatEnabled ?? quote.taxAmount > 0,
    shippingAddress: quote.siteName || quote.customerAddress || '',
    rentalStartDate: quote.rentalStartDate,
    rentalEndDate: quote.rentalEndDate,
    documentDate: quote.quotationDate,
  }

  return { quotationId: quote.id, quotationNo: quote.quotationNo, customer, cartItems, values }
}

export interface ConfirmQuotationResult {
  quotation: Quotation
  reservations: unknown[]
  backorders: unknown[]
  correlationId: string
}

/** Customer accepted the offer (no stock is reserved — stock moves only with a confirmed bill). */
export async function confirmQuotationWorkflow(
  quotationId: string,
  _actor?: { userId: string; displayName: string }
): Promise<ConfirmQuotationResult> {
  const list = await updateQuotationStatus(quotationId, 'ACCEPTED')
  const quotation = list.find((q) => q.id === quotationId || q.quotationNo === quotationId)
  if (!quotation) throw new Error('ไม่พบใบเสนอราคา')
  return { quotation, reservations: [], backorders: [], correlationId: '' }
}

/** Customer declined / the shop withdrew the offer. */
export async function cancelQuotationWorkflow(
  quotationId: string,
  reason: string,
  _actor?: { userId: string; displayName: string }
): Promise<Quotation[]> {
  return updateQuotationStatus(quotationId, 'REJECTED', reason)
}
