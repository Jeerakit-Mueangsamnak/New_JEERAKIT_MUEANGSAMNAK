import type { FullBill } from '@/lib/types/rental-return'
import type { SavedReturn } from '@/features/bills/api/bill-repository'
import type { ReturnFormData } from '@/features/documents/utils/transaction-print'

const round2 = (n: number) => Math.round(n * 100) / 100
const dayOf = (iso: string) => (iso || '').slice(0, 10)

/**
 * A saved return, printed again on the shop's ใบรับคืนบางส่วน form (bill documents tab).
 * Rows = what came back in that return (ปกติ / ชำรุด) with the damage fee of the cases it opened.
 * Money = the bill as it stands today (real figures, nothing guessed): rent, damage + lost fees,
 * paid so far (deposit taken counts as paid), nothing collected now.
 */
export function savedReturnFormData(bill: FullBill, saved: SavedReturn, caseReturnLine: Record<string, string>): ReturnFormData {
  const confirmed = (bill.charges || []).filter((c) => c.status === 'CONFIRMED' && c.amount > 0)
  const lineOfCase = (caseId?: string) => (caseId ? caseReturnLine[caseId] : undefined)

  const rows = new Map<string, { returned: number; normal: number; damaged: number; fee: number }>()
  for (const l of saved.lines) {
    const row = rows.get(l.billLineId) ?? { returned: 0, normal: 0, damaged: 0, fee: 0 }
    row.returned += l.quantity
    if (l.condition === 'NORMAL') row.normal += l.quantity
    else row.damaged += l.quantity
    row.fee += confirmed
      .filter((c) => c.chargeType === 'DAMAGE' && lineOfCase(c.incidentCaseId) === l.id)
      .reduce((sum, c) => sum + c.amount, 0)
    rows.set(l.billLineId, row)
  }

  const damageFee = round2(confirmed.filter((c) => c.chargeType === 'DAMAGE' || c.chargeType === 'LOST').reduce((s, c) => s + c.amount, 0))
  return {
    slipNo: saved.returnNo,
    returnDate: dayOf(saved.returnedAt),
    rentalStartDate: bill.rentalStartDate,
    scheduledReturnDate: bill.scheduledReturnDate,
    siteName: bill.siteName,
    customerName: bill.customerName,
    customerPhone: bill.customerPhone,
    customerAddress: bill.customerAddress,
    items: [...rows.entries()].map(([lineId, r]) => ({
      name: bill.items.find((i) => i.rentalBillItemId === lineId)?.productName || '-',
      returnedQty: r.returned,
      normalQty: r.normal,
      damagedQty: r.damaged,
      lostQty: 0,
      damageFee: round2(r.fee),
    })),
    rentFee: round2(bill.grandTotal - damageFee),
    damageFee,
    paidBefore: round2(bill.paidAmount),
    depositApplied: 0,
    collected: 0,
  }
}
