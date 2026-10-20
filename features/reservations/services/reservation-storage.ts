/**
 * Reserved stock, for the dashboard and reports (Master v4.3.1 §10–§11). Stock is reserved
 * by the server when a bill is confirmed (bill_confirm allocates) and released on delivery,
 * cancel or void — the browser never reserves anything. This module derives a read-only list
 * of "goods held for a confirmed bill but not yet delivered" from the bill cache.
 */
import { loadBills } from '@/features/bills/services/bill-storage'

export type ReservationStatus = 'ACTIVE' | 'DISPATCHED' | 'RELEASED' | 'EXPIRED'
export type ReservationSourceType = 'QUOTATION' | 'BILL'
export type ReservationItemType = 'RENT' | 'SALE'

export interface ReservationRecord {
  id: string
  reservationNo: string
  sourceType: ReservationSourceType
  sourceId: string
  sourceNo: string
  customerId: string
  customerName: string
  productId: string
  productCode: string
  productName: string
  itemType: ReservationItemType
  quantity: number
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  status: ReservationStatus
  createdAt: string
  updatedAt: string
}

export function loadReservations(): ReservationRecord[] {
  const out: ReservationRecord[] = []
  for (const b of loadBills()) {
    if (b.serverStatus !== 'CONFIRMED' && b.serverStatus !== 'ACTIVE') continue
    for (const it of b.items) {
      const waiting = it.remainingQty ?? 0
      if (waiting <= 0) continue
      out.push({
        id: `${b.id}:${it.rentalBillItemId}`,
        reservationNo: b.billNo,
        sourceType: 'BILL',
        sourceId: b.id,
        sourceNo: b.billNo,
        customerId: b.customerId || '',
        customerName: b.customerName,
        productId: it.productId,
        productCode: it.productCode,
        productName: it.productName,
        itemType: it.itemType === 'SALE' ? 'SALE' : 'RENT',
        quantity: waiting,
        startDate: it.rentalStartDate || b.billDate,
        endDate: it.scheduledReturnDate || b.scheduledReturnDate,
        status: 'ACTIVE',
        createdAt: b.billDate,
        updatedAt: b.billDate,
      })
    }
  }
  return out
}
