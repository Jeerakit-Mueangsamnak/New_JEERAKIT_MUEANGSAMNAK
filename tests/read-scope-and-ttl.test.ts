// Reads limited to what a screen shows (owner 2026-11-12): statement window + opening balance,
// 60 s reuse of bills / quotations / appointments, one customer's quotations, catalogue from cache.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { table: string; method: string; args: unknown[] }
const db = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: (() => []) as (table: string, own: Call[]) => unknown[],
  opening: 0 as number,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}))

function builder(table: string) {
  const own: Call[] = []
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'in', 'not', 'eq', 'gte', 'lt', 'or', 'order', 'range']) {
    chain[m] = (...args: unknown[]) => {
      const c = { table, method: m, args }
      own.push(c)
      db.calls.push(c)
      return chain
    }
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve({ data: db.rows(table, own), error: null }).then(resolve)
  return chain
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: (table: string) => builder(table), auth: { getSession: async () => ({ data: { session: null } }) } }),
}))
vi.mock('@/lib/db/rpc', async (orig) => ({
  ...(await orig<object>()),
  rpc: vi.fn(async (fn: string, args: unknown) => {
    db.rpcCalls.push({ fn, args })
    return fn === 'finance_statement_opening_balance' ? db.opening : null
  }),
}))
vi.mock('@/features/settings/services/settings-storage', () => ({ loadSystemSettings: () => ({ timezone: 'Asia/Bangkok' }) }))

beforeEach(() => {
  db.calls.length = 0
  db.rpcCalls.length = 0
  db.rows = () => []
  db.opening = 0
})

describe('finance statement: last 90 days, คงเหลือ carried from before', () => {
  it('reads each money table from the window start and starts the balance at the server opening total', async () => {
    db.opening = 1000
    db.rows = (table) =>
      table === 'payments' ? [{ id: 'p1', bill_id: 'b1', method: 'CASH', amount: 200, reference: null, status: 'COMPLETED', received_at: '2026-11-10T03:00:00Z', receipt_id: 'r1' }]
      : table === 'expense_entries' ? [{ id: 'e1', expense_no: 'EX1', category: 'OTHER', amount: 50, paid_method: 'CASH', note: null, status: 'POSTED', created_at: '2026-11-11T03:00:00Z' }]
      : table === 'bills' ? [{ id: 'b1', bill_no: 'BL-1', customer_id: 'c1' }]
      : []
    const { fetchTransactionsFromSupabase, statementSince } = await import('@/features/finance/api/finance-repository')
    const rows = await fetchTransactionsFromSupabase(90)
    const since = statementSince(90)
    expect(db.calls.find((c) => c.table === 'payments' && c.method === 'gte')?.args).toEqual(['received_at', since])
    expect(db.calls.find((c) => c.table === 'refunds' && c.method === 'gte')?.args).toEqual(['paid_at', since])
    expect(db.calls.find((c) => c.table === 'expense_entries' && c.method === 'gte')?.args).toEqual(['created_at', since])
    expect(db.rpcCalls).toContainEqual({ fn: 'finance_statement_opening_balance', args: { p_before: since } })
    // newest first: 1000 + 200 - 50
    expect(rows.map((r) => r.runningBalance)).toEqual([1150, 1200])
    // names only for the rows found
    expect(db.calls.find((c) => c.table === 'bills' && c.method === 'in')?.args).toEqual(['id', ['b1']])
    expect(db.calls.find((c) => c.table === 'customers' && c.method === 'in')?.args).toEqual(['id', ['c1']])
  })

  it('an older start date reads back once; a date inside the window uses the cache', async () => {
    const storage = await import('@/features/finance/services/finance-storage')
    storage.clearFinanceCache()
    await storage.fetchTransactionsFromSupabase()
    db.calls.length = 0
    const tenDaysAgo = new Date()
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)
    await storage.ensureTransactionsSince(tenDaysAgo)
    expect(db.calls.some((c) => c.table === 'payments')).toBe(false)

    const old = new Date()
    old.setDate(old.getDate() - 200)
    await storage.ensureTransactionsSince(old)
    const { statementSince } = await import('@/features/finance/api/finance-repository')
    expect(db.calls.find((c) => c.table === 'payments' && c.method === 'gte')?.args).toEqual(['received_at', statementSince(200)])
  })
})

describe('60 s reuse after a read', () => {
  it('bills, quotations and appointments are not read again within 60 s unless forced', async () => {
    vi.useFakeTimers()
    try {
      const bills = await import('@/features/bills/services/bill-storage')
      const quotations = await import('@/features/quotations/services/quotation-storage')
      const appointments = await import('@/features/appointments/services/appointment-storage')
      bills.setCachedBills([])
      quotations.setCachedQuotations([])
      appointments.setCachedAppointments([])
      const reads = (table: string) => db.calls.filter((c) => c.table === table && c.method === 'select').length

      await Promise.all([bills.fetchBillsFromSupabase(), quotations.fetchQuotationsFromSupabase(), appointments.fetchAppointmentsFromSupabase()])
      const first = { bills: reads('bills'), quotations: reads('quotations'), appointments: reads('appointments') }
      expect(first.bills).toBeGreaterThan(0)

      await Promise.all([bills.fetchBillsFromSupabase(), quotations.fetchQuotationsFromSupabase(), appointments.fetchAppointmentsFromSupabase()])
      expect({ bills: reads('bills'), quotations: reads('quotations'), appointments: reads('appointments') }).toEqual(first)

      await bills.refreshBillsCache()
      expect(reads('bills')).toBe(first.bills + 1)

      vi.advanceTimersByTime(60_000)
      await quotations.fetchQuotationsFromSupabase()
      expect(reads('quotations')).toBe(first.quotations + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('one customer’s quotations and the catalogue from cache', () => {
  it('filters quotations by customer on the server; cached products / customers are not read again', async () => {
    const { setCachedProducts } = await import('@/features/products/services/product-storage')
    const { setCachedCustomers } = await import('@/features/customers/services/customer-storage')
    setCachedProducts([{ id: 'p1', name: 'แบบคาน', unitId: 'u1', isChargeable: true } as never])
    setCachedCustomers([{ id: 'c1', customerName: 'ลูกค้า ก', phone: '081', address: '' } as never])
    db.rows = (table) =>
      table === 'quotations' ? [{ id: 'q1', customer_id: 'c1', subtotal: 0, discount_total: 0, delivery_fee: 0, deposit_amount: 0, vat_amount: 0, grand_total: 0, status: 'SENT', created_at: '2026-11-01T00:00:00Z' }]
      : table === 'quotation_items' ? [{ id: 'i1', quotation_id: 'q1', product_id: 'p1', line_no: 1, quantity: 1, unit_price: 1, line_total: 1, line_mode: 'RENTAL' }]
      : []
    const { fetchQuotationsForCustomer } = await import('@/features/quotations/services/quotation-storage')
    const list = await fetchQuotationsForCustomer('c1')
    expect(list[0].customerName).toBe('ลูกค้า ก')
    expect(list[0].items[0].productName).toBe('แบบคาน')
    expect(db.calls.find((c) => c.table === 'quotations' && c.method === 'eq')?.args).toEqual(['customer_id', 'c1'])
    expect(db.calls.some((c) => c.table === 'products' || c.table === 'customers')).toBe(false)
  })
})
