import { createClient } from '@/lib/supabase/client'
import type { StatementTransaction } from '@/features/finance/services/finance-storage'

/**
 * Canonical Supabase persistence adapter for Finance statement transactions.
 *
 * Stage 2 rule:
 * - StatementTransaction is the canonical application contract.
 * - This repository is the only module that performs direct database access against
 *   public.statement_transactions.
 * - The financial ledger is append-only: SELECT + INSERT only.
 * - Cache management and finance/domain calculations stay in finance-storage.ts.
 */

type DbStatementTransactionRow = Record<string, unknown>

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function dbTxToStatementTransaction(row: DbStatementTransactionRow): StatementTransaction {
  return {
    id: asString(row.id),
    dateTime: asString(row.date_time),
    refNo: asString(row.ref_no),
    type: (asString(row.type, 'INCOME') === 'EXPENSE' ? 'EXPENSE' : 'INCOME'),
    category: asString(row.category, 'ค่าเช่าอุปกรณ์'),
    description: asString(row.description),
    customerName: asOptionalString(row.customer_name),
    incomeAmount: asNumber(row.income_amount),
    expenseAmount: asNumber(row.expense_amount),
    runningBalance: asNumber(row.running_balance),
    channel: asString(row.channel),
    billId: asOptionalString(row.bill_id),
    billNo: asOptionalString(row.bill_no),
    originalTxId: asOptionalString(row.original_tx_id),
    correlationId: asOptionalString(row.correlation_id),
    isDeposit: Boolean(row.is_deposit),
  }
}

export function statementTransactionToDbRow(tx: StatementTransaction): Record<string, unknown> {
  return {
    id: tx.id,
    date_time: tx.dateTime || new Date().toISOString(),
    ref_no: tx.refNo,
    type: tx.type || 'INCOME',
    category: tx.category || 'ค่าเช่าอุปกรณ์',
    description: tx.description || '',
    customer_name: tx.customerName || null,
    income_amount: tx.incomeAmount || 0,
    expense_amount: tx.expenseAmount || 0,
    running_balance: tx.runningBalance || 0,
    channel: tx.channel || 'โอนเงิน',
    bill_id: tx.billId || null,
    bill_no: tx.billNo || null,
    original_tx_id: tx.originalTxId || null,
    correlation_id: tx.correlationId || null,
    is_deposit: !!tx.isDeposit,
    created_at: tx.dateTime || new Date().toISOString(),
  }
}

export async function fetchTransactionsFromSupabase(): Promise<StatementTransaction[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('statement_transactions')
    .select('*')
    .order('date_time', { ascending: false })

  if (error) {
    throw new Error(`ไม่สามารถดึงข้อมูลธุรกรรมจาก Supabase ได้: ${error.message}`)
  }

  return (data || []).map((row) => dbTxToStatementTransaction(row as DbStatementTransactionRow))
}

export async function fetchTransactionsForBillFromSupabase(
  billId: string,
  billNo?: string
): Promise<StatementTransaction[]> {
  const supabase = createClient()
  let query = supabase.from('statement_transactions').select('*')

  if (billNo) {
    query = query.or(`bill_id.eq.${billId},bill_no.eq.${billNo}`)
  } else {
    query = query.eq('bill_id', billId)
  }

  const { data, error } = await query.order('date_time', { ascending: true })

  if (error) {
    throw new Error(`ไม่สามารถดึงข้อมูลธุรกรรมของบิล ${billId} จาก Supabase ได้: ${error.message}`)
  }

  return (data || []).map((row) => dbTxToStatementTransaction(row as DbStatementTransactionRow))
}

export async function saveTransactionToSupabase(
  tx: StatementTransaction
): Promise<StatementTransaction> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('statement_transactions')
    .insert(statementTransactionToDbRow(tx))
    .select('*')
    .single()

  if (error) {
    throw new Error(`ไม่สามารถบันทึกธุรกรรมลง Supabase ได้: ${error.message}`)
  }

  return dbTxToStatementTransaction(data as DbStatementTransactionRow)
}
