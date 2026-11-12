// Bills still in work stay loaded; finished bills are read on demand (owner 2026-11-11, plan ก: last 3 months first).
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Supabase query recorder ────────────────────────────────────────────────
type Call = { table: string; method: string; args: unknown[] }
const calls: Call[] = []
let rowsFor: (table: string, c: Call[]) => unknown[] = () => []

function builder(table: string) {
  const own: Call[] = []
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'in', 'not', 'eq', 'gte', 'lt', 'or', 'order', 'range']) {
    chain[m] = (...args: unknown[]) => {
      const c = { table, method: m, args }
      own.push(c)
      calls.push(c)
      return chain
    }
  }
  chain.then = (resolve: (v: unknown) => void) => {
    const head = own.find((c) => c.method === 'select' && (c.args[1] as { head?: boolean } | undefined)?.head)
    const data = rowsFor(table, own)
    return Promise.resolve(head ? { data: null, error: null, count: data.length } : { data, error: null }).then(resolve)
  }
  return chain
}

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => builder(table) }) }))
vi.mock('@/features/settings/services/settings-storage', () => ({ loadSystemSettings: () => ({ timezone: 'Asia/Bangkok' }) }))

const billRow = (id: string, status: string) => ({
  id, bill_no: `B-${id}`, status, payment_status: 'UNPAID', customer_id: null, quotation_id: null, parent_bill_id: null,
  original_bill_id: null, note: null, sale_subtotal: 0, rental_subtotal: 0, bill_discount_amount: 0, taxable_amount: 0,
  delivery_fee: 0, installation_fee: 0, service_fee: 0, vat_amount: 0, grand_total: 0, charge_total: 0, adjustment_net: 0,
  paid_amount: 0, refunded_amount: 0, write_off_total: 0, balance_due: 0, deposit_amount: 0, deposit_note: null,
  due_date: null, is_credit_bill: false, confirmed_at: null, pricing_snapshot: null, customer_snapshot: null,
  closed_at: null, cancelled_at: null, cancel_reason: null, voided_at: null, void_reason: null, created_at: '2026-11-01T00:00:00Z',
})

describe('bill-repository: which bills are read', () => {
  beforeEach(() => {
    calls.length = 0
    rowsFor = () => []
  })

  it('open bills = every status except closed / cancelled / void, newest first', async () => {
    const { fetchBillsFromSupabase } = await import('@/features/bills/api/bill-repository')
    await fetchBillsFromSupabase()
    const bills = calls.filter((c) => c.table === 'bills')
    expect(bills.find((c) => c.method === 'not')?.args).toEqual(['status', 'in', '(CLOSED,CANCELLED,VOID)'])
    expect(bills.find((c) => c.method === 'order')?.args).toEqual(['created_at', { ascending: false }])
    // Nothing is read for an empty list: no child-table query at all
    expect(calls.some((c) => c.table === 'bill_lines')).toBe(false)
  })

  it('finished bills of a period with a search: status list, local day range, sanitized or-filter', async () => {
    const { fetchBillsByQuery } = await import('@/features/bills/api/bill-repository')
    await fetchBillsByQuery({ scope: 'HISTORY', from: '2026-08-11', to: '2026-11-11', search: ' สมชาย, (081) ' })
    const bills = calls.filter((c) => c.table === 'bills')
    expect(bills.find((c) => c.method === 'in')?.args).toEqual(['status', ['CLOSED', 'CANCELLED', 'VOID']])
    expect(bills.find((c) => c.method === 'gte')?.args).toEqual(['created_at', new Date('2026-08-11T00:00:00').toISOString()])
    expect(bills.find((c) => c.method === 'lt')?.args).toEqual(['created_at', new Date('2026-11-12T00:00:00').toISOString()])
    const or = bills.find((c) => c.method === 'or')?.args[0]
    expect(or).toBe('bill_no.ilike.*สมชาย 081*,customer_snapshot->>name.ilike.*สมชาย 081*,customer_snapshot->>phone.ilike.*สมชาย 081*')
  })

  it('child tables are read by bill id in chunks of 100, customers only for the bills read', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `b${i}`)
    rowsFor = (table) => (table === 'bills' ? ids.map((id) => ({ ...billRow(id, 'CLOSED'), customer_id: `c${id}` })) : [])
    const { fetchBillsByQuery } = await import('@/features/bills/api/bill-repository')
    const bills = await fetchBillsByQuery({ scope: 'HISTORY' })
    expect(bills).toHaveLength(150)
    const lineChunks = calls.filter((c) => c.table === 'bill_lines' && c.method === 'in').map((c) => (c.args[1] as string[]).length)
    expect(lineChunks).toEqual([100, 50])
    const customerChunks = calls.filter((c) => c.table === 'customers' && c.method === 'in').map((c) => (c.args[1] as string[]).length)
    expect(customerChunks).toEqual([100, 50])
    expect(calls.some((c) => c.table === 'customers' && c.method === 'select' && !calls.some((d) => d.table === 'customers' && d.method === 'in'))).toBe(false)
  })

  it('a long id list is split across several bill queries', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `x${i}`)
    const { fetchBillsByQuery } = await import('@/features/bills/api/bill-repository')
    await fetchBillsByQuery({ ids })
    const billIdChunks = calls.filter((c) => c.table === 'bills' && c.method === 'in' && c.args[0] === 'id').map((c) => (c.args[1] as string[]).length)
    expect(billIdChunks).toEqual([100, 20])
  })

  it('counts closed bills without reading rows', async () => {
    rowsFor = (table) => (table === 'bills' ? [billRow('1', 'CLOSED'), billRow('2', 'CLOSED')] : [])
    const { countBillsWithStatus } = await import('@/features/bills/api/bill-repository')
    await expect(countBillsWithStatus(['CLOSED'])).resolves.toBe(2)
    const select = calls.find((c) => c.table === 'bills' && c.method === 'select')
    expect(select?.args[1]).toEqual({ count: 'exact', head: true })
  })
})

