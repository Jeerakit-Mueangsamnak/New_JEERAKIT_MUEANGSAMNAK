// Every list read pages past the database's 1,000-row answer limit (owner 2026-11-11: no silent cut-off).
import { describe, expect, it } from 'vitest'
import { READ_PAGE_SIZE, selectAllRows } from '@/lib/db/rpc'

/** A fake list of `total` rows answering one `range(from, to)` page at a time, like PostgREST. */
function fakeTable(total: number) {
  const requests: Array<{ order: string[]; from: number; to: number }> = []
  const make = () => {
    const order: string[] = []
    const q = {
      order(column: string) {
        order.push(column)
        return q
      },
      range(from: number, to: number) {
        requests.push({ order: [...order], from, to })
        const rows = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ id: from + i }))
        return Promise.resolve({ data: rows, error: null })
      },
    }
    return q.order('created_at')
  }
  return { make, requests }
}

describe('selectAllRows', () => {
  it('reads 2,500 rows in three pages of 1,000, ordered with the primary key last', async () => {
    const t = fakeTable(2500)
    const rows = await selectAllRows<{ id: number }>(t.make)
    expect(rows).toHaveLength(2500)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500)
    expect(t.requests.map((r) => [r.from, r.to])).toEqual([
      [0, READ_PAGE_SIZE - 1],
      [1000, 1999],
      [2000, 2999],
    ])
    expect(t.requests[0].order).toEqual(['created_at', 'id'])
  })

  it('exactly 1,000 rows: one more (empty) page confirms the end', async () => {
    const t = fakeTable(1000)
    await expect(selectAllRows(t.make)).resolves.toHaveLength(1000)
    expect(t.requests).toHaveLength(2)
  })

  it('a short list is one request; a table without id uses its own key columns', async () => {
    const t = fakeTable(5)
    await selectAllRows(t.make, ['product_id', 'stock_state'])
    expect(t.requests).toHaveLength(1)
    expect(t.requests[0].order).toEqual(['created_at', 'product_id', 'stock_state'])
  })

  it('a database error stops the read with the Thai error', async () => {
    const make = () => {
      const q = { order: () => q, range: () => Promise.resolve({ data: null, error: { message: 'permission denied', code: '42501' } }) }
      return q
    }
    await expect(selectAllRows(make)).rejects.toThrow()
  })
})
