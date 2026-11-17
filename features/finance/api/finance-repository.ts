import { createClient } from '@/lib/supabase/client'
import { DbError, readByIds, rpc, selectAllRows, selectRows } from '@/lib/db/rpc'
import { withPin } from '@/lib/db/pin-confirm'
import { toServerMethod } from '@/features/bills/services/bill-service'
import { EXPENSE_CATEGORIES } from '@/features/finance/expense-categories'
import type { RevenueLedgerEntry, StatementTransaction } from '@/features/finance/services/finance-storage'

/**
 * Finance (Master v4.3.1 §22): the statement is read from the server's own records — bill
 * payments, refunds, expenses and other income — never typed into a separate table. New
 * money in/out outside a bill goes through other_income_create (no PIN) or expense_create
 * (PIN). A real product sale must be a sale bill, not "other income".
 */

export { EXPENSE_CATEGORIES }

const METHOD_TH: Record<string, string> = { CASH: 'เงินสด', TRANSFER: 'โอนเงิน', QR: 'QR', CARD: 'บัตร', OTHER: 'อื่น ๆ' }
/** Reference the server writes on a payment made from the deposit (migration 20261105223245). */
const DEPOSIT_REFERENCE = 'หักจากมัดจำ'

export function expenseCategoryCode(label: string): string {
  const t = (label || '').trim()
  const hit = EXPENSE_CATEGORIES.find((c) => c.label === t || c.code === t.toUpperCase())
  if (hit) return hit.code
  if (/ซ่อม/.test(t)) return 'REPAIR'
  if (/ขนส่ง|ส่งของ/.test(t)) return 'SHIPPING'
  if (/แรง/.test(t)) return 'LABOR'
  if (/น้ำมัน/.test(t)) return 'FUEL'
  if (/อุปกรณ์/.test(t)) return 'EQUIPMENT'
  if (/ซื้อ/.test(t)) return 'PURCHASE'
  return 'GENERAL'
}

/** Thai channel names used by the statement form → server channel codes. */
export function channelCode(channel: string): 'CASH' | 'TRANSFER' | 'CARD' | 'QR' | 'OTHER' {
  if (/สด/.test(channel)) return 'CASH'
  if (/โอน/.test(channel)) return 'TRANSFER'
  if (/QR|พร้อมเพย์/i.test(channel)) return 'QR'
  if (/บัตร/.test(channel)) return 'CARD'
  return toServerMethod(channel)
}

/** The statement shows the last 90 days unless an older start date is chosen (owner 2026-11-12). */
export const STATEMENT_DEFAULT_DAYS_BACK = 90

/** Start of the local day `daysBack` days before today, as an ISO time for `.gte()`. */
export function statementSince(daysBack: number, now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - Math.max(0, Math.floor(daysBack))).toISOString()
}

/**
 * Money total before `since` (finance_statement_opening_balance, migration 20261112120000). Before that
 * migration is run the window starts from 0, as the statement did when it loaded only this window.
 */
async function openingBalance(since: string): Promise<number> {
  try {
    const total = Number(await rpc<number | string | null>('finance_statement_opening_balance', { p_before: since }))
    return Number.isFinite(total) ? total : 0
  } catch (err) {
    if (err instanceof DbError && (err.sqlState === 'PGRST202' || err.sqlState === '42883')) return 0
    throw err
  }
}

/**
 * Money in / out of the last `daysBack` days (payments, refunds, expenses, other income), newest first.
 * Bill numbers, customer names and receipt numbers are read only for the rows found.
 * คงเหลือ (runningBalance) starts from the money total before that window (server opening balance).
 */