describe('bill-storage: open bills stay, finished bills are kept as read', () => {
  const full = (id: string, serverStatus: string, rentalStatus = 'RENTING') =>
    ({ id, billNo: `B-${id}`, serverStatus, rentalStatus, items: [], customerName: '', customerPhone: '', customerAddress: '', billDate: '', rentalStartDate: '', grandTotal: 0, paidAmount: 0, outstandingAmount: 0, paymentStatus: 'UNPAID' }) as never

  beforeEach(() => {
    calls.length = 0
    rowsFor = () => []
  })

  it('reloading open bills does not forget the finished bills read for a period', async () => {
    const storage = await import('@/features/bills/services/bill-storage')
    storage.setCachedBills([full('open1', 'ACTIVE'), full('old1', 'CLOSED', 'CLOSED')])
    expect(storage.loadBills().map((b) => b.id)).toEqual(['open1', 'old1'])

    rowsFor = (table) => (table === 'bills' ? [billRow('open2', 'ACTIVE')] : [])
    const open = await storage.fetchBillsFromSupabase()
    expect(open.map((b) => b.id)).toEqual(['open2'])
    expect(storage.loadBills().map((b) => b.id)).toEqual(['open2', 'old1'])
  })

  it('a bill read by id replaces its older copy and moves to the right set when it closed', async () => {
    const storage = await import('@/features/bills/services/bill-storage')
    storage.setCachedBills([full('a', 'ACTIVE')])
    rowsFor = (table) => (table === 'bills' ? [billRow('a', 'CLOSED')] : [])
    const bill = await storage.fetchBillByIdFromSupabase('a')
    expect(bill?.serverStatus).toBe('CLOSED')
    expect(storage.loadBills().filter((b) => b.id === 'a')).toHaveLength(1)
    // Reloading the open set no longer returns it, yet it stays readable from the cache
    rowsFor = () => []
    await storage.fetchBillsFromSupabase()
    expect(storage.loadBillById('a')?.serverStatus).toBe('CLOSED')
  })

  it('closed bills of a period are read with the HISTORY scope and merged', async () => {
    const storage = await import('@/features/bills/services/bill-storage')
    storage.setCachedBills([])
    rowsFor = (table) => (table === 'bills' ? [billRow('h1', 'CLOSED'), billRow('h2', 'VOID')] : [])
    const list = await storage.fetchClosedBills({ from: '2026-08-11', to: '2026-11-11' })
    expect(list.map((b) => b.id)).toEqual(['h1', 'h2'])
    expect(calls.find((c) => c.table === 'bills' && c.method === 'in')?.args).toEqual(['status', ['CLOSED', 'CANCELLED', 'VOID']])
    expect(storage.loadBills().map((b) => b.id)).toEqual(['h1', 'h2'])
  })

  it("a product's bills are read by the ids of its lines; none = nothing read", async () => {
    const storage = await import('@/features/bills/services/bill-storage')
    storage.setCachedBills([])
    rowsFor = (table, own) => {
      if (table === 'bill_lines' && own.some((c) => c.method === 'eq')) return [{ bill_id: 'p1' }, { bill_id: 'p1' }]
      if (table === 'bills') return [billRow('p1', 'CLOSED')]
      return []
    }
    const list = await storage.fetchBillsForProduct('prod')
    expect(list.map((b) => b.id)).toEqual(['p1'])
    expect(calls.find((c) => c.table === 'bills' && c.method === 'in' && c.args[0] === 'id')?.args[1]).toEqual(['p1'])

    calls.length = 0
    rowsFor = () => []
    await expect(storage.fetchBillsForProduct('none')).resolves.toEqual([])
    expect(calls.some((c) => c.table === 'bills')).toBe(false)
  })
})
