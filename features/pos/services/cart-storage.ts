/**
 * Shared POS Cart Storage
 *
 * Backed by localStorage key 'pos_active_cart'.
 * Bridges cart state from POS page to Checkout page with full fidelity.
 */

import { Customer, Product } from '@/lib/types/rental-pos'

const STORAGE_KEY = 'pos_active_cart'

export interface CartItem {
  id: string
  product: Product
  productId?: string
  productName?: string
  rentalType: 'NORMAL' | 'DAILY' | 'SALE'
  itemType?: 'RENT' | 'SALE'
  requiresReturn?: boolean
  unitName?: string
  calculationType?: string
  calculationLabel?: string
  quantity: number
  unitPrice: number
  usageCount: number
  billableDays?: number
  dailyStartDate?: string
  dailyEndDate?: string
  lineTotal: number
  /** The product's own price for this line, kept when a quotation/draft puts its agreed price on `product`.
   *  `null` = unknown (product not loaded), so checkout always sends `unitPrice`. */
  listUnitPrice?: number | null
}

export interface ActiveCartData {
  customer: Customer | null
  items: CartItem[]
  discount: number
  shippingFee: number
  depositAmount: number
  taxRate: number
  /** VAT ON/OFF chosen at the POS for this bill (transaction state, not a shop setting). */
  vatEnabled?: boolean
  shippingAddress: string
  headerRentalDate: string // ISO string or YYYY-MM-DD
  headerReturnDate: string // ISO string or YYYY-MM-DD
  documentType: string
  documentDate: string // ISO string or YYYY-MM-DD
  subtotal: number
  tax: number
  grandTotal: number
  remark?: string
  quotationId?: string
  quotationNo?: string
  draftBillId?: string
}

export function loadActiveCart(): ActiveCartData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ActiveCartData
  } catch {
    return null
  }
}

export function saveActiveCart(data: ActiveCartData): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // silently ignore quota issues
  }
}

export function clearActiveCart(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // silently ignore
  }
}

/** Explicit line mode wins; older carts fall back to rentalType/product type. */
export function isSaleCartItem(item: { itemType?: 'RENT' | 'SALE'; rentalType?: string; product?: { rentalType?: string } }): boolean {
  return item.itemType ? item.itemType === 'SALE' : (item.rentalType || item.product?.rentalType) === 'SALE'
}

/** The product's own price for a cart line (what the server's `_list_price` charges when no unit price is sent). */
export function cartLineListPrice(item: Pick<CartItem, 'product' | 'rentalType' | 'itemType' | 'listUnitPrice'>): number | null {
  if (item.listUnitPrice !== undefined) return item.listUnitPrice
  const p = item.product
  return isSaleCartItem(item)
    ? Number(p.salePrice ?? p.normalPrice ?? 0)
    : Number(p.rentPrice ?? (item.rentalType === 'DAILY' ? p.dailyPrice : p.normalPrice) ?? 0)
}

/** Unit price to send with a draft line: omitted when it equals the list price (no override PIN). */
export function cartLineUnitPriceForServer(item: Pick<CartItem, 'product' | 'rentalType' | 'itemType' | 'listUnitPrice' | 'unitPrice'>): number | undefined {
  const listPrice = cartLineListPrice(item)
  const unitPrice = Number(item.unitPrice)
  return listPrice !== null && Math.abs(unitPrice - listPrice) < 0.005 ? undefined : unitPrice
}

/** Cash taken at checkout must cover the amount recorded as paid. */
export function isCashShort(paymentMethod: string, receivedCash: number, amountDue: number): boolean {
  return paymentMethod === 'CASH' && amountDue > 0 && receivedCash + 0.005 < amountDue
}

export function validateCartCustomer(
  items: Parameters<typeof isSaleCartItem>[0][],
  customer: Pick<Customer, 'customerName' | 'phone' | 'address'> | null,
): void {
  if (!items.some((item) => !isSaleCartItem(item))) return
  if (!customer) throw new Error('บิลที่มีรายการเช่าจำเป็นต้องระบุลูกค้า')
  if (!customer.customerName?.trim() || !customer.phone?.trim() || !customer.address?.trim()) {
    throw new Error('ลูกค้าต้องมี ชื่อ, เบอร์โทร, และที่อยู่')
  }
}
