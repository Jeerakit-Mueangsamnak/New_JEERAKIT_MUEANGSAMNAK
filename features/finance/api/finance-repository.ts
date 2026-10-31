import { createClient } from '@/lib/supabase/client'
import { rpc, selectRows } from '@/lib/db/rpc'
import { withPin } from '@/lib/db/pin-confirm'
import { toServerMethod } from '@/features/bills/services/bill-service'
import type { RevenueLedgerEntry, StatementTransaction } from '@/features/finance/services/finance-storage'

/**
 * Finance (Master v4.3.1 §22): the statement is read from the server's own records — bill
 * payments, refunds, expenses and other income — never typed into a separate table. New
 * money in/out outside a bill goes through other_income_create (no PIN) or expense_create
 * (PIN). A real product sale must be a sale bill, not "other income".
 */

export const EXPENSE_CATEGORIES: Array<{ code: string; label: string }> = [
  { code: 'PURCHASE', label: 'ซื้อสินค้า' },
  { code: 'REPAIR', label: 'ค่าซ่อม' },
  { code: 'SHIPPING', label: 'ค่าขนส่ง' },
  { code: 'LABOR', label: 'ค่าแรง' },
  { code: 'FUEL', label: 'ค่าน้ำมัน' },
  { code: 'EQUIPMENT', label: 'ค่าอุปกรณ์' },
  { code: 'GENERAL', label: 'ค่าใช้จ่ายทั่วไป' },
]

const METHOD_TH: Record<string, string> = { CASH: 'เงินสด', TRANSFER: 'โอนเงิน', QR: 'QR', CARD: 'บัตร', OTHER: 'อื่น ๆ' }

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

export async function fetchTransactionsFromSupabase(): Promise<StatementTransaction[]> {
  const supabase = createClient()
  const [payments, refunds, expenses, incomes, bills, customers, receipts] = await Promise.all([
    selectRows<{ id: string; bill_id: string; method: string; amount: number; reference: string | null; status: string; received_at: string; receipt_id: string }>(
      supabase.from('payments').select('id, bill_id, method, amount, reference, status, received_at, receipt_id')
    ),
    selectRows<{ id: string; bill_id: string; payment_id: string; refund_no: string; amount: number; method: string; reason: string; paid_at: string; status: string }>(
      supabase.from('refunds').select('id, bill_id, payment_id, refund_no, amount, method, reason, paid_at, status')
    ),
    selectRows<{ id: string; expense_no: string; category: string; amount: number; paid_method: string; note: string | null; status: string; created_at: string }>(
      supabase.from('expense_entries').select('id, expense_no, category, amount, paid_method, note, status, created_at')
    ),
    selectRows<{ id: string; income_no: string; category: string; amount: number; channel: string; note: string | null; status: string; created_at: string }>(
      supabase.from('other_income_entries').select('id, income_no, category, amount, channel, note, status, created_at')
    ),
    selectRows<{ id: string; bill_no: string | null; customer_id: string | null }>(supabase.from('bills').select('id, bill_no, customer_id')),
    selectRows<{ id: string; name: string }>(supabase.from('customers').select('id, name')),
    selectRows<{ id: string; receipt_no: string }>(supabase.from('payment_receipts').select('id, receipt_no')),
  ])
  const receiptNoOf = new Map(receipts.map((r) => [r.id, r.receipt_no]))
  const billMap = new Map(bills.map((b) => [b.id, b]))
  const customerMap = new Map(customers.map((c) => [c.id, c.name]))
  const customerOf = (billId: string) => {
    const cid = billMap.get(billId)?.customer_id
    return cid ? customerMap.get(cid) : undefined
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
        channel: METHOD_TH[p.method] || p.method,
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
  let balance = 0
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
  const rows = await selectRows<{ revenue_class: string; amount: number; direction: number; occurred_at: string }>(
    supabase
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
