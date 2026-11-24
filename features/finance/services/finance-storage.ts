/**
 * Finance statement cache for the UI (Master v4.3.1 §22). Built from server records
 * (payments, refunds, expenses, other income) by features/finance/api/finance-repository.ts;
 * new entries go through RPCs and the rows concerned are read again. Nothing here writes money directly.
 */
import {
  fetchStatementFromSupabase,
  fetchBillMoneyFromSupabase,
  fetchRevenueLedgerFromSupabase,
  withRunningBalance,
  statementSince,
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

/**
 * Money data is read only by the screens that show it (owner 2026-11-20, plan ก): the statement, reports,
 * dashboard and customer history. Nothing is read at app start. A screen opening within FINANCE_TTL_MS of
 * the last read uses the cache; older (or never read) = read first, and the screen shows no figures until
 * then. After a money step on a bill only that bill's payments / refunds are read again.
 */
export const FINANCE_TTL_MS = 60_000

/**
 * Reads can finish out of order. Every read takes the next number when it starts; the cache keeps, for
 * each bill, the rows of the newest read, and an older full read never replaces a newer one.
 */
let _readSeq = 0
let _fullSeq = 0
let _openingSeq = 0
const _billSeq = new Map<string, number>()

let _cachedTransactions: StatementTransaction[] | null = null
let _opening = 0
let _txReadAt = 0
let _fullRun: { seq: number; daysBack: number; run: Promise<StatementTransaction[]> } | null = null

/** How many days back the cached statement reaches: 90 by default, widened by ensureTransactionsSince. */
let _daysBack = STATEMENT_DEFAULT_DAYS_BACK

let _cachedRevenueLedger: RevenueLedgerEntry[] | null = null
let _ledgerSince: string | null = null
let _ledgerReadAt = 0
let _ledgerSeq = 0
let _ledgerRun: { seq: number; since: string; run: Promise<RevenueLedgerEntry[]> } | null = null

const isBillMoney = (t: StatementTransaction): boolean => t.source === 'PAYMENT' || t.source === 'REFUND'

function notifyFinanceChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new Event('finance_updated'))
  } catch {
    // best-effort
  }
}

/** Drops every cached money row (e.g. on sign-out / user switch) so nothing leaks between accounts.
 *  Reads still in flight are invalidated: their late answer is never written to the cache. */
export function clearFinanceCache(): void {
  _fullSeq = _openingSeq = _ledgerSeq = ++_readSeq
  _billSeq.clear()
  _fullRun = null
  _ledgerRun = null
  _daysBack = STATEMENT_DEFAULT_DAYS_BACK
  _cachedTransactions = null
  _opening = 0
  _txReadAt = 0
  _cachedRevenueLedger = null
  _ledgerSince = null
  _ledgerReadAt = 0
}

export function loadRevenueLedger(): RevenueLedgerEntry[] {
  return _cachedRevenueLedger ?? []
}

/** Fills the ledger from outside (tests); the next report open reads the server. */
export function setCachedRevenueLedger(rows: RevenueLedgerEntry[]): void {
  _cachedRevenueLedger = rows
  _ledgerReadAt = 0
}

/** Fills the statement from outside (tests); the next screen open reads the server. */
export function setCachedTransactions(txs: StatementTransaction[]): void {
  _cachedTransactions = txs
  _txReadAt = 0
}

export function loadTransactions(): StatementTransaction[] {
  return _cachedTransactions || []
}

/** Whole days from the local start of `date` back from today (0 = today). */
function daysBackTo(date: Date, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.ceil((today - day) / 86_400_000)
}

/** True when the cached statement was read within FINANCE_TTL_MS and reaches back to `since`. */
export function isTransactionsFresh(since?: Date | null, now = Date.now()): boolean {
  if (_cachedTransactions === null || now - _txReadAt >= FINANCE_TTL_MS) return false
  return !since || Number.isNaN(since.getTime()) || daysBackTo(since) <= _daysBack
}

/**
 * The statement rows a screen needs: the cache when it is fresh and reaches `since`, else one read from the
 * server (a read already running that reaches as far is shared). An older start date widens the reach once.
 */
export function ensureTransactionsSince(since?: Date | null): Promise<StatementTransaction[]> {
  if (isTransactionsFresh(since)) return Promise.resolve(loadTransactions())
  if (since && !Number.isNaN(since.getTime())) _daysBack = Math.max(_daysBack, daysBackTo(since))
  if (_fullRun && _fullRun.daysBack >= _daysBack) return _fullRun.run
  return fetchTransactionsFromSupabase()
}

