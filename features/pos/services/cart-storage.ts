/**
 * Shared POS Cart Storage (this device only, localStorage).
 *
 * - BILL cart ('pos_active_cart'): the POS cart. It is kept while the user moves to other menus
 *   (held cart, header icon) and carries it to the payment page; it is cleared when the bill is saved,
 *   when the user clears it, or on sign-out. Nothing is written to the database until the bill is saved.
 * - QUOTATION cart ('pos_quotation_cart'): POS quotation mode → สรุปใบเสนอราคา only, kept apart so a
 *   quotation never replaces the held bill cart.
 */

import { Customer, Product, QuotationStatus } from '@/lib/types/rental-pos'

export type CartKind = 'BILL' | 'QUOTATION'
const STORAGE_KEYS: Record<CartKind, string> = { BILL: 'pos_active_cart', QUOTATION: 'pos_quotation_cart' }
/** Fired on window whenever the BILL cart is saved or cleared (header cart icon, POS page). */
export const CART_CHANGED_EVENT = 'pos_cart_changed'

/** Contact phone the cart starts with and the issued bill prints: both of the customer's numbers when
 *  a second one is saved (cart + bill only, owner 2026-11-08; other screens keep the main number). */
export function customerContactPhones(customer?: Pick<Customer, 'phone' | 'phone2'> | null): string {
  const phones = [customer?.phone, customer?.phone2].map((p) => (p || '').trim()).filter(Boolean)
  return [...new Set(phones)].join(', ')
}

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
  /** รายการนอกร้าน (owner 2026-11-11): typed in at the counter, no shop product, no stock. */
  isCustom?: boolean
}

/** Category label of a typed-in line (รายการนอกร้าน). */
export const CUSTOM_ITEM_CATEGORY = 'รายการนอกร้าน'

/** A stand-in product for a typed-in line: carries its name, unit and price; never sent as a product. */
export function customCartProduct(name: string, unit: string, rentalType: 'NORMAL' | 'DAILY' | 'SALE', unitPrice: number): Product {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    code: '',
    name,
    category: CUSTOM_ITEM_CATEGORY,
    unit,
    rentalType,
    normalPrice: unitPrice,
    dailyPrice: unitPrice,
    rentPrice: unitPrice,
    salePrice: unitPrice,
    defaultDamageFee: 0,
    defaultLossFee: 0,
    totalQuantity: 0,
    availableQuantity: 0,
    rentedQuantity: 0,
    damagedQuantity: 0,
    lostQuantity: 0,
    minimumStock: 0,
    status: 'ACTIVE',
  }
}

/** A typed-in cart line, priced quantity × price × count (count = rounds or days; a sale counts once). */
export function customCartItem(
  data: { name: string; unit: string; quantity: number; unitPrice: number; count: number; rentalType: 'NORMAL' | 'DAILY' | 'SALE' },
  id = `cart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
): CartItem {
  const isSale = data.rentalType === 'SALE'
  const count = isSale ? 1 : Math.max(1, Math.floor(Number(data.count) || 1))
  return {
    id,
    product: customCartProduct(data.name, data.unit, data.rentalType, data.unitPrice),
    productName: data.name,
    itemType: isSale ? 'SALE' : 'RENT',
    unitName: data.unit,
    rentalType: data.rentalType,
    quantity: data.quantity,
    unitPrice: data.unitPrice,
    usageCount: data.rentalType === 'NORMAL' ? count : 1,
    billableDays: data.rentalType === 'DAILY' ? count : 1,
    lineTotal: Math.round(data.quantity * data.unitPrice * count * 100) / 100,
    requiresReturn: false,
    listUnitPrice: null,
    isCustom: true,
  }
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
  /** รวม / ไม่รวม VAT chosen on the payment page for this bill; null/absent = none chosen yet. */
  vatMode?: 'INCLUSIVE' | 'EXCLUSIVE' | null
  shippingAddress: string
  /** Contact phone of this bill (typed at the POS, kept in the bill's note). */
  contactPhone?: string
  headerRentalDate: string // ISO string or YYYY-MM-DD
  headerReturnDate: string // ISO string or YYYY-MM-DD
  documentType: string
  documentDate: string // ISO string or YYYY-MM-DD
  /** The three dates were picked in the date window (a bill needs them picked, owner 2026-11-11). */
  datesPicked?: boolean
  subtotal: number
  tax: number
  grandTotal: number
  remark?: string
  quotationId?: string
  quotationNo?: string
  draftBillId?: string
  /** This cart is a quotation being made (POS quotation mode → สรุปใบเสนอราคา), not a bill. */
  quotationMode?: boolean
  /** The quotation being revised (quotation mode only); absent for a new one or a copy. */
  quotationEdit?: { id: string; quotationNo: string; status: QuotationStatus; remark?: string }
  /** User who built the cart: another account on this device never gets it back. */
  ownerId?: string
}

function notifyCartChanged(kind: CartKind) {
  if (kind !== 'BILL') return
  try {
    window.dispatchEvent(new Event(CART_CHANGED_EVENT))
  } catch {
    // best-effort
  }
}

export function loadActiveCart(kind: CartKind = 'BILL'): ActiveCartData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[kind])
    if (!raw) return null
    return JSON.parse(raw) as ActiveCartData
  } catch {
    return null
  }
}

/** Saved under the quotation key when `data.quotationMode`, otherwise as the BILL cart. */
export function saveActiveCart(data: ActiveCartData): void {
  if (typeof window === 'undefined') return
  const kind: CartKind = data.quotationMode ? 'QUOTATION' : 'BILL'
  try {
    localStorage.setItem(STORAGE_KEYS[kind], JSON.stringify(data))
  } catch {
    // silently ignore quota issues
  }
  notifyCartChanged(kind)
}

export function clearActiveCart(kind: CartKind = 'BILL'): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEYS[kind])
  } catch {
    // silently ignore
  }
  notifyCartChanged(kind)
}

/** Sign-out: nothing of this user's carts stays on the device. */
export function clearAllCarts(): void {
  clearActiveCart('QUOTATION')
  clearActiveCart('BILL')
}

/** The BILL cart left on this device by this user (null when empty, a quotation, or someone else's). */
export function loadHeldCart(userId: string | null | undefined): ActiveCartData | null {
  const cart = loadActiveCart('BILL')
  if (!cart || cart.quotationMode || !Array.isArray(cart.items) || cart.items.length === 0) return null
  if (cart.ownerId && cart.ownerId !== userId) return null
  return cart
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
  // Only the name is required (owner 2026-11-11, same as the new-customer form): phone and address may be empty.
  if (!customer.customerName?.trim()) {
    throw new Error('ลูกค้าต้องมีชื่อ')
  }
}

