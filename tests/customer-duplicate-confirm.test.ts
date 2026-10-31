// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), rows: vi.fn(async () => []) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ order: () => ({}) }) }) }),
}))
vi.mock('@/lib/db/rpc', () => ({
  rpc: mocks.rpc,
  selectRows: mocks.rows,
  isDbError: (err: unknown, tag?: string) => (err as { tag?: string } | null)?.tag === tag,
}))

import { createCustomerAsync } from '@/features/customers/services/customer-storage'
import type { Customer } from '@/lib/types/rental-pos'

const row = { id: 'c-new', customer_code: 'CUST-2', name: 'ลูกค้า ข', phone: '0822222222', address: '', active: true, account_status: 'ACTIVE', contact_details: {} }
const input = { id: '', customerName: 'ลูกค้า ข', phone: '0822222222', address: '', status: 'ACTIVE' } as Customer
const duplicate = Object.assign(new Error('ซ้ำ'), { tag: 'DUPLICATE_CUSTOMER' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('browser confirm must not be used')
  })
})

describe('possible duplicate customer is asked in the app dialog', () => {
  it('saves as a new customer when the user confirms', async () => {
    mocks.rpc.mockRejectedValueOnce(duplicate).mockResolvedValueOnce(row)
    const confirmDuplicate = vi.fn(async () => true)
    const saved = await createCustomerAsync(input, confirmDuplicate)
    expect(confirmDuplicate).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenLastCalledWith('customer_create', expect.objectContaining({ p_confirm_duplicate: true }))
    expect(saved.id).toBe('c-new')
  })

  it('stops (nothing saved) when the user declines or no dialog is given', async () => {
    mocks.rpc.mockRejectedValue(duplicate)
    await expect(createCustomerAsync(input, async () => false)).rejects.toMatchObject({ tag: 'DUPLICATE_CUSTOMER' })
    await expect(createCustomerAsync(input)).rejects.toMatchObject({ tag: 'DUPLICATE_CUSTOMER' })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})