export async function fetchTransactionsFromSupabase(daysBack = STATEMENT_DEFAULT_DAYS_BACK): Promise<StatementTransaction[]> {
  const supabase = createClient()
  const since = statementSince(daysBack)
  const [opening, payments, refunds, expenses, incomes] = await Promise.all([
    openingBalance(since),
    selectAllRows<{ id: string; bill_id: string; method: string; amount: number; reference: string | null; status: string; received_at: string; receipt_id: string }>(
      () => supabase.from('payments').select('id, bill_id, method, amount, reference, status, received_at, receipt_id').gte('received_at', since)
    ),
    selectAllRows<{ id: string; bill_id: string; payment_id: string; refund_no: string; amount: number; method: string; reason: string; paid_at: string; status: string }>(
      () => supabase.from('refunds').select('id, bill_id, payment_id, refund_no, amount, method, reason, paid_at, status').gte('paid_at', since)
    ),
    selectAllRows<{ id: string; expense_no: string; category: string; amount: number; paid_method: string; note: string | null; status: string; created_at: string }>(
      () => supabase.from('expense_entries').select('id, expense_no, category, amount, paid_method, note, status, created_at').gte('created_at', since)
    ),
    selectAllRows<{ id: string; income_no: string; category: string; amount: number; channel: string; note: string | null; status: string; created_at: string }>(
      () => supabase.from('other_income_entries').select('id, income_no, category, amount, channel, note, status, created_at').gte('created_at', since)
    ),
  ])
  const [bills, receipts] = await Promise.all([
    readByIds([...payments.map((p) => p.bill_id), ...refunds.map((r) => r.bill_id)], (chunk) =>
      selectRows<{ id: string; bill_no: string | null; customer_id: string | null; customer_snapshot: { name?: string } | null }>(supabase.from('bills').select('id, bill_no, customer_id, customer_snapshot').in('id', chunk))
    ),
    readByIds(payments.map((p) => p.receipt_id), (chunk) =>
      selectRows<{ id: string; receipt_no: string }>(supabase.from('payment_receipts').select('id, receipt_no').in('id', chunk))
    ),
  ])
  const customers = await readByIds(bills.map((b) => b.customer_id), (chunk) =>
    selectRows<{ id: string; name: string }>(supabase.from('customers').select('id, name').in('id', chunk))
  )
  const receiptNoOf = new Map(receipts.map((r) => [r.id, r.receipt_no]))
  const billMap = new Map(bills.map((b) => [b.id, b]))
  const customerMap = new Map(customers.map((c) => [c.id, c.name]))
  const customerOf = (billId: string) => {
    const bill = billMap.get(billId)
    // No customer record = the name typed at POS, kept on the bill (owner 2026-11-16)
    return bill?.customer_id ? customerMap.get(bill.customer_id) : bill?.customer_snapshot?.name || undefined
  }
  const expenseLabel = (code: string) => EXPENSE_CATEGORIES.find((c) => c.code === code)?.label || code

  const rows: StatementTransaction[] = [
    ...payments
      .filter((p) => p.status === 'COMPLETED' || p.status === 'REFUNDED')
      .map((p) => ({
        id: p.id,
        dateTime: p.received_at,
        refNo: billMap.get(p.bill_id)?.bill_no || '',
        type: 'INCOME' as const,
        category: 'รับชำระบิล',
        description: `รับชำระบิล ${billMap.get(p.bill_id)?.bill_no || ''}${p.reference ? ` (${p.reference})` : ''}`,
        customerName: customerOf(p.bill_id),
        incomeAmount: Number(p.amount),
        expenseAmount: 0,
        runningBalance: 0,
        // Paid from the deposit (bill_deposit_apply, owner 2026-11-06): no new money came in today
        channel: p.method === 'OTHER' && p.reference === DEPOSIT_REFERENCE ? DEPOSIT_REFERENCE : METHOD_TH[p.method] || p.method,
        billId: p.bill_id,
        billNo: billMap.get(p.bill_id)?.bill_no || undefined,
        source: 'PAYMENT' as const,
        receiptNo: receiptNoOf.get(p.receipt_id),
        reference: p.reference || undefined,
      })),
    ...refunds
      .filter((r) => r.status === 'PAID')
      .map((r) => ({
        id: r.id,
        dateTime: r.paid_at,
        refNo: r.refund_no,
        type: 'EXPENSE' as const,
        category: 'คืนเงินลูกค้า',
        description: `คืนเงินบิล ${billMap.get(r.bill_id)?.bill_no || ''} — ${r.reason}`,
        customerName: customerOf(r.bill_id),
        incomeAmount: 0,
        expenseAmount: Number(r.amount),
        runningBalance: 0,
        channel: METHOD_TH[r.method] || r.method,
        billId: r.bill_id,
        billNo: billMap.get(r.bill_id)?.bill_no || undefined,
        originalTxId: r.payment_id,
        source: 'REFUND' as const,
      })),
    ...expenses
      .filter((e) => e.status !== 'VOIDED')
      .map((e) => ({
        id: e.id,
        dateTime: e.created_at,
        refNo: e.expense_no,
        type: 'EXPENSE' as const,
        category: expenseLabel(e.category),
        description: e.note || expenseLabel(e.category),
        incomeAmount: 0,
        expenseAmount: Number(e.amount),
        runningBalance: 0,
        channel: METHOD_TH[e.paid_method] || e.paid_method,
        source: 'EXPENSE' as const,
      })),
    ...incomes
      .filter((i) => i.status !== 'VOIDED')
      .map((i) => ({
        id: i.id,
        dateTime: i.created_at,
        refNo: i.income_no,
        type: 'INCOME' as const,
        category: i.category,
        description: i.note || i.category,
        incomeAmount: Number(i.amount),
        expenseAmount: 0,
        runningBalance: 0,
        channel: METHOD_TH[i.channel] || i.channel,
        source: 'OTHER_INCOME' as const,
      })),
  ]

  rows.sort((a, b) => a.dateTime.localeCompare(b.dateTime))
  let balance = opening
  for (const r of rows) {
    balance += r.incomeAmount - r.expenseAmount
    r.runningBalance = Math.round(balance * 100) / 100
  }
  return rows.reverse()
}