/** Reads the statement window from the server now (refresh button, after a manual entry). */
export function fetchTransactionsFromSupabase(): Promise<StatementTransaction[]> {
  const seq = ++_readSeq
  const daysBack = _daysBack
  const run = (async () => {
    const read = await fetchStatementFromSupabase(daysBack)
    if (seq < _fullSeq) {
      // Cleared (sign-out / account switch) or a newer read is already in: this answer is dropped.
      return _fullRun && _fullRun.seq > seq ? _fullRun.run : loadTransactions()
    }
    // Bills read one by one after this read started keep their newer rows (inside this read's window).
    const since = statementSince(daysBack)
    const newerBills = new Set([..._billSeq].filter(([, s]) => s > seq).map(([id]) => id))
    let rows = read.rows
    if (newerBills.size > 0 && _cachedTransactions) {
      rows = [
        ...rows.filter((t) => !(isBillMoney(t) && newerBills.has(t.billId ?? ''))),
        ..._cachedTransactions.filter((t) => isBillMoney(t) && newerBills.has(t.billId ?? '') && t.dateTime >= since),
      ]
    }
    for (const [id, s] of _billSeq) if (s <= seq) _billSeq.delete(id)
    _fullSeq = seq
    if (seq > _openingSeq) {
      _openingSeq = seq
      _opening = read.opening
    }
    _cachedTransactions = withRunningBalance(rows, _opening)
    _txReadAt = Date.now()
    notifyFinanceChanged()
    return _cachedTransactions
  })()
  _fullRun = { seq, daysBack, run }
  void run.finally(() => {
    if (_fullRun?.run === run) _fullRun = null
  }).catch(() => undefined)
  return run
}

/**
 * After a money step on one bill (payment, refund, deposit, void ...): only that bill's payments / refunds
 * inside the statement window are read again, with the window's opening total, and คงเหลือ is counted again.
 * Nothing is read when no money screen has read the statement yet (it reads on open). Revenue lines may have
 * changed too: the reports read their period again when opened.
 */
export async function refreshBillMoney(billId: string): Promise<void> {
  _ledgerReadAt = 0
  if (_cachedTransactions === null) return
  const seq = ++_readSeq
  const daysBack = _daysBack
  const read = await fetchBillMoneyFromSupabase([billId], daysBack)
  if (_cachedTransactions === null || seq < _fullSeq || (_billSeq.get(billId) ?? 0) > seq || daysBack !== _daysBack) return
  _billSeq.set(billId, seq)
  if (seq > _openingSeq) {
    _openingSeq = seq
    _opening = read.opening
  }
  const others = _cachedTransactions.filter((t) => !(isBillMoney(t) && t.billId === billId))
  _cachedTransactions = withRunningBalance([...others, ...read.rows], _opening)
  notifyFinanceChanged()
}

/** Payments and refunds of these bills, all time (one customer's history), read when the screen asks. */
export async function fetchMoneyOfBills(billIds: string[]): Promise<StatementTransaction[]> {
  if (billIds.length === 0) return []
  return (await fetchBillMoneyFromSupabase(billIds)).rows
}

/** Local start of `date` as an ISO time (the ledger's `.gte`). */
const dayStartIso = (date: Date): string => new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString()

/** True when the revenue lines were read within FINANCE_TTL_MS back to `since`. */
export function isRevenueLedgerFresh(since: Date, now = Date.now()): boolean {
  return _cachedRevenueLedger !== null && now - _ledgerReadAt < FINANCE_TTL_MS && _ledgerSince !== null && _ledgerSince <= dayStartIso(since)
}

/** Revenue lines of the report period (from `since` on): the cache when fresh, else one read (force = read now). */
export function ensureRevenueLedgerSince(since: Date, force = false): Promise<RevenueLedgerEntry[]> {
  if (!force && isRevenueLedgerFresh(since)) return Promise.resolve(loadRevenueLedger())
  const from = dayStartIso(since)
  if (!force && _ledgerRun && _ledgerRun.since <= from) return _ledgerRun.run
  const seq = ++_readSeq
  const run = (async () => {
    const rows = await fetchRevenueLedgerFromSupabase(from)
    if (seq < _ledgerSeq) return _ledgerRun && _ledgerRun.seq > seq ? _ledgerRun.run : loadRevenueLedger()
    _ledgerSeq = seq
    _cachedRevenueLedger = rows
    _ledgerSince = from
    _ledgerReadAt = Date.now()
    return rows
  })()
  _ledgerRun = { seq, since: from, run }
  void run.finally(() => {
    if (_ledgerRun?.run === run) _ledgerRun = null
  }).catch(() => undefined)
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
