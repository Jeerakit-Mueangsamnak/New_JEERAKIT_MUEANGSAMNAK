import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Product } from '@/lib/types/rental-pos'

// products_capability_price_check: a sellable product must have a sale price. Typing a sale
// price on a rent-only product must set the price first, then turn selling on.
const calls: Array<[string, Record<string, unknown>]> = []
vi.mock('@/lib/db/rpc', () => ({
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args])
    return {}
  }),
  selectRows: vi.fn(async () => [{ id: 'unit-1', name: 'ชุด', active: true, sort_order: 1 }]),
  newIdempotencyKey: () => 'k',
}))
vi.mock('@/lib/db/pin-confirm', () => ({
  withPin: (_opts: unknown, run: (token: string, reason?: string) => Promise<unknown>) => run('pin-token'),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ order: () => ({ order: () => ({}) }) }) }) }),
}))

const base: Product = {
  id: '9e967153-4771-4bce-aeeb-9fd49aca6ebe',
  code: 'NR-004',
  name: 'ขาปรับระดับ',
  unit: 'ชุด',
  unitId: 'unit-1',
  productType: 'RENT',
  rentalType: 'NORMAL',
  rentPrice: 20,
  salePrice: null,
  totalQuantity: 0,
} as unknown as Product

describe('saveProductToSupabase › capability and price order', () => {
  beforeEach(() => { calls.length = 0 })

  it('rent-only → sale price typed: set price (PIN) first, then can_sell', async () => {
    const { saveProductToSupabase } = await import('@/features/products/api/product-repository')
    await saveProductToSupabase({ ...base, productType: 'BOTH', salePrice: 50 }, base)
    const names = calls.map(([n]) => n)
    expect(names).toEqual(['product_set_price', 'product_update'])
    expect(calls[0][1]).toMatchObject({ p_sale_price: 50, p_rental_price: 20, p_pin_token: 'pin-token', p_reason: 'แก้ราคาสินค้า' })
    expect(calls[1][1]).toMatchObject({ p_data: { can_sell: true } })
  })

  it('sale price cleared: turn selling off first, then clear the price', async () => {
    const { saveProductToSupabase } = await import('@/features/products/api/product-repository')
    const both = { ...base, productType: 'BOTH', salePrice: 50 } as Product
    await saveProductToSupabase({ ...both, productType: 'RENT', salePrice: null }, both)
    expect(calls.map(([n]) => n)).toEqual(['product_update', 'product_set_price'])
    expect(calls[0][1]).toMatchObject({ p_data: { can_sell: false } })
    expect(calls[1][1]).toMatchObject({ p_sale_price: null })
  })
})
