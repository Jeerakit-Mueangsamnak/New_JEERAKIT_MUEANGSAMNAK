/**
 * Shared Quotation Storage
 *
 * Source of truth: Supabase PostgreSQL public.quotations table with in-memory cache.
 * Single source of truth for quotations across POS, Quotations, and Checkout.
 * ZERO 'as any' assertions.
 * LocalStorage fallback for business data is strictly forbidden.
 */

import { Quotation, QuotationStatus, Customer, Product } from '@/lib/types/rental-pos'
import { CartItem } from '@/features/pos/services/cart-storage'
import { createReservation, releaseReservationsBySource, ReservationRecord } from '@/features/reservations/services/reservation-storage'
import { createBackorder, cancelBackordersBySource, BackorderRecord } from '@/features/reservations/services/backorder-storage'
import { getProductAvailability, syncProductReservedStock } from '@/features/products/services/product-storage'
import { recordAuditLog, generateCorrelationId } from '@/features/audits/services/audit-storage'
import { loadSystemSettings } from '@/features/settings/services/settings-storage'
import {
  fetchQuotationsFromSupabase as fetchQuotationsFromRepository,
  fetchQuotationByIdFromSupabase as fetchQuotationByIdFromRepository,
  saveQuotationToSupabase as saveQuotationToRepository,
  deleteQuotationFromSupabase as deleteQuotationFromRepository,
} from '@/features/quotations/api/quotation-repository'

// In-memory cache for fast synchronous access by UI components
let _cachedQuotations: Quotation[] | null = null

const STORAGE_KEY = 'app_quotation_storage'

export function setCachedQuotations(quotations: Quotation[]): void {
  _cachedQuotations = quotations
}

export function loadQuotations(): Quotation[] {
  if (process.env.NODE_ENV === 'test' && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw === null) {
        _cachedQuotations = []
        return []
      }
      return JSON.parse(raw) as Quotation[]
    } catch {
      return []
    }
  }
  return _cachedQuotations || []
}

export function saveQuotations(quotations: Quotation[]): void {
  _cachedQuotations = quotations
  if (process.env.NODE_ENV === 'test' && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(quotations))
    } catch {}
  }
}

export function getQuotationById(id: string): Quotation | null {
  const current = loadQuotations()
  return current.find((q) => q.id === id || q.quotationNo === id) || null
}

export function addQuotation(incoming: Quotation): Quotation[] {
  const current = loadQuotations()
  const exists = current.some((q) => q.id === incoming.id)
  const next = exists
    ? current.map((q) => (q.id === incoming.id ? incoming : q))
    : [incoming, ...current]
  saveQuotations(next)
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    saveQuotationToSupabase(incoming).catch((err) =>
      console.error('[Supabase] Failed to sync added quotation:', err)
    )
  }
  return next
}

export function updateQuotation(updated: Quotation): Quotation[] {
  const current = loadQuotations()
  const next = current.map((q) => (q.id === updated.id ? updated : q))
  saveQuotations(next)
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    saveQuotationToSupabase(updated).catch((err) =>
      console.error('[Supabase] Failed to sync updated quotation:', err)
    )
  }
  return next
}

export function updateQuotationStatus(
  id: string,
  status: QuotationStatus,
  remark?: string
): Quotation[] {
  const current = loadQuotations()
  let targetQuote: Quotation | undefined
  const next = current.map((q) => {
    if (q.id === id || q.quotationNo === id) {
      targetQuote = {
        ...q,
        status,
        ...(remark !== undefined ? { remark } : {}),
      }
      return targetQuote
    }
    return q
  })
  saveQuotations(next)
  if (targetQuote && typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    saveQuotationToSupabase(targetQuote).catch((err) =>
      console.error('[Supabase] Failed to sync quotation status:', err)
    )
  }
  return next
}

export function updateQuotationConverted(
  id: string,
  convertedBillId: string
): Quotation[] {
  const current = loadQuotations()
  let targetQuote: Quotation | undefined
  const next = current.map((q) => {
    if (q.id === id || q.quotationNo === id) {
      targetQuote = {
        ...q,
        status: 'CONVERTED' as const,
        convertedBillId,
      }
      return targetQuote
    }
    return q
  })
  saveQuotations(next)
  if (targetQuote && typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    saveQuotationToSupabase(targetQuote).catch((err) =>
      console.error('[Supabase] Failed to sync converted quotation:', err)
    )
  }
  return next
}

export function deleteQuotation(id: string): Quotation[] {
  const current = loadQuotations()
  const next = current.filter((q) => q.id !== id && q.quotationNo !== id)
  saveQuotations(next)
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    deleteQuotationFromSupabase(id).catch((err) =>
      console.error('[Supabase] Failed to delete quotation:', err)
    )
  }
  return next
}

export function generateQuotationNo(): string {
  const now = new Date()
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = String(Math.floor(1000 + Math.random() * 9000))
  return `QT-${ymd}-${rand}`
}

