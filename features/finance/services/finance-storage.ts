/**
 * Finance statement cache for the UI (Master v4.3.1 §22). Built from server records
 * (payments, refunds, expenses, other income) by features/finance/api/finance-repository.ts;
 * new entries go through RPCs and the cache is reloaded. Nothing here writes money directly.
 */
import {
  fetchTransactionsFromSupabase as fetchTransactionsFromRepository,
  fetchRevenueLedgerFromSupabase,
  createExpense,
  createOtherIncome,
  voidExpense,
  voidOtherIncome,
  STATEMENT_DEFAULT_DAYS_BACK,
} from '@/features/finance/api/finance-repository'
import { getLocalDateString } from '@/components/common/CustomDatePicker'

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
  /** Which server record the row comes from (only EXPENSE / OTHER_INCOME can be voided here). */
  source?: 'PAYMENT' | 'REFUND' | 'EXPENSE' | 'OTHER_INCOME'
  /** Receipt number of a bill payment (payment_receipts.receipt_no). */
  receiptNo?: string
  reference?: string
}

/** Signed revenue amount per class from the finance ledger (negative = discount / reversal). */
export interface RevenueLedgerEntry {
  revenueClass: string
  amount: number
  occurredAt: string
}

let _cachedRevenueLedger: RevenueLedgerEntry[] = []
/** Bumped by every fetch and by clearFinanceCache: a fetch may write the cache only while it is still the latest. */
let _fetchGeneration = 0
let _latestFetch: Promise<StatementTransaction[]> | null = null

/** Drops every cached money row (e.g. on sign-out / user switch) so nothing leaks between accounts.
 *  Fetches still in flight are invalidated: their late answer is never written to the cache. */
export function clearFinanceCache(): void {
  _fetchGeneration++
  _latestFetch = null
  _daysBack = STATEMENT_DEFAULT_DAYS_BACK
  _cachedRevenueLedger = []
  _cachedTransactions = null
}

export function loadRevenueLedger(): RevenueLedgerEntry[] {
  return _cachedRevenueLedger
}

export function setCachedRevenueLedger(rows: RevenueLedgerEntry[]): void {
  _cachedRevenueLedger = rows
}

let _cachedTransactions: StatementTransaction[] | null = null

export function setCachedTransactions(txs: StatementTransaction[]): void {
  _cachedTransactions = txs
}

export function loadTransactions(): StatementTransaction[] {
  return _cachedTransactions || []
}

/** How many days back the cached statement reaches: 90 by default, widened by ensureTransactionsSince. */
let _daysBack = STATEMENT_DEFAULT_DAYS_BACK

/** Whole days from the local start of `date` back from today (0 = today). */
function daysBackTo(date: Date, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.ceil((today - day) / 86_400_000)
}

/**
 * An older start date was chosen (statement / reports): reads back to that day once; every later
 * reload keeps that reach. Gives the cached list when it already reaches that far.
 */
export function ensureTransactionsSince(date: Date | null | undefined): Promise<StatementTransaction[]> {
  if (!date || Number.isNaN(date.getTime())) return Promise.resolve(loadTransactions())
  const needed = daysBackTo(date)
  if (needed <= _daysBack) return Promise.resolve(loadTransactions())
  _daysBack = needed
  return fetchTransactionsFromSupabase()
}

export function fetchTransactionsFromSupabase(): Promise<StatementTransaction[]> {
  // Stale-while-revalidate: the last list stays on screen until this read succeeds, and stays if it
  // fails. Another user's rows never show: sign-out / account switch runs clearFinanceCache first.
  const generation = ++_fetchGeneration
  const run = (async () => {
    const [txs, ledger] = await Promise.all([fetchTransactionsFromRepository(_daysBack), fetchRevenueLedgerFromSupabase()])
    if (generation !== _fetchGeneration) {
      // Cleared (sign-out / account switch) or replaced by a newer fetch while waiting:
      // drop this answer, hand back whatever the newer fetch produces (empty after a clear).
      return _latestFetch ? _latestFetch : []
    }
    _cachedTransactions = txs
    _cachedRevenueLedger = ledger
    return txs
  })()
  _latestFetch = run
  return run
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

/** Cancels a wrong expense / other-income entry (PIN + reason, Master §22: void, then record again). */
export async function voidManualTransaction(tx: Pick<StatementTransaction, 'id' | 'source'>, reason?: string): Promise<StatementTransaction[]> {
  const voidReason = reason ?? ''
  if (tx.source === 'EXPENSE') await voidExpense(tx.id, voidReason)
  else if (tx.source === 'OTHER_INCOME') await voidOtherIncome(tx.id, voidReason)
  else throw new Error('รายการรับชำระ/คืนเงินของบิล ต้องจัดการที่หน้าบิล')
  return fetchTransactionsFromSupabase()
}

/** Keeps entries whose local (shop) day is within [startDate, endDate]; dateTime is a UTC timestamp. */
export function filterTransactionsByLocalDate(
  transactions: StatementTransaction[],
  startDate: Date | null,
  endDate: Date | null
): StatementTransaction[] {
  if (!startDate && !endDate) return transactions
  const fromStr = startDate ? getLocalDateString(startDate) : null
  const toStr = endDate ? getLocalDateString(endDate) : null
  return transactions.filter((t) => {
    const tDateStr = getLocalDateString(new Date(t.dateTime))
    return (!fromStr || tDateStr >= fromStr) && (!toStr || tDateStr <= toStr)
  })
}

/** Server timestamps are UTC; screens show the shop's local date and time (DD/MM/BBBB HH:mm). */
export function formatLocalDateTime(value: string): string {
  const d = new Date(value)
  if (!value || Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + 543} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