/**
 * Revenue lines from the server's finance ledger (Master §22, §31 Revenue per Mode): recorded
 * when a bill is confirmed / a charge is confirmed / other income is saved. Reversals carry the
 * same revenue class with the opposite direction. Readable with the finance menu (RLS).
 */
export async function fetchRevenueLedgerFromSupabase(): Promise<RevenueLedgerEntry[]> {
  const supabase = createClient()
  const rows = await selectAllRows<{ revenue_class: string; amount: number; direction: number; occurred_at: string }>(
    () => supabase
      .from('finance_ledger_entries')
      .select('revenue_class, amount, direction, occurred_at')
      .in('entry_type', ['REVENUE', 'REVERSAL'])
      .not('revenue_class', 'is', null)
  )
  return rows.map((r) => ({
    revenueClass: r.revenue_class,
    amount: Number(r.amount) * (Number(r.direction) < 0 ? -1 : 1),
    occurredAt: r.occurred_at,
  }))
}

/** รายรับอื่น (ไม่ใช่การขายสินค้า — สินค้าต้องออกบิลขาย). */
export async function createOtherIncome(category: string, amount: number, channel: string, note?: string): Promise<void> {
  await rpc('other_income_create', { p_category: category, p_amount: amount, p_channel: channelCode(channel), p_note: note || null })
}

/** รายจ่าย — PIN + audit (Master §4.4). */
export async function createExpense(categoryLabel: string, amount: number, channel: string, note: string): Promise<void> {
  await withPin(
    { action: 'EXPENSE_CREATE', title: 'ยืนยันบันทึกรายจ่าย', detail: `${amount.toLocaleString()} บาท — ${note}` },
    (token) =>
      rpc('expense_create', {
        p_category: expenseCategoryCode(categoryLabel),
        p_amount: amount,
        p_paid_method: channelCode(channel),
        p_note: note,
        p_pin_token: token,
      })
  )
}

export async function voidExpense(expenseId: string, reason: string): Promise<void> {
  await withPin({ action: 'EXPENSE_VOID', title: 'ยืนยันยกเลิกรายจ่าย', detail: reason }, (token) =>
    rpc('expense_void', { p_expense_id: expenseId, p_reason: reason, p_pin_token: token })
  )
}

export async function voidOtherIncome(incomeId: string, reason: string): Promise<void> {
  await withPin({ action: 'OTHER_INCOME_VOID', title: 'ยืนยันยกเลิกรายรับอื่น', detail: reason }, (token) =>
    rpc('other_income_void', { p_income_id: incomeId, p_reason: reason, p_pin_token: token })
  )
}
