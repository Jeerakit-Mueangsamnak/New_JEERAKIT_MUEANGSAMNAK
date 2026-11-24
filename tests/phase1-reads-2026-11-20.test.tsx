// @vitest-environment jsdom
// Owner's list 2026-11-20, phase 1: item 6 (products page reads only what is old), 11 (stock answers out of
// order), 12 (bill answers out of order), 13 (money read by the screens that show it, one bill after a payment).
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

type Resolver = (value: unknown) => void
const fake = vi.hoisted(() => ({
  pending: {} as Record<string, Array<(value: unknown) => void>>,
  calls: [] as string[],
}))
/** A read that stays open until the test answers it (answer(name, i, value)). */
function later(name: string): Promise<never> {
  fake.calls.push(name)
  return new Promise((resolve) => (fake.pending[name] ??= []).push(resolve as Resolver))
}
function answer(name: string, index: number, value: unknown): void {
  fake.pending[name][index](value)
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

vi.mock('@/features/products/api/product-repository', async (orig) => ({
  ...(await orig<object>()),
  fetchProductsFromSupabase: () => later('products'),
  fetchStockBalancesFromSupabase: () => later('stock'),
}))
vi.mock('@/features/bills/api/bill-repository', async (orig) => ({
  ...(await orig<object>()),
  fetchBillsFromSupabase: () => later('bills'),
  fetchBillByIdFromSupabase: (id: string) => later(`bill:${id}`),
}))
vi.mock('@/features/finance/api/finance-repository', async (orig) => ({
  ...(await orig<object>()),
  fetchStatementFromSupabase: (daysBack: number) => later(`statement:${daysBack}`),
  fetchBillMoneyFromSupabase: (ids: string[], daysBack?: number) => later(`billMoney:${ids.join(',')}:${daysBack ?? 'all'}`),
  fetchRevenueLedgerFromSupabase: (since: string) => later(`ledger:${since}`),
}))

import {
  setCachedProducts,
  startProductsRead,
  applyProductsRead,
  loadProducts,
  syncStockFromSupabase,
  syncProductsFromSupabase,
  refreshProductsIfStale,
  PRODUCTS_REFRESH_MIN_MS,
  STOCK_REFRESH_MIN_MS,
} from '@/features/products/services/product-storage'
import { setCachedBills, fetchBillsFromSupabase, fetchBillByIdFromSupabase, loadBillById, loadBills } from '@/features/bills/services/bill-storage'
import {
  clearFinanceCache,
  ensureTransactionsSince,
  ensureRevenueLedgerSince,
  loadTransactions,
  refreshBillMoney,
  FINANCE_TTL_MS,
  type StatementTransaction,
} from '@/features/finance/services/finance-storage'
import { useFinanceRows } from '@/features/finance/hooks/useFinanceRows'
import type { Product } from '@/lib/types/rental-pos'
import type { FullBill } from '@/lib/types/rental-return'

const product = (id: string, available: number) => ({ id, name: id, availableQuantity: available, onHandQuantity: available }) as unknown as Product
const balances = (id: string, available: number) => new Map([[id, { AVAILABLE: available }]])
const bill = (id: string, paid: number, status = 'RENTING') =>
  ({ id, billNo: id, rentalStatus: status, serverStatus: status, paidAmount: paid, items: [] }) as unknown as FullBill
const money = (id: string, billId: string | undefined, income: number, expense = 0, at = '2026-11-20T03:00:00Z'): StatementTransaction => ({
  id,
  dateTime: at,
  refNo: id,
  type: income > 0 ? 'INCOME' : 'EXPENSE',
  category: billId ? 'รับชำระบิล' : 'รายรับอื่นๆ',
  description: id,
  incomeAmount: income,
  expenseAmount: expense,
  runningBalance: 0,
  channel: 'เงินสด',
  billId,
  source: billId ? 'PAYMENT' : 'OTHER_INCOME',
})

beforeEach(() => {
  fake.pending = {}
  fake.calls = []
  vi.useRealTimers()
  setCachedProducts([])
  setCachedBills([])
  clearFinanceCache()
  cleanup()
})

describe('item 6: the products page reads only what is old', () => {
  it('nothing within 1 minute, stock only after 1 minute, the whole list after 5 minutes', async () => {
    // t0 taken before the read lands, so "1 ms before a minute" really is inside the minute.
    const t0 = Date.now()
    applyProductsRead(startProductsRead(), [product('A', 5)])

    await refreshProductsIfStale(t0 + STOCK_REFRESH_MIN_MS - 1)
    expect(fake.calls).toEqual([])

    void refreshProductsIfStale(t0 + STOCK_REFRESH_MIN_MS + 1)
    expect(fake.calls).toEqual(['stock'])

    void refreshProductsIfStale(t0 + PRODUCTS_REFRESH_MIN_MS + 1)
    expect(fake.calls).toEqual(['stock', 'products'])
  })

  it('after sign-out (cache set from outside) the next page open reads the whole list', () => {
    setCachedProducts([product('A', 5)])
    void refreshProductsIfStale()
    expect(fake.calls).toEqual(['products'])
  })
})

describe('item 11: older stock answers never replace newer ones', () => {
  it('two stock reads finishing in reverse order keep the newer figures', async () => {
    applyProductsRead(startProductsRead(), [product('A', 5)])
    const older = syncStockFromSupabase()
    const newer = syncStockFromSupabase()
    answer('stock', 1, balances('A', 3))
    await newer
    answer('stock', 0, balances('A', 9))
    await older
    expect(loadProducts()[0].availableQuantity).toBe(3)
  })

  it('a full product read started before a stock read keeps that newer stock when it lands later', async () => {
    applyProductsRead(startProductsRead(), [product('A', 5)])
    const full = syncProductsFromSupabase()
    const stock = syncStockFromSupabase()
    answer('stock', 0, balances('A', 2))
    await stock
    answer('products', 0, [product('A', 5), product('B', 1)])
    await full
    const [a, b] = loadProducts()
    expect(a.availableQuantity).toBe(2) // newer stock kept
    expect(b.id).toBe('B') // the new product from the full read is in
  })

  it('a stock read started before a full read is dropped when it lands after it', async () => {
    applyProductsRead(startProductsRead(), [product('A', 5)])
    const stock = syncStockFromSupabase()
    const full = syncProductsFromSupabase()
    answer('products', 0, [product('A', 7)])
    await full
    answer('stock', 0, balances('A', 1))
    await stock
    expect(loadProducts()[0].availableQuantity).toBe(7)
  })
})

describe('item 12: older bill answers never bring back an old copy of a bill', () => {
  it('a list read started before a payment does not overwrite the bill read after the payment', async () => {
    const list = fetchBillsFromSupabase(true)
    const one = fetchBillByIdFromSupabase('B1')
    answer('bill:B1', 0, bill('B1', 100))
    await one
    answer('bills', 0, [bill('B1', 0), bill('B2', 0)])
    await list
    expect(loadBillById('B1')?.paidAmount).toBe(100)
    expect(loadBillById('B2')).toBeDefined()
    expect(loadBills().map((b) => b.id)).toEqual(['B1', 'B2']) // list order kept
  })

  it('an older list finishing after a newer list is dropped', async () => {
    const older = fetchBillsFromSupabase(true)
    const newer = fetchBillsFromSupabase(true)
    answer('bills', 1, [bill('B1', 50)])
    await newer
    answer('bills', 0, [bill('B1', 0)])
    await older
    expect(loadBillById('B1')?.paidAmount).toBe(50)
  })

  it('a bill read started before a newer list is dropped when it lands after it (bill closed meanwhile)', async () => {
    const one = fetchBillByIdFromSupabase('B1')
    const list = fetchBillsFromSupabase(true)
    answer('bills', 0, []) // B1 finished since: no longer in work
    await list
    answer('bill:B1', 0, bill('B1', 0))
    await one
    expect(loadBillById('B1')).toBeUndefined()
  })
})

describe('item 13: money is read by the screens that show it', () => {
  it('after a payment nothing is read while no money screen has read the statement yet', async () => {
    await refreshBillMoney('B1')
    expect(fake.calls).toEqual([])
  })

  it('after a payment only that bill is read again; other rows stay and คงเหลือ is counted again', async () => {
    const first = ensureTransactionsSince()
    answer('statement:90', 0, { opening: 1000, rows: [money('p1', 'B1', 100), money('i1', undefined, 50, 0, '2026-11-19T03:00:00Z')] })
    await first

    const refresh = refreshBillMoney('B1')
    await Promise.resolve()
    answer('billMoney:B1:90', 0, { opening: 1000, rows: [money('p1', 'B1', 100), money('p2', 'B1', 40, 0, '2026-11-20T04:00:00Z')] })
    await refresh

    expect(fake.calls).toEqual(['statement:90', 'billMoney:B1:90']) // no second statement read
    const rows = loadTransactions()
    expect(rows.map((r) => r.id)).toEqual(['p2', 'p1', 'i1'])
    expect(rows.map((r) => r.runningBalance)).toEqual([1190, 1150, 1050])
  })

  it('a statement read started before a payment keeps the bill rows read after it', async () => {
    const first = ensureTransactionsSince()
    answer('statement:90', 0, { opening: 0, rows: [money('p1', 'B1', 100)] })
    await first

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + FINANCE_TTL_MS + 1)
    const statement = ensureTransactionsSince() // older than a minute: read again
    const refresh = refreshBillMoney('B1')
    await Promise.resolve()
    answer('billMoney:B1:90', 0, { opening: 0, rows: [money('p1', 'B1', 100), money('p2', 'B1', 40)] })
    await refresh
    answer('statement:90', 1, { opening: 0, rows: [money('p1', 'B1', 100)] })
    await statement
    expect(loadTransactions().map((r) => r.id).sort()).toEqual(['p1', 'p2'])
  })

  it('a screen within a minute of the last read uses it; after a minute it reads again', async () => {
    const first = ensureTransactionsSince()
    answer('statement:90', 0, { opening: 0, rows: [] })
    await first
    await ensureTransactionsSince()
    expect(fake.calls).toEqual(['statement:90'])

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + FINANCE_TTL_MS + 1)
    void ensureTransactionsSince()
    expect(fake.calls).toEqual(['statement:90', 'statement:90'])
  })

  it('revenue lines are read for the report period only, and again after a money step', async () => {
    const since = new Date(2026, 9, 1)
    const first = ensureRevenueLedgerSince(since)
    expect(fake.calls).toEqual([`ledger:${since.toISOString()}`])
    answer(`ledger:${since.toISOString()}`, 0, [])
    await first
    await ensureRevenueLedgerSince(since)
    expect(fake.calls).toHaveLength(1)
    await refreshBillMoney('B1') // statement not read: only marks the revenue lines old
    void ensureRevenueLedgerSince(since)
    expect(fake.calls).toHaveLength(2)
  })

  it('a money screen shows no figure while reading, then the rows', async () => {
    function Probe() {
      const { rows, loading } = useFinanceRows()
      return <div>{loading ? 'loading' : `rows:${rows.length}`}</div>
    }
    render(<Probe />)
    expect(screen.getByText('loading')).toBeTruthy()
    answer('statement:90', 0, { opening: 0, rows: [money('p1', 'B1', 100)] })
    await flush()
    expect(screen.getByText('rows:1')).toBeTruthy()
  })
})
