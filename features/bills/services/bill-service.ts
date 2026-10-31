/**
 * Bill commands (Master v4.3.1 §12–§21) — the only way the app changes a bill.
 * Each command is one server RPC (or a short sequence for a return with damage / lost):
 * the server checks menu, PIN, stock and money, writes the ledgers and the audit, and
 * recalculates the bill. The screen then reloads the bill from the database.
 * No approval steps, no cash sessions, no contract link, no deposit settlement (Master §4.4,
 * §6, §18, §24). Risky steps ask for the user's own PIN right when they press confirm.
 */
import { createClient } from '@/lib/supabase/client'
import { rpc, newIdempotencyKey, selectRows, isDbError } from '@/lib/db/rpc'
import { withPin, withPinIfRequired, isPinCancelled } from '@/lib/db/pin-confirm'
import { refreshBillsCache } from '@/features/bills/services/bill-storage'
import { syncProductsFromSupabase } from '@/features/products/services/product-storage'
import type { FullBill } from '@/lib/types/rental-return'

// ─── inputs ──────────────────────────────────────────────────────────────────

export interface BillLineInput {
  productId: string
  mode: 'SALE' | 'RENTAL'
  quantity: number
  /** Omit to use the list price; a different price is a price override (PIN + reason). */
  unitPrice?: number
  /** PER_DAY = รายวัน (dates are the billed days), PER_PERIOD = ต่อรอบ (dates are reminders only). */
  calc?: 'PER_DAY' | 'PER_PERIOD'
  /** Days (PER_DAY) or rounds (PER_PERIOD). */
  periods?: number
  startAt?: string
  endAt?: string
  lineDiscountType?: 'FIXED' | 'PERCENT'
  lineDiscountValue?: number
}

export interface BillDraftInput {
  billId?: string | null
  customerId?: string | null
  quotationId?: string | null
  /** VAT ON/OFF of this bill (POS); the server snapshots it with the shop's rate and mode. */
  vatEnabled?: boolean
  note?: string
  /** Bill-level discount in baht (ลดแล้วก็ลดไป). */
  discountAmount?: number
  deliveryFee?: number
  /** Deposit of this rental bill — shown at return, never deducted/refunded by the system. */
  depositAmount?: number
  depositNote?: string
  isCreditBill?: boolean
  dueDate?: string | null
  lines: BillLineInput[]
}

export interface TenderInput {
  method: string
  amount: number
  reference?: string
}

export interface PaymentReceiveResult {
  bill: FullBill | null
  receiptNo: string | null
  totalAmount: number | null
}

/** App payment channels → server tender methods. */
export function toServerMethod(method: string): 'CASH' | 'TRANSFER' | 'CARD' | 'QR' | 'OTHER' {
  const m = (method || '').toUpperCase()
  if (m === 'CASH') return 'CASH'
  if (m === 'TRANSFER' || m === 'BANK_TRANSFER') return 'TRANSFER'
  if (m === 'QR' || m === 'PROMPTPAY') return 'QR'
  if (m === 'CARD' || m === 'CREDIT_CARD') return 'CARD'
  return 'OTHER'
}

function tendersPayload(tenders: TenderInput[]) {
  return tenders
    .filter((t) => Number(t.amount) > 0)
    .map((t) => ({ method: toServerMethod(t.method), amount: Math.round(Number(t.amount) * 100) / 100, reference: t.reference || null }))
}

/** A calendar day picked in the UI → a timestamp (today = now; another day = noon local time). */
export function dayToTimestamp(day?: string | null): string | undefined {
  if (!day) return undefined
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  if (day.slice(0, 10) === iso) return new Date().toISOString()
  return new Date(`${day.slice(0, 10)}T12:00:00`).toISOString()
}

function linePayload(l: BillLineInput) {
  const base: Record<string, unknown> = {
    product_id: l.productId,
    line_mode: l.mode,
    ordered_qty: l.quantity,
    unit_price: l.unitPrice,
    line_discount_type: l.lineDiscountType && Number(l.lineDiscountValue) > 0 ? l.lineDiscountType : null,
    line_discount_value: Number(l.lineDiscountValue) || 0,
  }
  if (l.mode === 'RENTAL') {
    base.rental_calculation_type = l.calc ?? 'PER_PERIOD'
    base.period_count = Math.max(1, Number(l.periods) || 1)
    base.rental_start_at = l.startAt
    base.rental_end_at = l.endAt
  }
  return base
}

// ─── draft / confirm ─────────────────────────────────────────────────────────

