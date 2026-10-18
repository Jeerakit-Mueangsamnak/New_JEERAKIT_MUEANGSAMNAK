import type { FullBill, FullBillItem } from '@/lib/types/rental-return'

export function getBillItemAmounts(bill: FullBill): Array<{ item: FullBillItem; amount: number }> {
  const lines = bill.items.map((item) => ({
    item,
    baseCents: Math.max(0, Math.round((Number(item.lineTotal ?? item.quantity * item.dailyRate) || 0) * 100)),
  }))
  const totalCents = lines.reduce((sum, line) => sum + line.baseCents, 0)
  const discountCents = Math.min(
    totalCents,
    Math.max(0, Math.round((Number(bill.billDiscountAmount) || 0) * 100))
  )
  const vat = Math.max(0, Number(bill.taxAmount) || 0)
  const taxable = Math.max(0, Number(bill.taxableAmount) || 0)
  const vatExclusiveRatio = bill.vatMode === 'INCLUSIVE' && taxable + vat > 0
    ? taxable / (taxable + vat)
    : 1
  let allocatedCents = 0
  const lastPricedLine = lines.findLastIndex((line) => line.baseCents > 0)

  return lines.map((line, index) => {
    if (line.baseCents === 0 || totalCents === 0) return { item: line.item, amount: 0 }
    const lineDiscountCents = index === lastPricedLine
      ? discountCents - allocatedCents
      : Math.floor(discountCents * line.baseCents / totalCents)
    allocatedCents += lineDiscountCents
    const afterDiscount = Math.max(0, line.baseCents - lineDiscountCents) / 100
    return {
      item: line.item,
      amount: Math.round(afterDiscount * vatExclusiveRatio * 100) / 100,
    }
  })
}

export function getBillRevenueAmount(bill: FullBill): number {
  if (typeof bill.taxableAmount === 'number' && Number.isFinite(bill.taxableAmount)) {
    return bill.taxableAmount
  }
  return Math.max(0, (Number(bill.grandTotal) || 0) - (Number(bill.taxAmount) || 0))
}