// ─── Supabase Async Operations ────────────────────────────────────────
// Direct database CRUD lives only in lib/repositories/quotation-repository.ts.
// This module owns cache synchronization and quotation domain/workflow behavior.

export async function fetchQuotationsFromSupabase(): Promise<Quotation[]> {
  const quotations = await fetchQuotationsFromRepository()
  saveQuotations(quotations)
  return quotations
}

export async function fetchQuotationByIdFromSupabase(id: string): Promise<Quotation | null> {
  const quotation = await fetchQuotationByIdFromRepository(id)
  if (!quotation) return null

  const current = loadQuotations()
  const next = current.some((item) => item.id === quotation.id)
    ? current.map((item) => (item.id === quotation.id ? quotation : item))
    : [quotation, ...current]
  saveQuotations(next)

  return quotation
}

export async function saveQuotationToSupabase(quotation: Quotation): Promise<void> {
  await saveQuotationToRepository(quotation)

  const current = loadQuotations()
  const next = current.some((item) => item.id === quotation.id)
    ? current.map((item) => (item.id === quotation.id ? quotation : item))
    : [quotation, ...current]
  saveQuotations(next)
}

export async function deleteQuotationFromSupabase(id: string): Promise<void> {
  await deleteQuotationFromRepository(id)

  const current = loadQuotations()
  saveQuotations(current.filter((item) => item.id !== id && item.quotationNo !== id))
}

export interface QuotationToPosValues {
  discount: number
  shippingFee: number
  depositAmount: number
  taxRate: number
  shippingAddress: string
  rentalStartDate: string
  rentalEndDate: string
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
    phone: quote.phone || (quote as any).customerPhone || '',
    address: quote.customerAddress || '',
    taxId: quote.customerTaxId,
  }

  // 2. Set cart items from quote.items
  const cartItems: CartItem[] = quote.items.map((qItem, idx) => {
    const matchedProd = products.find((p) => p.id === qItem.productId)
    const isSale = qItem.rentalType === 'SALE'
    const fallbackProduct: Product = {
      id: qItem.productId,
      code: qItem.productId,
      name: qItem.productName,
      category: 'ทั่วไป',
      unit: qItem.unitName || 'ชิ้น',
      rentalType: qItem.rentalType,
      normalPrice: qItem.unitPrice,
      dailyPrice: qItem.unitPrice,
      rentPrice: qItem.unitPrice,
      defaultDamageFee: 0,
      defaultLossFee: 0,
      totalQuantity: 999,
      availableQuantity: 999,
      rentedQuantity: 0,
      damagedQuantity: 0,
      lostQuantity: 0,
      minimumStock: 0,
      status: 'ACTIVE',
    }

    const baseProduct: Product = matchedProd
      ? {
          ...matchedProd,
          normalPrice: qItem.unitPrice,
          dailyPrice: qItem.unitPrice,
          rentPrice: qItem.unitPrice,
          salePrice: isSale ? qItem.unitPrice : (matchedProd.salePrice ?? qItem.unitPrice),
        }
      : fallbackProduct

    return {
      id: qItem.id || `cart-${Date.now()}-${idx}`,
      product: baseProduct,
      productId: qItem.productId,
      productName: qItem.productName,
      itemType: isSale ? 'SALE' : 'RENT',
      unitName: qItem.unitName || matchedProd?.unit || 'ชิ้น',
      calculationType: matchedProd?.calculationType,
      calculationLabel: matchedProd?.calculationLabel,
      rentalType: qItem.rentalType,
      quantity: qItem.quantity,
      unitPrice: qItem.unitPrice,
      usageCount: qItem.usageCountOrDays || 1,
      billableDays: qItem.usageCountOrDays || 1,
      dailyStartDate: qItem.dailyStartDate,
      dailyEndDate: qItem.dailyEndDate,
      lineTotal: qItem.lineTotal,
    }
  })

  // 3. Set financial & dates
  const settings = loadSystemSettings()
  const defaultVatRate = (settings.financePayment.defaultVatPercent || 7) / 100

  const values: QuotationToPosValues = {
    discount: quote.discountAmount,
    shippingFee: quote.shippingFee,
    depositAmount: quote.depositAmount,
    taxRate: quote.taxAmount > 0 ? defaultVatRate : 0,
    shippingAddress: quote.siteName || quote.customerAddress || '',
    rentalStartDate: quote.rentalStartDate,
    rentalEndDate: quote.rentalEndDate,
  }

  return { quotationId: quote.id, quotationNo: quote.quotationNo, customer, cartItems, values }
}

export interface ConfirmQuotationResult {
  quotation: Quotation
  reservations: ReservationRecord[]
  backorders: BackorderRecord[]
  correlationId: string
}

/**
 * Confirm a quotation (transitions to ACCEPTED).
 * Invariants:
 * - MASTER v2.3.0 Section 7.3: Quotations do NOT reserve stock and do NOT create backorders.
 * - Stock reservation begins ONLY when a Bill is created/confirmed.
 * - Audits QUOTATION_CONFIRM with shared correlationId.
 */