/** Saves (creates or replaces) a DRAFT bill; returns its id. Price/discount overrides ask PIN + reason. */
export async function saveBillDraft(input: BillDraftInput): Promise<string> {
  const data: Record<string, unknown> = {
    customer_id: input.customerId || null,
    quotation_id: input.quotationId || null,
    vat_enabled: input.vatEnabled === true,
    note: input.note || null,
    bill_discount_type: Number(input.discountAmount) > 0 ? 'FIXED' : null,
    bill_discount_value: Number(input.discountAmount) || 0,
    delivery_fee: Number(input.deliveryFee) || 0,
    deposit_amount: Number(input.depositAmount) || 0,
    deposit_note: input.depositNote || null,
    is_credit_bill: Boolean(input.isCreditBill),
    due_date: input.dueDate || null,
    lines: input.lines.map(linePayload),
  }
  const saved = await withPinIfRequired(
    { action: 'PRICE_OVERRIDE', title: 'ยืนยันราคา/ส่วนลดพิเศษ', detail: 'มีการแก้ราคาหรือให้ส่วนลดเกินที่ร้านตั้งไว้', askReason: true },
    (token, reason) =>
      rpc<{ id: string }>('bill_save_draft', {
        p_bill_id: input.billId || null,
        p_data: reason ? { ...data, override_reason: reason } : data,
        p_pin_token: token,
      })
  )
  return saved.id
}

/** DRAFT → CONFIRMED: bill number, stock allocation, optional payment at the counter. */
export async function confirmBill(billId: string, tenders: TenderInput[] = []): Promise<FullBill | null> {
  const payload = tendersPayload(tenders)
  await rpc('bill_confirm', {
    p_bill_id: billId,
    p_idempotency_key: newIdempotencyKey(),
    p_tenders: payload.length ? payload : null,
  })
  return refreshAfterChange(billId)
}

/** POS checkout: save the draft and confirm it (with payment) in one go. */
export async function checkoutBill(input: BillDraftInput, tenders: TenderInput[] = []): Promise<FullBill | null> {
  const id = await saveBillDraft(input)
  return confirmBill(id, tenders)
}

// ─── money ───────────────────────────────────────────────────────────────────

export async function receivePayment(
  billId: string,
  tenders: TenderInput[],
  receivedDay?: string | null
): Promise<PaymentReceiveResult> {
  const payload: Record<string, unknown> = {
    p_bill_id: billId,
    p_tenders: tendersPayload(tenders),
    p_idempotency_key: newIdempotencyKey(),
  }
  if (receivedDay) payload.p_received_on = receivedDay.slice(0, 10)
  const result = await rpc<{ receipt_no?: string | null; total_amount?: number | string | null }>('payment_receive', {
    ...payload,
  })
  const totalAmount = Number(result.total_amount)
  return {
    bill: await refreshAfterChange(billId),
    receiptNo: result.receipt_no || null,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : null,
  }
}

export async function voidPayment(billId: string, paymentId: string, reason: string): Promise<FullBill | null> {
  await withPin({ action: 'PAYMENT_VOID', title: 'ยืนยันยกเลิกรายการรับเงิน' }, (token) =>
    rpc('payment_void', { p_payment_id: paymentId, p_reason: reason, p_pin_token: token })
  )
  return refreshAfterChange(billId)
}

/** Refund always points to the payment it returns; never more than received and not yet refunded. */
export async function refundPayment(opts: {
  billId: string
  paymentId: string
  amount: number
  method?: string
  reason: string
}): Promise<FullBill | null> {
  const key = newIdempotencyKey()
  await withPin(
    { action: 'REFUND', title: 'ยืนยันคืนเงิน', detail: `${opts.amount.toLocaleString()} บาท — ${opts.reason}` },
    (token) =>
      rpc('refund_pay', {
        p_bill_id: opts.billId,
        p_amount: opts.amount,
        p_method: opts.method ? toServerMethod(opts.method) : null,
        p_reason: opts.reason,
        p_idempotency_key: key,
        p_pin_token: token,
        p_payment_id: opts.paymentId,
      })
  )
  return refreshAfterChange(opts.billId)
}

export interface RefundSuggestion {
  suggestedRefund: number
  balanceDue: number
  payments: Array<{ paymentId: string; method: string; amount: number; refundable: number }>
}

