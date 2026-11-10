import { beforeEach, describe, expect, it, vi } from 'vitest'

type Tx = import('@/features/finance/services/finance-storage').StatementTransaction
const tx = (id: string): Tx => ({ id, dateTime: '2026-11-09T00:00:00Z', refNo: id, type: 'INCOME', category: 'x', description: '', incomeAmount: 1, expenseAmount: 0, runningBalance: 1, channel: 'CASH' })

const repo = vi.hoisted(() => ({ pending: [] as Array<(rows: unknown[]) => void> }))

vi.mock('@/features/finance/api/finance-repository', () => ({
  fetchTransactionsFromSupabase: () => new Promise((resolve) => repo.pending.push(resolve)),
  fetchRevenueLedgerFromSupabase: async () => [],
  createExpense: vi.fn(),
  createOtherIncome: vi.fn(),
  voidExpense: vi.fn(),
  voidOtherIncome: vi.fn(),
}))

import { clearFinanceCache, fetchTransactionsFromSupabase, loadTransactions } from '@/features/finance/services/finance-storage'

beforeEach(() => {
  repo.pending = []
  clearFinanceCache()
})

describe('finance cache ignores late answers', () => {
  it('a fetch started before clearFinanceCache never fills the cache again', async () => {
    const p = fetchTransactionsFromSupabase()
    clearFinanceCache()
    repo.pending[0]([tx('account-A')])
    expect(await p).toEqual([])
    expect(loadTransactions()).toEqual([])
  })

  it('an older fetch finishing after a newer one does not overwrite the newer rows', async () => {
    const older = fetchTransactionsFromSupabase()
    const newer = fetchTransactionsFromSupabase()
    repo.pending[1]([tx('new')])
    expect((await newer).map((t) => t.id)).toEqual(['new'])
    repo.pending[0]([tx('old')])
    expect((await older).map((t) => t.id)).toEqual(['new'])
    expect(loadTransactions().map((t) => t.id)).toEqual(['new'])
  })
})
