/**
 * Bill cache for the UI (Master v4.3.1 §12–§21).
 *
 * Supabase is the only source of truth: bills are read through features/bills/api/bill-repository.ts
 * and changed only through the RPC commands in features/bills/services/bill-service.ts, after which
 * the cache is reloaded. Nothing here writes to the database or computes money / stock.
 */

import { FullBill, FullBillItem } from '@/lib/types/rental-return'
export type { FullBill, FullBillItem }
import { RentalBill, RentalBillItem, RentalType, RentalStatus, PaymentStatus } from '@/lib/types/rental-pos'
import {
  fetchBillsFromSupabase as fetchBillsFromRepository,
  fetchBillByIdFromSupabase as fetchBillByIdFromRepository,
} from '@/features/bills/api/bill-repository'

let _cachedBills: FullBill[] | null = null

export function setCachedBills(bills: FullBill[]): void {
  _cachedBills = bills
}

function notifyBillsChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new Event('bills_updated'))
  } catch {
    // best-effort
  }
}

// ─── Adapter for screens still typed on RentalBill ──────────────────────────

export function fullBillToRentalBill(full: FullBill): RentalBill {
  const items: RentalBillItem[] = (full.items || []).map((item) => ({
    id: item.rentalBillItemId,
    productId: item.productId,
    productName: item.productName,
    rentalType: (item.rentalType || 'NORMAL') as RentalType,
    quantity: item.quantity,
    unitName: item.unit,
    unitPrice: item.dailyRate,
    usageCount: item.usageCount,
    lineTotal: item.lineTotal ?? item.quantity * item.dailyRate,
    returnedQuantity: item.returnedQty,
    damagedQuantity: 0,
    lostQuantity: 0,
    outstandingQuantity: item.outstandingQty,
    isAccessory: false,
    isChargeable: true,
    requiresReturn: item.requiresReturn,
  }))

  return {
    id: full.id,
    customerId: full.customerId || '',
    customerName: full.customerName,
    customerPhone: full.customerPhone,
    customerAddress: full.customerAddress,
    siteName: full.siteName,
    billNo: full.billNo,
    billDate: full.billDate,
    rentalStartDate: full.rentalStartDate,
    rentalEndDate: full.scheduledReturnDate || full.rentalStartDate,
    subtotal: full.subtotal ?? full.grandTotal,
    discountAmount: full.discountAmount ?? 0,
    shippingFee: full.shippingFee ?? 0,
    depositAmount: full.heldDepositAmount ?? full.paidDepositAmount ?? 0,
    taxAmount: full.taxAmount ?? 0,
    billAmount: full.billAmount ?? full.grandTotal,
    grandTotal: full.grandTotal,
    paidAmount: full.paidAmount,
    outstandingAmount: full.outstandingAmount,
    rentalStatus: full.rentalStatus as RentalStatus,
    paymentStatus: full.paymentStatus as PaymentStatus,
    remark: full.remark,
    quotationId: full.quotationId,
    quotationNo: full.quotationNo,
    reservationId: full.reservationId,
    originalBillId: full.originalBillId,
    parentBillId: full.parentBillId,
    closedAt: full.closedAt,
    cancelledAt: full.cancelledAt,
    cancelReason: full.cancelReason,
    dispatchStatus: full.dispatchStatus,
    refundDueAmount: full.refundDueAmount,
    revisions: full.revisions,
    items,
  }
}


// ─── Cache reads ─────────────────────────────────────────────────────────────

export function loadBills(): FullBill[] {
  return _cachedBills || []
}

/** Cache-only replace (tests / optimistic UI). */
export function saveBills(bills: FullBill[]): void {
  _cachedBills = bills
}

export function loadBillById(id: string): FullBill | undefined {
  return loadBills().find((b) => b.id === id)
}

export function loadRentalBills(): RentalBill[] {
  return loadBills().map(fullBillToRentalBill)
}

// ─── Reload from the database ───────────────────────────────────────────────

export async function fetchBillsFromSupabase(): Promise<FullBill[]> {
  const bills = await fetchBillsFromRepository()
  _cachedBills = bills
  notifyBillsChanged()
  return bills
}

/** Reload after a command (bill-service.ts). */
export const refreshBillsCache = fetchBillsFromSupabase

export async function fetchBillByIdFromSupabase(id: string): Promise<FullBill | null> {
  const bill = await fetchBillByIdFromRepository(id)
  if (!bill) return null
  const current = loadBills()
  _cachedBills = current.some((b) => b.id === bill.id) ? current.map((b) => (b.id === bill.id ? bill : b)) : [bill, ...current]
  notifyBillsChanged()
  return bill
}

/** Only an unpaid DRAFT can be removed — and even then it is cancelled, not deleted (history). */
export function canHardDeleteBill(bill: FullBill | RentalBill): boolean {
  return bill.rentalStatus === 'DRAFT' && (bill.paidAmount || 0) <= 0
}