export async function getRefundSuggestion(billId: string): Promise<RefundSuggestion> {
  const r = await rpc<{
    suggested_refund: number
    balance_due: number
    payments: Array<{ payment_id: string; method: string; amount: number; refundable: number }>
  }>('bill_refund_suggestion', { p_bill_id: billId })
  return {
    suggestedRefund: Number(r.suggested_refund),
    balanceDue: Number(r.balance_due),
    payments: (r.payments || []).map((p) => ({
      paymentId: p.payment_id, method: p.method, amount: Number(p.amount), refundable: Number(p.refundable),
    })),
  }
}

// ─── goods out / back ────────────────────────────────────────────────────────

/** Partial delivery supported: each call is one delivery with its own history (Master §11.3). */
export async function deliverBill(
  billId: string,
  lines: Array<{ lineId: string; quantity: number }>,
  deliveredDay?: string | null,
  note?: string
): Promise<FullBill | null> {
  await rpc('delivery_create', {
    p_bill_id: billId,
    p_lines: lines.filter((l) => l.quantity > 0).map((l) => ({ bill_line_id: l.lineId, quantity: l.quantity })),
    p_idempotency_key: newIdempotencyKey(),
    p_delivered_at: dayToTimestamp(deliveredDay),
    p_note: note || null,
  })
  await syncProductsFromSupabase()
  return refreshAfterChange(billId)
}

export interface ReturnItemInput {
  lineId: string
  productName?: string
  normalQty: number
  damagedQty: number
  lostQty: number
  /** Prefilled from the product default; a different amount is an override (PIN). */
  damageFeePerUnit: number
  lossFeePerUnit: number
  note?: string
}

export interface ReturnResult {
  returnNo: string | null
  earlyReturnCredit: number
  suggestedRefund: number
  bill: FullBill | null
}

/**
 * รับคืน (Master §14–§15): goods back (normal / damaged) in one return; damaged goods open a
 * damage case and its fee (default × qty, editable with PIN); missing goods are recorded lost
 * (PIN) with their fee. Daily items returned early are recalculated on the days actually used
 * and any overpayment comes back as a suggested refund — the refund itself is a separate,
 * PIN-confirmed act. Nothing is deducted from the deposit.
 */
export async function processReturn(opts: {
  billId: string
  returnedDay?: string | null
  items: ReturnItemInput[]
  note?: string
}): Promise<ReturnResult> {
  const back = opts.items.filter((i) => i.normalQty + i.damagedQty > 0)
  let returnId: string | null = null
  let returnNo: string | null = null
  let credit = 0

  if (back.length > 0) {
    const lines: Array<Record<string, unknown>> = []
    for (const i of back) {
      if (i.normalQty > 0) lines.push({ bill_line_id: i.lineId, quantity: i.normalQty, condition: 'NORMAL' })
      if (i.damagedQty > 0) {
        lines.push({ bill_line_id: i.lineId, quantity: i.damagedQty, condition: 'MAJOR_DAMAGE', to_stock_state: 'DAMAGED' })
      }
    }
    const r = await rpc<{ return_id: string; return_no: string; early_return_credit: number | null }>('return_receive', {
      p_bill_id: opts.billId,
      p_lines: lines,
      p_idempotency_key: newIdempotencyKey(),
      p_returned_at: dayToTimestamp(opts.returnedDay),
      p_note: opts.note || null,
    })
    returnId = r.return_id
    returnNo = r.return_no
    credit = Number(r.early_return_credit ?? 0)
  }

  // Damage fees for the cases this return just opened.
  const damaged = back.filter((i) => i.damagedQty > 0)
  if (returnId && damaged.length > 0) {
    const supabase = createClient()
    const cases = await selectRows<{ id: string; bill_line_id: string; quantity: number }>(
      supabase
        .from('incident_cases')
        .select('id, bill_line_id, quantity, return_line_id, return_lines!inner(return_id)')
        .eq('return_lines.return_id', returnId)
        .eq('incident_type', 'DAMAGE')
    )
    for (const c of cases) {
      const item = damaged.find((i) => i.lineId === c.bill_line_id)
      if (!item) continue
      await addIncidentCharge(opts.billId, 'DAMAGE', c, item.damageFeePerUnit * Number(c.quantity), item.note || 'ค่าเสียหายตอนรับคืน', item.productName)
    }
  }

  // Missing goods → lost (PIN) → lost fee.
  for (const i of opts.items.filter((x) => x.lostQty > 0)) {
    const missing = await rpc<{ id: string }>('incident_open', {
      p_bill_line_id: i.lineId, p_type: 'MISSING', p_quantity: i.lostQty, p_reason: i.note || 'ของไม่ครบตอนรับคืน',
    })
    const lost = await withPin(
      { action: 'LOST_RECORD', title: 'ยืนยันบันทึกของสูญหาย', detail: `${i.productName ?? ''} จำนวน ${i.lostQty}` },
      (token) =>
        rpc<{ id: string; bill_line_id: string; quantity: number }>('lost_record', {
          p_missing_case_id: missing.id, p_quantity: i.lostQty, p_lost_charge_basis: 'REPLACEMENT',
          p_reason: i.note || 'ลูกค้าแจ้งของหาย', p_pin_token: token,
        })
    )
    await addIncidentCharge(opts.billId, 'LOST', lost, i.lossFeePerUnit * i.lostQty, i.note || 'ค่าของสูญหาย', i.productName)
  }

  await syncProductsFromSupabase()
  const bill = await refreshAfterChange(opts.billId)
  return {
    returnNo,
    earlyReturnCredit: credit,
    suggestedRefund: bill?.refundDue ?? 0,
    bill,
  }
}

