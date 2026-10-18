import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product } from '@/lib/types/rental-pos'

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  snapshot: [] as Array<{ product_id: string; snapshot_qty: number }>,
  /** PIN action the fake user cancels (null = every PIN is entered). */
  cancel: null as string | null,
}))

vi.mock('@/lib/db/rpc', async (orig) => ({
  ...(await orig<object>()),
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    fake.calls.push({ fn, args })
    return fn === 'stock_count_open' ? { id: 'count-1' } : {}
  }),
}))
vi.mock('@/lib/db/pin-confirm', () => ({
  withPin: (opts: { action: string }, run: (token: string) => Promise<unknown>) =>
    fake.cancel === opts.action ? Promise.reject(new Error('ยกเลิกการยืนยัน PIN')) : run('pin-token'),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => {
          fake.calls.push({ fn: `select:${table}`, args: { id } })
          return Promise.resolve({ data: fake.snapshot, error: null })
        },
      }),
    }),
  }),
}))

import { applyStockCount, setCachedProducts, StockCountPartialError } from '@/features/products/services/product-storage'

const product = (id: string, available: number, damaged = 0, lost = 0) =>
  ({ id, name: id, availableQuantity: available, damagedQuantity: damaged, lostQuantity: lost, status: 'ACTIVE' }) as Product

const recorded = () => fake.calls.find((c) => c.fn === 'stock_count_record')?.args.p_lines as Array<{ product_id: string; counted_qty: number }>
const order = () => fake.calls.map((c) => c.fn).filter((f) => !f.startsWith('select:'))

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  fake.calls = []
  fake.cancel = null
  setCachedProducts([product('A', 10, 2), product('B', 20), product('C', 5)])
  fake.snapshot = [
    { product_id: 'A', snapshot_qty: 10 },
    { product_id: 'B', snapshot_qty: 20 },
    { product_id: 'C', snapshot_qty: 5 },
  ]
})

describe('P1-P1 counting only some products can be confirmed', () => {
  it('products not counted on screen are recorded at their snapshot (no change), so the count can confirm', async () => {
    await applyStockCount([{ productId: 'B', productName: 'B', counts: { normalQty: 18 } }], 'นับรอบ 1')
    expect(order()).toEqual(['stock_count_open', 'stock_count_record', 'stock_count_confirm'])
    expect(recorded()).toEqual([
      { product_id: 'A', counted_qty: 10, reason: 'นับรอบ 1' },
      { product_id: 'B', counted_qty: 18, reason: 'นับรอบ 1' },
      { product_id: 'C', counted_qty: 5, reason: 'นับรอบ 1' },
    ])
  })

  it('a product that is not in the count round (inactive) stops before anything is recorded', async () => {
    fake.snapshot = fake.snapshot.filter((s) => s.product_id !== 'C')
    await expect(applyStockCount([{ productId: 'C', productName: 'C', counts: { normalQty: 3 } }])).rejects.toThrow('ปิดใช้งาน')
    expect(order()).toEqual(['stock_count_open'])
  })
})

describe('P0-3 damaged/lost and the normal count are not deducted twice', () => {
  it('damaged up: moves AVAILABLE → DAMAGED first, then the count sets AVAILABLE to the counted normal', async () => {
    // A: 10 available, 2 damaged. Found 3 more damaged; 7 good ones on the shelf.
    fake.snapshot = [{ product_id: 'A', snapshot_qty: 7 }, { product_id: 'B', snapshot_qty: 20 }, { product_id: 'C', snapshot_qty: 5 }]
    await applyStockCount([{ productId: 'A', productName: 'A', counts: { normalQty: 7, damagedQty: 5 } }])
    expect(order()).toEqual(['stock_adjust', 'stock_count_open', 'stock_count_record', 'stock_count_confirm'])
    expect(fake.calls[0].args).toMatchObject({ p_product_id: 'A', p_from_state: 'AVAILABLE', p_to_state: 'DAMAGED', p_quantity: 3 })
    // snapshot (taken after the move) 7 = counted 7 → no second deduction
    expect(recorded().find((l) => l.product_id === 'A')?.counted_qty).toBe(7)
  })

  it('lost down (items found) goes to inspection, never straight to AVAILABLE', async () => {
    setCachedProducts([product('A', 10, 0, 4)])
    fake.snapshot = [{ product_id: 'A', snapshot_qty: 10 }]
    await applyStockCount([{ productId: 'A', productName: 'A', counts: { lostQty: 1 } }])
    expect(fake.calls[0].args).toMatchObject({ p_from_state: 'LOST', p_to_state: 'INSPECTION', p_quantity: 3 })
  })

  it('damaged down is refused with guidance and nothing is written', async () => {
    await expect(applyStockCount([{ productId: 'A', productName: 'A', counts: { damagedQty: 1 } }])).rejects.toThrow('นำกลับมาใช้')
    expect(order()).toEqual([])
  })

  it('sales are still refused (sale bills only)', async () => {
    await expect(applyStockCount([{ productId: 'A', productName: 'A', counts: { soldQty: 1 } }])).rejects.toThrow('บิลขาย')
    expect(order()).toEqual([])
  })
})

describe('cancelling the PIN (Master §11.4: review → PIN → adjustment)', () => {
  it('cancelling the count PIN opens no count round and changes nothing', async () => {
    fake.cancel = 'STOCK_COUNT_CONFIRM'
    await expect(applyStockCount([{ productId: 'B', productName: 'B', counts: { normalQty: 18 } }])).rejects.toThrow('ยกเลิก')
    expect(order()).toEqual([])
  })

  it('cancelling a later PIN keeps the confirmed adjustment and says exactly what was saved', async () => {
    fake.cancel = 'STOCK_COUNT_CONFIRM'
    const run = applyStockCount([{ productId: 'A', productName: 'A', counts: { normalQty: 7, damagedQty: 5 } }])
    await expect(run).rejects.toBeInstanceOf(StockCountPartialError)
    await expect(run).rejects.toMatchObject({ saved: ['A (ชำรุด)'] })
    expect(order()).toEqual(['stock_adjust'])
  })
})
