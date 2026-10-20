import { createClient } from '@/lib/supabase/client'
import { selectRows } from '@/lib/db/rpc'
import { loadSystemSettings } from '@/features/settings/services/settings-storage'
import type { FullBill, FullBillItem, BillChargeRecord, BillPaymentRecord, BillRefundRecord } from '@/lib/types/rental-return'
import type { RentalStatus } from '@/lib/types/rental-pos'

/**
 * Bill reads (Master v4.3.1 §12–§21) on the v4.3 schema: bills + bill_lines + deliveries +
 * returns + payments/receipts + refunds + charges, mapped onto the FullBill shape the screens use. Money, stock and status
 * fields are the server's numbers (cached by _bill_recalculate) — never recomputed here.
 * All writes live in features/bills/services/bill-service.ts (RPC only).
 */

interface BillRow {
  id: string
  bill_no: string | null
  status: string
  payment_status: string
  customer_id: string | null
  quotation_id: string | null
  parent_bill_id: string | null
  original_bill_id: string | null
  note: string | null
  sale_subtotal: number
  rental_subtotal: number
  bill_discount_amount: number
  taxable_amount: number
  delivery_fee: number
  installation_fee: number
  service_fee: number
  vat_amount: number
  grand_total: number
  charge_total: number
  adjustment_net: number
  paid_amount: number
  refunded_amount: number
  write_off_total: number
  balance_due: number
  deposit_amount: number
  deposit_note: string | null
  due_date: string | null
  is_credit_bill: boolean
  confirmed_at: string | null
  pricing_snapshot: { vat_mode?: string | null } | null
  closed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  voided_at: string | null
  void_reason: string | null
  created_at: string
}

interface LineRow {
  id: string
  bill_id: string
  line_no: number
  product_id: string
  line_mode: 'SALE' | 'RENTAL'
  ordered_qty: number
  unit_price: number
  line_discount_amount: number
  extended_amount: number
  rental_calculation_type: string | null
  period_count: number | null
  rental_start_at: string | null
  rental_end_at: string | null
  actual_return_at: string | null
  rental_status: string | null
  return_status: string
  fulfillment_status: string
  delivered_qty: number
  cancelled_qty: number
  physical_returned_qty: number
  approved_lost_qty: number
  carried_forward_qty: number
  /** Taken over from the parent bill by a continuation (เช่าต่อ): already with the customer, never delivered here. */
  carried_in_qty: number
  obligation_held_here: number
}

/** Quantity of a line that still waits to be handed over (carried-in goods are already out). */
const pendingDeliveryQty = (l: LineRow): number =>
  Math.max(0, Number(l.ordered_qty) - Number(l.delivered_qty) - Number(l.cancelled_qty) - Number(l.carried_in_qty ?? 0))

interface ProductLite { id: string; sku: string; name: string; default_damage_fee: number; default_loss_fee: number; unit_id: string }
interface CustomerLite { id: string; name: string; phone: string; address: string }