/** Fee for a damage / lost case: the server suggests default × qty; any other amount asks PIN. */
async function addIncidentCharge(
  billId: string,
  type: 'DAMAGE' | 'LOST',
  incident: { id: string; bill_line_id: string },
  amount: number,
  reason: string,
  productName?: string
): Promise<void> {
  const rounded = Math.round(amount * 100) / 100
  const resolve = (token?: string) =>
    rpc('incident_resolve', { p_case_id: incident.id, p_reason: reason, p_reject: false, p_pin_token: token })
  if (rounded <= 0) {
    // No fee: closing the case is a waiver when the product has a default fee → PIN.
    await withPinIfRequired(
      { action: 'CHARGE_AMOUNT_OVERRIDE', title: 'ยืนยันไม่คิดค่าเสียหาย/ค่าสูญหาย', detail: productName ?? '' },
      resolve
    )
    return
  }
  const charge = await withPinIfRequired(
    {
      action: 'CHARGE_AMOUNT_OVERRIDE',
      title: type === 'DAMAGE' ? 'ยืนยันค่าเสียหายที่ต่างจากค่าตั้งต้น' : 'ยืนยันค่าสูญหายที่ต่างจากค่าตั้งต้น',
      detail: `${productName ?? ''} ${rounded.toLocaleString()} บาท`,
    },
    (token) =>
      rpc<{ id: string }>('charge_create', {
        p_bill_id: billId, p_charge_type: type, p_amount: rounded, p_reason: reason,
        p_bill_line_id: incident.bill_line_id, p_incident_case_id: incident.id, p_pin_token: token,
      })
  )
  await rpc('charge_confirm', { p_charge_id: charge.id })
  // The confirmed fee settles the case (an open case keeps the bill from closing).
  await resolve()
}

// ─── cancel / void / correct / continue ─────────────────────────────────────

/** DRAFT: cancel freely. CONFIRMED (nothing paid/delivered): cancel with PIN. */
export async function cancelBill(billId: string, reason: string): Promise<FullBill | null> {
  await withPinIfRequired({ action: 'BILL_CANCEL', title: 'ยืนยันยกเลิกบิล' }, (token) =>
    rpc('bill_cancel', { p_bill_id: billId, p_reason: reason, p_pin_token: token })
  )
  await syncProductsFromSupabase()
  return refreshAfterChange(billId)
}

/** Void a confirmed bill (PIN); goods must be back first; money already received is refunded separately. */
export async function voidBill(billId: string, reason: string): Promise<FullBill | null> {
  await withPin({ action: 'BILL_VOID', title: 'ยืนยัน Void บิล', detail: reason }, (token) =>
    rpc('bill_void', { p_bill_id: billId, p_reason: reason, p_pin_token: token })
  )
  await syncProductsFromSupabase()
  return refreshAfterChange(billId)
}

/**
 * "ยกเลิกบิล" button: a draft or an untouched confirmed bill is cancelled; once money or goods
 * moved, the bill is voided instead (PIN). Money received is refunded as its own act.
 */
export async function cancelOrVoidBill(bill: Pick<FullBill, 'id' | 'serverStatus'>, reason: string): Promise<FullBill | null> {
  if (bill.serverStatus === 'DRAFT' || bill.serverStatus === 'CONFIRMED') {
    try {
      return await cancelBill(bill.id, reason)
    } catch (err) {
      // Only the server's "cannot cancel, void instead" answers move on to Void. A cancelled PIN
      // (or any other error) ends here — its Thai text must never be read as a reason to void.
      if (isPinCancelled(err)) throw err
      if (!isDbError(err, 'BILL_HAS_TRANSACTIONS') && !isDbError(err, 'BILL_NOT_CANCELLABLE')) throw err
    }
  }
  return voidBill(bill.id, reason)
}