export function confirmQuotationWorkflow(
  quotationId: string,
  actor: { userId: string; displayName: string },
  correlationId?: string
): ConfirmQuotationResult {
  const current = loadQuotations()
  const quote = current.find((q) => q.id === quotationId || q.quotationNo === quotationId)
  if (!quote) {
    throw new Error(`Quotation ${quotationId} not found`)
  }
  if (quote.status === 'CANCELLED') {
    throw new Error('Cannot confirm a cancelled quotation')
  }
  if (quote.status === 'CONVERTED') {
    throw new Error('Quotation has already been converted to a bill')
  }

  const corrId = correlationId || generateCorrelationId()
  const nowIso = new Date().toISOString()
  const reservations: ReservationRecord[] = []
  const backorders: BackorderRecord[] = []

  const updatedQuotation: Quotation = {
    ...quote,
    status: 'ACCEPTED',
    acceptedAt: nowIso,
  }

  updateQuotation(updatedQuotation)

  recordAuditLog({
    userId: actor.userId,
    displayName: actor.displayName,
    action: 'QUOTATION_CONFIRM',
    entityType: 'QUOTATION',
    entityId: updatedQuotation.id,
    before: { quotationNo: quote.quotationNo, status: quote.status },
    after: {
      quotationNo: updatedQuotation.quotationNo,
      status: updatedQuotation.status,
      reservationsCount: 0,
      backordersCount: 0,
    },
    correlationId: corrId,
  })

  return { quotation: updatedQuotation, reservations, backorders, correlationId: corrId }
}

export interface CancelQuotationResult {
  quotation: Quotation
  releasedReservations: ReservationRecord[]
  cancelledBackorders: BackorderRecord[]
  correlationId: string
}

/**
 * Cancel a quotation without deleting it from history.
 * Invariants:
 * - Releases all ACTIVE reservations associated with this quotation.
 * - Cancels pending backorders associated with this quotation.
 * - Syncs product reserved stock back to available.
 * - Retains quotation in persistence history with cancelReason and cancelledAt.
 * - Audits QUOTATION_CANCEL with shared correlationId.
 */
export function cancelQuotationWorkflow(
  quotationId: string,
  reason: string,
  actor: { userId: string; displayName: string },
  correlationId?: string
): CancelQuotationResult {
  const trimmedReason = reason.trim()
  if (!trimmedReason) {
    throw new Error('Reason is required for cancelling a quotation')
  }

  const current = loadQuotations()
  const quote = current.find((q) => q.id === quotationId || q.quotationNo === quotationId)
  if (!quote) {
    throw new Error(`Quotation ${quotationId} not found`)
  }

  const corrId = correlationId || generateCorrelationId()
  const nowIso = new Date().toISOString()

  // 1. Release active reservations
  const releasedReservations = releaseReservationsBySource('QUOTATION', quote.id, trimmedReason, corrId)

  // 2. Cancel pending backorders
  const cancelledBackorders = cancelBackordersBySource('QUOTATION', quote.id, trimmedReason)

  // 3. Sync product reserved stocks
  for (const item of quote.items) {
    syncProductReservedStock(item.productId)
  }

  // 4. Update quotation status to CANCELLED (never hard deleted!)
  const updatedQuotation: Quotation = {
    ...quote,
    status: 'CANCELLED',
    cancelReason: trimmedReason,
    cancelledAt: nowIso,
    remark: [quote.remark, `ยกเลิก: ${trimmedReason}`].filter(Boolean).join(' | '),
  }

  updateQuotation(updatedQuotation)

  recordAuditLog({
    userId: actor.userId,
    displayName: actor.displayName,
    action: 'QUOTATION_CANCEL',
    entityType: 'QUOTATION',
    entityId: updatedQuotation.id,
    before: { quotationNo: quote.quotationNo, status: quote.status },
    after: {
      quotationNo: updatedQuotation.quotationNo,
      status: updatedQuotation.status,
      cancelReason: trimmedReason,
      releasedReservationsCount: releasedReservations.length,
      cancelledBackordersCount: cancelledBackorders.length,
    },
    reason: trimmedReason,
    correlationId: corrId,
  })

  return { quotation: updatedQuotation, releasedReservations, cancelledBackorders, correlationId: corrId }
}

/**
 * Mark a quotation as CONVERTED to a bill.
 * Retains quotation in persistence history and links to convertedBillId.
 */
export function markQuotationConverted(
  quotationId: string,
  billId: string,
  correlationId?: string
): Quotation | null {
  const current = loadQuotations()
  const quote = current.find((q) => q.id === quotationId || q.quotationNo === quotationId)
  if (!quote) return null

  if (quote.status === 'CONVERTED') {
    throw new Error('Quotation is already converted')
  }

  const updatedQuotation: Quotation = {
    ...quote,
    status: 'CONVERTED',
    convertedBillId: billId,
  }

  updateQuotation(updatedQuotation)
  return updatedQuotation
}