export const toDate = (ts: string | null | undefined): string => {
  if (!ts) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts.slice(0, 10)
  const timeZone = loadSystemSettings().timezone || 'Asia/Bangkok'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function lineStatus(l: LineRow): FullBillItem['status'] {
  if (l.line_mode === 'SALE') {
    return l.delivered_qty + l.cancelled_qty >= l.ordered_qty ? 'COMPLETED' : l.delivered_qty > 0 ? 'PARTIAL_DELIVERED' : 'PENDING'
  }
  if (l.approved_lost_qty > 0 && l.obligation_held_here === 0 && l.physical_returned_qty === 0) return 'LOST'
  if (l.return_status === 'RETURNED') return 'RETURNED'
  if (l.return_status === 'PARTIALLY_RETURNED') return 'PARTIAL_RETURNED'
  if (l.delivered_qty > 0 || Number(l.carried_in_qty ?? 0) > 0) return 'RENTING'
  return 'PENDING'
}

function deliveryOf(lines: LineRow[]): 'PENDING' | 'PARTIAL_DELIVERED' | 'DELIVERED' {
  const open = lines.filter((l) => l.ordered_qty - l.cancelled_qty > 0)
  if (open.length === 0) return 'PENDING'
  if (open.every((l) => pendingDeliveryQty(l) === 0)) return 'DELIVERED'
  return open.some((l) => l.delivered_qty > 0 || Number(l.carried_in_qty ?? 0) > 0) ? 'PARTIAL_DELIVERED' : 'PENDING'
}

/** Bill status for the screens: the server status plus where the rented goods are. */
export function rentalStatusOf(b: Pick<BillRow, 'status'>, lines: LineRow[]): RentalStatus {
  switch (b.status) {
    case 'DRAFT': return 'DRAFT'
    case 'CANCELLED': return 'CANCELLED'
    case 'VOID': return 'VOID'
    case 'CLOSED': return 'CLOSED'
    case 'CONFIRMED': return 'CONFIRMED'
  }
  const rental = lines.filter((l) => l.line_mode === 'RENTAL')
  if (rental.length === 0) return 'RENTING'
  // Confirmed and paid (ACTIVE) but nothing handed over yet: goods are only reserved, not returned.
  if (rental.every((l) => Number(l.delivered_qty) === 0 && Number(l.carried_in_qty ?? 0) === 0)) return 'CONFIRMED'
  const nothingHeldHere = rental.every((l) => Number(l.obligation_held_here) === 0)
  // Goods moved on to a continuation bill (เช่าต่อ) are still with the customer — not returned.
  if (nothingHeldHere && rental.some((l) => Number(l.carried_forward_qty ?? 0) > 0)) return 'EXTENDED'
  if (rental.every((l) => l.return_status === 'RETURNED' || l.obligation_held_here === 0)) return 'RETURNED'
  if (rental.some((l) => l.physical_returned_qty > 0)) return 'PARTIAL_RETURNED'
  return 'RENTING'
}

export function paymentStatusOf(s: string): FullBill['paymentStatus'] {
  switch (s) {
    case 'PAID': return 'PAID'
    case 'PARTIALLY_PAID': return 'PARTIAL'
    case 'PARTIALLY_REFUNDED': return 'REFUND_PARTIAL'
    case 'REFUNDED': return 'REFUNDED'
    default: return 'UNPAID'
  }
}

export function mapBill(
  b: BillRow,
  lines: LineRow[],
  ctx: {
    products: Map<string, ProductLite>
    units: Map<string, string>
    customers: Map<string, CustomerLite>
    payments: BillPaymentRecord[]
    refunds: BillRefundRecord[]
    charges: BillChargeRecord[]
  }
): FullBill {
  const customer = b.customer_id ? ctx.customers.get(b.customer_id) : undefined
  const sorted = [...lines].sort((x, y) => x.line_no - y.line_no)
  const rental = sorted.filter((l) => l.line_mode === 'RENTAL')
  const billDate = toDate(b.confirmed_at ?? b.created_at)
  const starts = rental.map((l) => l.rental_start_at).filter(Boolean) as string[]
  const ends = rental.map((l) => l.rental_end_at).filter(Boolean) as string[]
  const returnedAll = rental.length > 0 && rental.every((l) => l.obligation_held_here === 0 && l.actual_return_at)
  const actualReturns = rental.map((l) => l.actual_return_at).filter(Boolean) as string[]
  const lineDiscounts = sorted.reduce((s, l) => s + Number(l.line_discount_amount), 0)
  const delivery = deliveryOf(sorted)

  const items: FullBillItem[] = sorted.map((l) => {
    const p = ctx.products.get(l.product_id)
    const isRental = l.line_mode === 'RENTAL'
    return {
      rentalBillItemId: l.id,
      productId: l.product_id,
      productCode: p?.sku || '',
      productName: p?.name || '',
      quantity: Number(l.ordered_qty),
      orderedQty: Number(l.ordered_qty),
      deliveredQty: Number(l.delivered_qty),
      remainingQty: pendingDeliveryQty(l),
      returnedQty: Number(l.physical_returned_qty),
      outstandingQty: isRental ? Number(l.obligation_held_here) : 0,
      carriedInQty: Number(l.carried_in_qty ?? 0),
      carriedForwardQty: Number(l.carried_forward_qty ?? 0),
      lostQuantity: Number(l.approved_lost_qty),
      dailyRate: Number(l.unit_price),
      unit: (p && ctx.units.get(p.unit_id)) || '',
      defaultRepairFee: Number(p?.default_damage_fee ?? 0),
      defaultReplacementFee: Number(p?.default_loss_fee ?? 0),
      requiresReturn: isRental,
      rentalStartDate: toDate(l.rental_start_at),
      scheduledReturnDate: toDate(l.rental_end_at),
      actualReturnDate: toDate(l.actual_return_at) || undefined,
      rentalType: !isRental ? 'SALE' : l.rental_calculation_type === 'PER_DAY' ? 'DAILY' : 'NORMAL',
      itemType: isRental ? 'RENT' : 'SALE',
      usageCount: l.period_count ?? undefined,
      lineTotal: Number(l.extended_amount),
      status: lineStatus(l),
      deliveryStatus: pendingDeliveryQty(l) === 0 ? 'DELIVERED' : l.delivered_qty > 0 ? 'PARTIAL_DELIVERED' : 'PENDING',
    }
  })

  const due = Number(b.grand_total) + Number(b.charge_total) + Number(b.adjustment_net)
  const balance = Number(b.balance_due)
  return {
    id: b.id,
    customerId: b.customer_id || undefined,
    billNo: b.bill_no || `ร่าง-${b.id.slice(0, 8)}`,
    billDate,
    customerName: customer?.name || 'ลูกค้าทั่วไป',
    customerPhone: customer?.phone || '',
    customerAddress: customer?.address,
    rentalStartDate: starts.length ? toDate(starts.sort()[0]) : billDate,
    scheduledReturnDate: ends.length ? toDate(ends.sort()[ends.length - 1]) : billDate,
    actualReturnDate: returnedAll ? toDate(actualReturns.sort()[actualReturns.length - 1]) : undefined,
    // Deposit belongs to the bill and is only shown (Master §18): never applied or refunded by the system.
    heldDepositAmount: Number(b.deposit_amount),
    paidDepositAmount: Number(b.deposit_amount),
    depositApplied: 0,
    depositRefunded: 0,
    deposits: [],
    depositNote: b.deposit_note || undefined,
    subtotal: Number(b.sale_subtotal) + Number(b.rental_subtotal),
    discountAmount: Number(b.bill_discount_amount) + lineDiscounts,
    billDiscountAmount: Number(b.bill_discount_amount),
    taxableAmount: Number(b.taxable_amount),
    shippingFee: Number(b.delivery_fee) + Number(b.installation_fee) + Number(b.service_fee),
    taxAmount: Number(b.vat_amount),
    vatMode: b.pricing_snapshot?.vat_mode === 'INCLUSIVE' || b.pricing_snapshot?.vat_mode === 'EXCLUSIVE'
      ? b.pricing_snapshot.vat_mode
      : undefined,
    billAmount: Number(b.grand_total),
    grandTotal: due,
    confirmedAt: b.confirmed_at || undefined,
    paidAmount: Number(b.paid_amount) - Number(b.refunded_amount),
    receivedAmount: Number(b.paid_amount),
    refundedAmount: Number(b.refunded_amount),
    outstandingAmount: Math.max(0, balance),
    refundDue: Math.max(0, -balance),
    refundDueAmount: Math.max(0, -balance),
    chargeTotal: Number(b.charge_total),
    adjustmentNet: Number(b.adjustment_net),
    rentalStatus: rentalStatusOf(b, sorted),
    serverStatus: b.status,
    paymentStatus: paymentStatusOf(b.payment_status),
    dispatchStatus: delivery,
    deliveryStatus: delivery,
    items,
    remark: b.note || undefined,
    quotationId: b.quotation_id || undefined,
    parentBillId: b.parent_bill_id || undefined,
    originalBillId: b.original_bill_id || undefined,
    closedAt: b.closed_at || undefined,
    cancelledAt: b.cancelled_at || b.voided_at || undefined,
    cancelReason: b.cancel_reason || b.void_reason || undefined,
    dueDate: b.due_date || undefined,
    isCreditBill: b.is_credit_bill,
    payments: ctx.payments,
    refunds: ctx.refunds,
    charges: ctx.charges,
  }
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

async function loadBills(billIds?: string[]): Promise<FullBill[]> {
  const supabase = createClient()
  // Optional "only these bills" filter on any PostgREST query builder.
  const byId = (q: any, col: string): any => (billIds ? q.in(col, billIds) : q)
  const [bills, lines, payments, refunds, charges, products, units, customers] = await Promise.all([
    selectRows<BillRow>(byId(supabase.from('bills').select('*'), 'id').order('created_at', { ascending: false })),
    selectRows<LineRow>(byId(supabase.from('bill_lines').select('*'), 'bill_id')),
    selectRows<{ id: string; bill_id: string; method: string; amount: number; reference: string | null; status: string; received_at: string }>(
      byId(supabase.from('payments').select('id, bill_id, method, amount, reference, status, received_at'), 'bill_id')
    ),
    selectRows<{ id: string; bill_id: string; refund_no: string; payment_id: string; amount: number; method: string; reason: string; paid_at: string; status: string }>(
      byId(supabase.from('refunds').select('id, bill_id, refund_no, payment_id, amount, method, reason, paid_at, status'), 'bill_id')
    ),
    selectRows<{ id: string; bill_id: string; charge_type: string; amount: number; suggested_amount: number | null; status: string; reason: string; bill_line_id: string | null; incident_case_id: string | null; created_at: string }>(
      byId(supabase.from('charges').select('id, bill_id, charge_type, amount, suggested_amount, status, reason, bill_line_id, incident_case_id, created_at'), 'bill_id')
    ),
    selectRows<ProductLite>(supabase.from('products').select('id, sku, name, default_damage_fee, default_loss_fee, unit_id')),
    selectRows<{ id: string; name: string }>(supabase.from('units').select('id, name')),
    selectRows<CustomerLite>(supabase.from('customers').select('id, name, phone, address')),
  ])

  const linesByBill = groupBy(lines, (l) => l.bill_id)
  const refundsByPayment = groupBy(refunds.filter((r) => r.status === 'PAID'), (r) => r.payment_id)
  const paymentsByBill = groupBy(payments, (p) => p.bill_id)
  const refundsByBill = groupBy(refunds, (r) => r.bill_id)
  const chargesByBill = groupBy(charges, (c) => c.bill_id)
  const ctxBase = {
    products: new Map(products.map((p) => [p.id, p])),
    units: new Map(units.map((u) => [u.id, u.name])),
    customers: new Map(customers.map((c) => [c.id, c])),
  }

  return bills.map((b) =>
    mapBill(b, linesByBill.get(b.id) || [], {
      ...ctxBase,
      payments: (paymentsByBill.get(b.id) || []).map((p) => ({
        id: p.id,
        method: p.method,
        amount: Number(p.amount),
        reference: p.reference || undefined,
        status: p.status,
        receivedAt: p.received_at,
        refundedAmount: (refundsByPayment.get(p.id) || []).reduce((s, r) => s + Number(r.amount), 0),
      })),
      refunds: (refundsByBill.get(b.id) || []).map((r) => ({
        id: r.id, refundNo: r.refund_no, paymentId: r.payment_id, amount: Number(r.amount), method: r.method,
        reason: r.reason, paidAt: r.paid_at, status: r.status,
      })),
      charges: (chargesByBill.get(b.id) || []).map((c) => ({
        id: c.id, chargeType: c.charge_type, amount: Number(c.amount), suggestedAmount: c.suggested_amount ?? undefined,
        status: c.status, reason: c.reason, billLineId: c.bill_line_id || undefined,
        incidentCaseId: c.incident_case_id || undefined, createdAt: c.created_at,
      })),
    })
  )
}

export async function fetchBillsFromSupabase(): Promise<FullBill[]> {
  return loadBills()
}

export async function fetchBillByIdFromSupabase(id: string): Promise<FullBill | null> {
  const [bill] = await loadBills([id])
  return bill ?? null
}