/** Fix wrongly recorded info on a confirmed bill (note, due date, deposit) — PIN + reason. */
export async function correctBill(
  billId: string,
  data: { note?: string | null; dueDate?: string | null; depositAmount?: number; depositNote?: string | null },
  reason: string
): Promise<FullBill | null> {
  const patch: Record<string, unknown> = {}
  if (data.note !== undefined) patch.note = data.note
  if (data.dueDate !== undefined) patch.due_date = data.dueDate
  if (data.depositAmount !== undefined) patch.deposit_amount = data.depositAmount
  if (data.depositNote !== undefined) patch.deposit_note = data.depositNote
  await withPin({ action: 'BILL_CORRECT', title: 'ยืนยันแก้ไขข้อมูลบิล', detail: reason }, (token) =>
    rpc('bill_correct', { p_bill_id: billId, p_data: patch, p_reason: reason, p_pin_token: token })
  )
  return refreshAfterChange(billId)
}

/**
 * Money correction on a confirmed bill (Master §20): a CREDIT (less) or DEBIT (more)
 * adjustment — a compensating entry; the original lines stay as they were. PIN + reason.
 */
export async function adjustBill(billId: string, delta: number, reason: string): Promise<FullBill | null> {
  const amount = Math.round(Math.abs(delta) * 100) / 100
  if (amount <= 0) return refreshAfterChange(billId)
  const key = newIdempotencyKey()
  await withPin(
    { action: 'BILL_ADJUST', title: delta < 0 ? 'ยืนยันลดยอดบิล' : 'ยืนยันเพิ่มยอดบิล', detail: `${amount.toLocaleString()} บาท — ${reason}` },
    (token) =>
      rpc('bill_adjust', {
        p_bill_id: billId,
        p_adjustment_type: delta < 0 ? 'CREDIT' : 'DEBIT',
        p_amount: amount,
        p_reason: reason,
        p_idempotency_key: key,
        p_pin_token: token,
      })
  )
  return refreshAfterChange(billId)
}

/** เช่าต่อ (Master §17): a child bill for goods still with the customer. */
export async function createContinuation(opts: {
  parentBillId: string
  reason: string
  startMode?: 'FROM_PREVIOUS_END' | 'FROM_APPROVAL'
  items: Array<{
    fromLineId: string
    quantity: number
    unitPrice?: number
    calc?: 'PER_DAY' | 'PER_PERIOD'
    periods?: number
    startAt?: string
    endAt?: string
  }>
}): Promise<string> {
  const key = newIdempotencyKey()
  const res = await withPinIfRequired(
    { action: 'PRICE_OVERRIDE', title: 'ยืนยันราคาเช่าต่อที่ต่างจากราคาตั้ง', askReason: true },
    (token) =>
      rpc<{ child_bill: { id: string } }>('create_rental_continuation', {
        p_parent_bill_id: opts.parentBillId,
        p_items: opts.items.map((i) => ({
          from_line_id: i.fromLineId, quantity: i.quantity, unit_price: i.unitPrice,
          rental_calculation_type: i.calc, period_count: i.periods, rental_start_at: i.startAt, rental_end_at: i.endAt,
        })),
        p_reason: opts.reason,
        p_idempotency_key: key,
        p_start_mode: opts.startMode ?? null,
        p_pin_token: token,
      })
  )
  await refreshBillsCache()
  return res.child_bill.id
}

async function refreshAfterChange(billId: string): Promise<FullBill | null> {
  // Money moves with bill commands (payment, refund, void ...): the finance statement,
  // reports and dashboard read the finance cache, so it is reloaded together with the bills.
  const [bills] = await Promise.all([refreshBillsCache(), refreshFinanceCache()])
  return bills.find((b) => b.id === billId) ?? null
}

async function refreshFinanceCache(): Promise<void> {
  try {
    const { fetchTransactionsFromSupabase } = await import('@/features/finance/services/finance-storage')
    await fetchTransactionsFromSupabase()
  } catch (err) {
    // The bill command already succeeded; a stale statement must not turn it into an error.
    console.error('Finance refresh after bill change failed:', err)
  }
}
