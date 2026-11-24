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
import { fetchBillByIdFromSupabase, refreshBillsCache } from '@/features/bills/services/bill-storage'
import { syncStockFromSupabase } from '@/features/products/services/product-storage'
import { activePaymentAccount, loadSystemSettings } from '@/features/settings/services/settings-storage'
import type { FullBill } from '@/lib/types/rental-return'

// ─── inputs ──────────────────────────────────────────────────────────────────

export interface BillLineInput {
  /** null = รายการนอกร้าน: sent with its own name and unit, no product, no stock. */
  productId: string | null
  productName?: string
  unitName?: string
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
  customerId?: string | null
  /** A typed customer name with no customer record (POS ลูกค้าทั่วไป, owner 2026-11-16); ignored when customerId is set. */
  guestName?: string | null
  quotationId?: string | null
  /** VAT ON/OFF of this bill (POS); the server snapshots it with the shop's rate and mode. */
  vatEnabled?: boolean
  /** How this bill's VAT is priced (POS button รวม / ไม่รวม VAT); only sent while VAT is on. */
  vatMode?: 'INCLUSIVE' | 'EXCLUSIVE' | null
  note?: string
  /** Bill-level discount in baht (ลดแล้วก็ลดไป). */
  discountAmount?: number
  deliveryFee?: number
  /** Deposit of this rental bill — shown at return, never deducted/refunded by the system. */
  depositAmount?: number
  depositNote?: string
  isCreditBill?: boolean
  dueDate?: string | null
  /** วันที่ออกเอกสาร (YYYY-MM-DD) picked at the POS; kept on the bill after it is saved. */
  documentDate?: string | null
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

/**
 * Transfer / QR money goes into the account in use in Settings (owner 2026-11-13); each such tender carries that
 * account, and the server keeps the tenders as sent on the payment's record (bill_payment_allocations.tenders).
 */
function tendersPayload(tenders: TenderInput[]) {
  const acc = activePaymentAccount(loadSystemSettings().business)
  const account = acc.bankAccountNumber || acc.promptPayValue
    ? { id: acc.id, bank: acc.bankName, name: acc.bankAccountName, number: acc.bankAccountNumber, promptpay: acc.promptPayValue }
    : null
  return tenders
    .filter((t) => Number(t.amount) > 0)
    .map((t) => {
      const method = toServerMethod(t.method)
      const base = { method, amount: Math.round(Number(t.amount) * 100) / 100, reference: t.reference || null }
      return account && (method === 'TRANSFER' || method === 'QR') ? { ...base, account } : base
    })
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
    ...(l.productId ? {} : { product_name: l.productName ?? '', unit_name: l.unitName ?? null }),
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

// ─── issue a bill ────────────────────────────────────────────────────────────

/** The bill as the server's bill_save_draft step reads it (bill_issue sends it on). */
function billDataPayload(input: BillDraftInput): Record<string, unknown> {
  const guestName = input.customerId ? '' : (input.guestName ?? '').trim()
  return {
    customer_id: input.customerId || null,
    // Sent only when there is one, so bills with a saved customer look exactly as before.
    ...(guestName ? { guest_name: guestName } : {}),
    quotation_id: input.quotationId || null,
    vat_enabled: input.vatEnabled === true,
    vat_mode: input.vatEnabled === true ? input.vatMode ?? null : null,
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
}

export interface IssueBillPayment {
  /** Money taken, in the order it was taken (cash / QR …). */
  tenders: TenderInput[]
  /** One method paying the exact amount: it pays whatever the server's total is. */
  payExact?: boolean
  /** ค้างชำระ: what was taken is kept, the rest stays owed. Otherwise the money must cover the server's total. */
  allowShort?: boolean
}

/**
 * ออกบิล in one step (owner 2026-11-24: no draft bills): the server saves the bill, sets its document date, cuts the
 * money to its own total and confirms it (bill number, stock, payment) in one transaction. Any refusal leaves nothing
 * behind. Price/discount overrides ask PIN + reason.
 */
export async function issueBill(input: BillDraftInput, payment: IssueBillPayment): Promise<FullBill | null> {
  const data = billDataPayload(input)
  const tenders = tendersPayload(payment.tenders)
  // One key for this click: a retry after the PIN window is the same request.
  const key = newIdempotencyKey()
  const result = await withPinIfRequired(
    { action: 'PRICE_OVERRIDE', title: 'ยืนยันราคา/ส่วนลดพิเศษ', detail: 'มีการแก้ราคาหรือให้ส่วนลดเกินที่ร้านตั้งไว้', askReason: true },
    (token, reason) =>
      rpc<{ bill?: { id?: string } }>('bill_issue', {
        p_data: reason ? { ...data, override_reason: reason } : data,
        p_idempotency_key: key,
        p_tenders: tenders.length ? tenders : null,
        p_pay_exact: Boolean(payment.payExact),
        p_allow_short: Boolean(payment.allowShort),
        p_document_date: input.documentDate ? input.documentDate.slice(0, 10) : null,
        p_pin_token: token,
      })
  )
  const billId = result?.bill?.id
  // Confirming reserves the goods: the stock figures on screen follow at once. The bill is already saved,
  // so a failed stock read only leaves the older figures until the next refresh.
  await syncStockFromSupabase().catch((err: unknown) => console.error('Stock refresh after issuing a bill failed:', err))
  return billId ? refreshAfterChange(billId) : null
}

/**
 * วันที่ออกเอกสาร of a bill (owner 2026-11-17): text printed on the bill, set from the POS and corrected in แก้ไขบิล.
 * The bill number, the bill's own day (lists, search, reports) and money are not touched. A future day is refused.
 */
export async function setBillDocumentDate(billId: string, day: string): Promise<void> {
  await rpc('bill_set_document_date', { p_bill_id: billId, p_date: day.slice(0, 10) })
}

/**
 * Change the customer of a confirmed bill (owner 2026-11-19): a saved customer, or a typed name that is not a saved
 * customer (the bill becomes ลูกค้าทั่วไป). Audited on the server; credit and เช่าต่อ bills keep their customer.
 */
export async function setBillCustomer(billId: string, customerId: string | null, guestName: string | null): Promise<void> {
  await rpc('bill_set_customer', {
    p_bill_id: billId,
    p_customer_id: customerId || null,
    p_guest_name: customerId ? null : guestName?.trim() || null,
  })
}

// ─── money ───────────────────────────────────────────────────────────────────

export async function receivePayment(
  billId: string,
  tenders: TenderInput[],
  receivedDay?: string | null,
  key?: string
): Promise<PaymentReceiveResult> {
  const payload: Record<string, unknown> = {
    p_bill_id: billId,
    p_tenders: tendersPayload(tenders),
    p_idempotency_key: key ?? newIdempotencyKey(),
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
/**
 * The deposit pays what the bill owes (owner 2026-11-06): one receipt "หักจากมัดจำ", the deposit
 * held goes down by the same amount — both in one server step (bill_deposit_apply).
 */
export async function applyDepositToBill(
  billId: string,
  amount: number,
  receivedDay?: string | null,
  key?: string
): Promise<PaymentReceiveResult> {
  const payload: Record<string, unknown> = { p_bill_id: billId, p_amount: amount, p_idempotency_key: key ?? newIdempotencyKey() }
  if (receivedDay) payload.p_received_on = receivedDay.slice(0, 10)
  const result = await rpc<{ receipt_no?: string | null; total_amount?: number | string | null }>('bill_deposit_apply', payload)
  const totalAmount = Number(result.total_amount)
  return {
    bill: await refreshAfterChange(billId),
    receiptNo: result.receipt_no || null,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : null,
  }
}

/** The deposit (or part of it) is given back to the customer (bill_deposit_refund); the bill may close after it. */
export async function refundDeposit(
  billId: string,
  amount: number,
  method: 'CASH' | 'QR' | 'TRANSFER',
  key?: string
): Promise<FullBill | null> {
  await rpc('bill_deposit_refund', {
    p_bill_id: billId,
    p_amount: amount,
    p_method: method,
    p_idempotency_key: key ?? newIdempotencyKey(),
  })
  return refreshAfterChange(billId)
}

/** Refund always points to the payment it returns; never more than received and not yet refunded. */
export async function refundPayment(opts: {
  billId: string
  paymentId: string
  amount: number
  method?: string
  reason: string
  /** Fixed key of this refund within one save (a retry reuses it). */
  key?: string
}): Promise<FullBill | null> {
  const key = opts.key ?? newIdempotencyKey()
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

/**
 * Paid more than the bill now comes to (owner 2026-11-09): the system works out what goes back and pressing
 * ออกบิล records it as given back — newest payment first, deposit-paid receipts last. The bill can then close.
 */
export async function refundOverpayment(billId: string, opKey?: string): Promise<{ amount: number; bill: FullBill | null }> {
  const s = await getRefundSuggestion(billId)
  let left = Math.round(s.suggestedRefund * 100) / 100
  if (left <= 0) return { amount: 0, bill: null }
  const order = [...s.payments].reverse().sort((a, b) => Number(a.method === 'OTHER') - Number(b.method === 'OTHER'))
  let bill: FullBill | null = null
  let refunded = 0
  for (const p of order) {
    const amount = Math.round(Math.min(left, p.refundable) * 100) / 100
    if (amount <= 0) continue
    // Within one save the key is fixed per payment and amount: pressed again after a failure, a refund already
    // made is not made twice (the suggestion is read again, so a smaller amount is a new, correct refund).
    const key = opKey ? `${opKey}:ovp:${p.paymentId}:${Math.round(amount * 100)}` : undefined
    bill = await refundPayment({ billId, paymentId: p.paymentId, amount, reason: 'คืนเงินที่ชำระเกิน', key })
    refunded += amount
    left = Math.round((left - amount) * 100) / 100
    if (left <= 0) break
  }
  return { amount: Math.round(refunded * 100) / 100, bill }
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
  await syncStockFromSupabase()
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
  /** Day these goods came back (daily-rate goods); defaults to the day of the whole return. */
  returnedDay?: string
}

/**
 * Per-round goods used for more rounds than the bill (owner 2026-11-07): the rent for those rounds goes on the
 * bill as a confirmed charge, with or without goods coming back. Saved first, while the bill is surely open
 * (a bill that is paid and fully back closes itself during the return).
 */
export async function chargeExtraRounds(
  billId: string,
  items: Array<{ lineId: string; productName?: string; rounds: number; quantity: number; fee: number }>,
  opKey?: string
): Promise<void> {
  for (const i of items) {
    const fee = Math.round(i.fee * 100) / 100
    if (fee <= 0 || i.rounds <= 0) continue
    // One call creates and confirms the fee; the key makes a retry of the same save return the first fee.
    await rpc('charge_add', {
      p_bill_id: billId,
      p_charge_type: 'OTHER',
      p_amount: fee,
      p_reason: `ค่าเช่ารอบเพิ่ม ${i.rounds} รอบ ${i.productName ?? ''}`.trim(),
      p_idempotency_key: opKey ? `${opKey}:xr:${i.lineId}` : newIdempotencyKey(),
      p_bill_line_id: i.lineId,
      p_basis: { kind: 'EXTRA_ROUNDS', rounds: i.rounds, quantity: i.quantity },
    })
  }
}

/** เพิ่มมัดจำ: the bill's deposit becomes newDepositAmount, once per key (bill_deposit_add). */
export async function addDepositOnce(billId: string, newDepositAmount: number, depositNote: string | null, key?: string): Promise<void> {
  await rpc('bill_deposit_add', {
    p_bill_id: billId,
    p_new_deposit_amount: newDepositAmount,
    p_deposit_note: depositNote,
    p_idempotency_key: key ?? newIdempotencyKey(),
  })
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
  /** Key of this save: every step gets a fixed key from it, so pressing save again never repeats a step. */
  opKey?: string
}): Promise<ReturnResult> {
  const stepKey = (step: string) => (opts.opKey ? `${opts.opKey}:${step}` : newIdempotencyKey())
  const back = opts.items.filter((i) => i.normalQty + i.damagedQty > 0)
  const returnNos: string[] = []
  let credit = 0

  // The server takes one return day per return: goods that come back on different days are
  // saved as separate returns, one per day.
  const byDay = new Map<string, ReturnItemInput[]>()
  for (const i of back) {
    const day = i.returnedDay || opts.returnedDay || ''
    byDay.set(day, [...(byDay.get(day) || []), i])
  }

  for (const [day, group] of byDay) {
    const lines: Array<Record<string, unknown>> = []
    for (const i of group) {
      if (i.normalQty > 0) lines.push({ bill_line_id: i.lineId, quantity: i.normalQty, condition: 'NORMAL' })
      if (i.damagedQty > 0) {
        lines.push({ bill_line_id: i.lineId, quantity: i.damagedQty, condition: 'MAJOR_DAMAGE', to_stock_state: 'DAMAGED' })
      }
    }
    const r = await rpc<{ return_id: string; return_no: string; early_return_credit: number | null }>('return_receive', {
      p_bill_id: opts.billId,
      p_lines: lines,
      p_idempotency_key: stepKey(`ret:${day}`),
      p_returned_at: dayToTimestamp(day || null),
      p_note: opts.note || null,
    })
    returnNos.push(r.return_no)
    credit += Number(r.early_return_credit ?? 0)

    // Damage fees for the cases this return just opened.
    const damaged = group.filter((i) => i.damagedQty > 0)
    if (damaged.length > 0) {
      const supabase = createClient()
      const cases = await selectRows<{ id: string; bill_line_id: string; quantity: number }>(
        supabase
          .from('incident_cases')
          .select('id, bill_line_id, quantity, return_line_id, return_lines!inner(return_id)')
          .eq('return_lines.return_id', r.return_id)
          .eq('incident_type', 'DAMAGE')
      )
      for (const c of cases) {
        const item = damaged.find((i) => i.lineId === c.bill_line_id)
        if (!item) continue
        await addIncidentCharge(opts.billId, 'DAMAGE', c, item.damageFeePerUnit * Number(c.quantity), item.note || 'ค่าเสียหายตอนรับคืน', stepKey(`dmg:${c.id}`))
      }
    }
  }

  // Missing goods → lost (PIN) → lost fee.
  // Lost goods: missing → lost → the loss fee (money the customer pays) in one call, once per key.
  for (const i of opts.items.filter((x) => x.lostQty > 0)) {
    await rpc('lost_add', {
      p_bill_id: opts.billId,
      p_bill_line_id: i.lineId,
      p_quantity: i.lostQty,
      p_amount: Math.round(i.lossFeePerUnit * i.lostQty * 100) / 100,
      p_reason: i.note || 'ลูกค้าแจ้งของหาย',
      p_idempotency_key: stepKey(`lost:${i.lineId}`),
    })
  }

  await syncStockFromSupabase()
  const bill = await refreshAfterChange(opts.billId)
  return {
    returnNo: returnNos.join(', ') || null,
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
  key: string
): Promise<void> {
  const rounded = Math.round(amount * 100) / 100
  if (rounded <= 0) {
    // No fee: the case is closed without one.
    await rpc('incident_waive', { p_case_id: incident.id, p_reason: reason, p_idempotency_key: key })
    return
  }
  // ค่าเสียหาย / ค่าสูญหาย = money the customer pays: created, confirmed and the case closed in one call.
  await rpc('charge_add', {
    p_bill_id: billId,
    p_charge_type: type,
    p_amount: rounded,
    p_reason: reason,
    p_idempotency_key: key,
    p_bill_line_id: incident.bill_line_id,
    p_incident_case_id: incident.id,
    p_resolve_incident: true,
  })
}

// ─── cancel / void / correct / continue ─────────────────────────────────────

/** CONFIRMED (nothing paid/delivered): cancel. Reason required; a member only their own bill of today. */
export async function cancelBill(billId: string, reason: string): Promise<FullBill | null> {
  await withPinIfRequired({ action: 'BILL_CANCEL', title: 'ยืนยันยกเลิกบิล' }, (token) =>
    rpc('bill_cancel', { p_bill_id: billId, p_reason: reason, p_pin_token: token })
  )
  await syncStockFromSupabase()
  return refreshAfterChange(billId)
}

/**
 * Void a confirmed bill (PIN): the server undoes everything at once — stock back, payments voided, refunds and
 * charges reversed, goods carried in go back to the earlier bill (owner 2026-11-19).
 */
export async function voidBill(billId: string, reason: string): Promise<FullBill | null> {
  await withPin({ action: 'BILL_VOID', title: 'ยืนยัน Void บิล', detail: reason }, (token) =>
    rpc('bill_void', { p_bill_id: billId, p_reason: reason, p_pin_token: token })
  )
  await syncStockFromSupabase()
  return refreshAfterChange(billId)
}

/**
 * "ยกเลิกบิล" button on a confirmed bill: an untouched bill is cancelled; once money or goods
 * moved, the bill is voided instead, which undoes all of it.
 */
export async function cancelOrVoidBill(bill: Pick<FullBill, 'id' | 'serverStatus'>, reason: string): Promise<FullBill | null> {
  if (bill.serverStatus === 'CONFIRMED') {
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

/** What แก้ไขบิล sends (see bill_revise): the bill's own discount, all fees, and every line that stays or is added. */
export interface BillRevision {
  billDiscountAmount: number
  feesTotal: number
  lines: Array<Record<string, unknown>>
}

/**
 * แก้ไขบิล (owner 2026-11-17): add / remove / change goods, quantities, rounds, dates, prices, discount and shipping
 * of a confirmed bill. The server moves the stock and prices the bill again in one step (bill_revise).
 */
export async function reviseBill(billId: string, data: BillRevision): Promise<FullBill | null> {
  await rpc('bill_revise', {
    p_bill_id: billId,
    p_data: { bill_discount_amount: data.billDiscountAmount, fees_total: data.feesTotal, lines: data.lines },
    p_idempotency_key: newIdempotencyKey(),
  })
  await syncStockFromSupabase()
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
  /** Fixed key of this save (a retry reuses it). */
  key?: string
}): Promise<string> {
  const key = opts.key ?? newIdempotencyKey()
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

export interface QuickCloseResult {
  bill: FullBill | null
  closed: boolean
  deliveredQty: number
  returnedQty: number
  returnNo: string | null
  depositUsed: number
  cashReceived: number
  receiptNo: string | null
  overpaidBack: number
  depositBack: number
}

/**
 * ปิดบิลด่วน (owner 2026-11-20): whatever the bill still has open, it is settled with the normal server steps,
 * one after another, and the bill closes itself at the end (the server's own close rule):
 * 1. goods not delivered yet → delivered today (the day the button is pressed);
 * 2. every piece still with the customer → back today, in normal condition;
 * 3. a deposit agreed but never received is dropped (not collected and handed back);
 * 4. the deposit held pays what the bill owes, the rest is received in cash today;
 * 5. paid more than the bill comes to (returned early) → given back; the deposit left → given back in cash.
 * Every step reads the bill as it is now, so pressing it again after a failure only does what is still open.
 */
export async function quickCloseBill(billId: string, today: string): Promise<QuickCloseResult> {
  const opKey = newIdempotencyKey()
  const round = (n: number) => Math.round(n * 100) / 100
  let bill = await fetchBillByIdFromSupabase(billId)
  if (!bill) throw new Error('ไม่พบบิลนี้ กรุณารีเฟรชแล้วลองใหม่')
  const result: QuickCloseResult = {
    bill, closed: false, deliveredQty: 0, returnedQty: 0, returnNo: null,
    depositUsed: 0, cashReceived: 0, receiptNo: null, overpaidBack: 0, depositBack: 0,
  }

  const undelivered = bill.items.filter((i) => (i.remainingQty ?? 0) > 0)
  if (undelivered.length > 0) {
    bill = (await deliverBill(
      billId,
      undelivered.map((i) => ({ lineId: i.rentalBillItemId, quantity: i.remainingQty ?? 0 })),
      today,
      'ปิดบิลด่วน'
    )) ?? bill
    result.deliveredQty = undelivered.reduce((sum, i) => sum + (i.remainingQty ?? 0), 0)
  }

  const out = bill.items.filter((i) => i.outstandingQty > 0)
  if (out.length > 0) {
    const back = await processReturn({
      billId,
      returnedDay: today,
      opKey,
      note: 'ปิดบิลด่วน',
      items: out.map((i) => ({
        lineId: i.rentalBillItemId,
        productName: i.productName,
        normalQty: i.outstandingQty,
        damagedQty: 0,
        lostQty: 0,
        damageFeePerUnit: 0,
        lossFeePerUnit: 0,
      })),
    })
    bill = back.bill ?? bill
    result.returnNo = back.returnNo
    result.returnedQty = out.reduce((sum, i) => sum + i.outstandingQty, 0)
  }

  if ((bill.depositOutstanding ?? 0) > 0) {
    const held = round(bill.heldDepositAmount || 0)
    const note = [bill.depositNote, `ปิดบิลด่วน: ไม่เก็บมัดจำที่ยังไม่ได้รับ ${round(bill.depositOutstanding ?? 0)} บาท (${today})`].filter(Boolean).join(' | ')
    await addDepositOnce(billId, held, note, `${opKey}:dep-drop`)
    bill = (await refreshAfterChange(billId)) ?? bill
  }

  const useDeposit = round(Math.min(bill.heldDepositAmount || 0, Math.max(0, bill.outstandingAmount)))
  if (useDeposit > 0) {
    const paid = await applyDepositToBill(billId, useDeposit, today, `${opKey}:dep-use`)
    bill = paid.bill ?? bill
    result.depositUsed = paid.totalAmount ?? useDeposit
  }

  const cash = round(Math.max(0, bill.outstandingAmount))
  if (cash > 0) {
    const paid = await receivePayment(billId, [{ method: 'CASH', amount: cash }], today, `${opKey}:pay`)
    bill = paid.bill ?? bill
    result.cashReceived = paid.totalAmount ?? cash
    result.receiptNo = paid.receiptNo
  }

  const overpaid = await refundOverpayment(billId, opKey)
  bill = overpaid.bill ?? bill
  result.overpaidBack = overpaid.amount

  const depositLeft = round(bill.heldDepositAmount || 0)
  if (depositLeft > 0) {
    bill = (await refundDeposit(billId, depositLeft, 'CASH', `${opKey}:dep-back`)) ?? bill
    result.depositBack = depositLeft
  }

  bill = (await refreshAfterChange(billId)) ?? bill
  result.bill = bill
  result.closed = bill.rentalStatus === 'CLOSED'
  return result
}

async function refreshAfterChange(billId: string): Promise<FullBill | null> {
  // A command on one bill re-reads only that bill into the cache (owner standard 2026-11-12), not
  // the whole list. Money moves with bill commands (payment, refund, void ...): only this bill's
  // payments / refunds are read again into the money cache (owner 2026-11-20), not the whole statement.
  const [bill] = await Promise.all([fetchBillByIdFromSupabase(billId), refreshFinanceCache(billId)])
  return bill
}

async function refreshFinanceCache(billId: string): Promise<void> {
  try {
    const { refreshBillMoney } = await import('@/features/finance/services/finance-storage')
    await refreshBillMoney(billId)
  } catch (err) {
    // The bill command already succeeded; a stale statement must not turn it into an error.
    console.error('Finance refresh after bill change failed:', err)
  }
}
