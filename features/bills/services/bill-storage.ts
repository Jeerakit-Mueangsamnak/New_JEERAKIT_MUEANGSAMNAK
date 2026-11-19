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
  fetchBillsByQuery,
  fetchBillIdsForProduct,
  countBillsWithStatus,
  FINISHED_BILL_STATUSES,
  type BillQuery,
} from '@/features/bills/api/bill-repository'

/**
 * Only bills still in work are kept loaded (bounded: drafts, confirmed, active). Finished bills
 * (closed / cancelled / void) grow forever, so they are read on demand — for a period, a customer,
 * a product or an id — and kept here until the next sign-in. Owner 2026-11-11.
 */
let _openBills: FullBill[] = []
const _historyBills = new Map<string, FullBill>()

const isFinished = (bill: FullBill): boolean => (FINISHED_BILL_STATUSES as readonly string[]).includes(bill.serverStatus ?? bill.rentalStatus)

/** Replaces the open bills (tests and sign-out); finished bills in the list go to the history set. */
export function setCachedBills(bills: FullBill[]): void {
  _historyBills.clear()
  _lastAt = 0 // set from outside (sign-out clear, tests): the next page open reads the server
  _openBills = bills.filter((b) => !isFinished(b))
  for (const b of bills) if (isFinished(b)) _historyBills.set(b.id, b)
}

/** Puts freshly read bills into the right set, replacing older copies. */
function mergeBills(bills: FullBill[]): void {
  for (const bill of bills) {
    if (isFinished(bill)) {
      _openBills = _openBills.filter((b) => b.id !== bill.id)
      _historyBills.set(bill.id, bill)
    } else {
      _historyBills.delete(bill.id)
      const at = _openBills.findIndex((b) => b.id === bill.id)
      if (at >= 0) _openBills = _openBills.map((b, i) => (i === at ? bill : b))
      else _openBills = [bill, ..._openBills]
    }
  }
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
    isChargeable: item.isChargeable ?? true,
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
    // The deposit agreed on the bill (received + not received yet)
    depositAmount: (full.heldDepositAmount ?? full.paidDepositAmount ?? 0) + (full.depositOutstanding ?? 0),
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

/** Open bills first (newest first), then the finished bills read so far. */
export function loadBills(): FullBill[] {
  return [..._openBills, ..._historyBills.values()]
}
export function loadBillById(id: string): FullBill | undefined {
  return loadBills().find((b) => b.id === id)
}

export function loadRentalBills(): RentalBill[] {
  return loadBills().map(fullBillToRentalBill)
}

// ─── Reload from the database ───────────────────────────────────────────────

/** Reloads the bills still in work; finished bills read earlier stay. */
/** A page opening within this long of the last read reuses the cache (pass force after a change). */
export const BILLS_TTL_MS = 60_000
let _lastAt = 0

/** True when the bills in work were read from the server within the last `ms`. */
export function billsReadWithin(ms: number, now = Date.now()): boolean {
  return _lastAt > 0 && now - _lastAt < ms
}

export async function fetchBillsFromSupabase(force = false): Promise<FullBill[]> {
  if (!force && _lastAt > 0 && Date.now() - _lastAt < BILLS_TTL_MS) return _openBills
  const bills = await fetchBillsFromRepository()
  _openBills = bills
  _lastAt = Date.now()
  for (const b of bills) _historyBills.delete(b.id)
  notifyBillsChanged()
  return bills
}

/** Reload after a command (bill-service.ts): always reads the server. */
export const refreshBillsCache = (): Promise<FullBill[]> => fetchBillsFromSupabase(true)

export async function fetchBillByIdFromSupabase(id: string): Promise<FullBill | null> {
  const bill = await fetchBillByIdFromRepository(id)
  if (!bill) return null
  mergeBills([bill])
  notifyBillsChanged()
  return bill
}

/** Finished bills (closed / cancelled / void) of a period, newest first; search = bill no / customer name / phone. */
export async function fetchClosedBills(query: Pick<BillQuery, 'from' | 'to' | 'search'>): Promise<FullBill[]> {
  const bills = await fetchBillsByQuery({ ...query, scope: 'HISTORY' })
  mergeBills(bills)
  notifyBillsChanged()
  return bills
}

/** Every bill of one customer, open or finished, newest first. */
export async function fetchBillsForCustomer(customerId: string): Promise<FullBill[]> {
  const bills = await fetchBillsByQuery({ customerId })
  mergeBills(bills)
  notifyBillsChanged()
  return bills
}

/** Every bill with a line of this product, open or finished, newest first. */
export async function fetchBillsForProduct(productId: string): Promise<FullBill[]> {
  const ids = await fetchBillIdsForProduct(productId)
  if (ids.length === 0) return []
  const bills = await fetchBillsByQuery({ ids })
  mergeBills(bills)
  notifyBillsChanged()
  return bills
}

/** Number of closed bills (all time), for the summary card. */
export function countClosedBills(): Promise<number> {
  return countBillsWithStatus(['CLOSED'])
}

/** Number of cancelled + void bills (all time), for the dashboard status bar. */
export function countCancelledBills(): Promise<number> {
  return countBillsWithStatus(['CANCELLED', 'VOID'])
}

/** A DRAFT (no number, no stock, no money) can be deleted for real (bill_draft_delete). */
export function canHardDeleteBill(bill: FullBill | RentalBill): boolean {
  return bill.rentalStatus === 'DRAFT' && (bill.paidAmount || 0) <= 0
}
