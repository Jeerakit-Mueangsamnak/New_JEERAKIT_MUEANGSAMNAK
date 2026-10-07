/**
 * Finance statement cache for the UI (Master v4.3.1 §22). Built from server records
 * (payments, refunds, expenses, other income) by features/finance/api/finance-repository.ts;
 * new entries go through RPCs and the cache is reloaded. Nothing here writes money directly.
 */
import {
  fetchTransactionsFromSupabase as fetchTransactionsFromRepository,
  createExpense,
  createOtherIncome,
} from '@/features/finance/api/finance-repository'

export interface StatementTransaction {
  id: string
  dateTime: string
  refNo: string
  type: 'INCOME' | 'EXPENSE'
  category: string
  description: string
  customerName?: string
  incomeAmount: number
  expenseAmount: number
  runningBalance: number
  channel: string
  billId?: string
  billNo?: string
  originalTxId?: string
  correlationId?: string
  isDeposit?: boolean
}

let _cachedTransactions: StatementTransaction[] | null = null

export function setCachedTransactions(txs: StatementTransaction[]): void {
  _cachedTransactions = txs
}

export function loadTransactions(): StatementTransaction[] {
  return _cachedTransactions || []
}

export async function fetchTransactionsFromSupabase(): Promise<StatementTransaction[]> {
  _cachedTransactions = await fetchTransactionsFromRepository()
  return _cachedTransactions
}

/** Manual statement entry: income = รายรับอื่น (no PIN), expense = รายจ่าย (PIN). */
export async function addManualTransaction(input: {
  type: 'INCOME' | 'EXPENSE'
  category: string
  description: string
  amount: number
  channel: string
}): Promise<StatementTransaction[]> {
  if (input.type === 'INCOME') {
    await createOtherIncome(input.category, input.amount, input.channel, input.description)
  } else {
    await createExpense(input.category, input.amount, input.channel, input.description)
  }
  return fetchTransactionsFromSupabase()
}

export function getTransactionsForBill(billId: string): StatementTransaction[] {
  return loadTransactions().filter((t) => t.billId === billId)
}
