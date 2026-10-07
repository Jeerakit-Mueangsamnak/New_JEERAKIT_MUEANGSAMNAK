import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SYSTEM_CONFIG } from '@/features/settings/services/settings-storage'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/db/rpc', () => ({ rpc: mocks.rpc }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
}))

import { fetchSharedSystemConfig, saveSharedSystemConfig } from '@/features/settings/api/settings-repository'
import { getPolicies } from '@/lib/db/policies'

/** Master v4.3.1 §37 / §36.1: one VAT switch, no preset rate/mode, owner discount limit, BL numbering. */
describe('shop settings repository (store_settings)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ policies: { notifications: {} } })
  })

  it('saves through settings_update with a reason; VAT off sends no rate or price mode', async () => {
    await saveSharedSystemConfig(DEFAULT_SYSTEM_CONFIG, 'ตั้งค่าร้าน')
    expect(mocks.rpc).toHaveBeenCalledOnce()
    const [fn, args] = mocks.rpc.mock.calls[0]
    expect(fn).toBe('settings_update')
    expect(args.p_reason).toBe('ตั้งค่าร้าน')
    expect(args.p_patch).toMatchObject({ vat_enabled: false, vat_rate: null, vat_mode: null })
    expect(args.p_patch.policies).toMatchObject({ discount_limit_enabled: false, discount_limit_percent: null })
    expect(args.p_patch.doc_number_formats.BILL).toEqual({ prefix: 'BL', digits: 6, reset: 'YEARLY' })
  })

  it('a discount limit below 100% switches the limit on with the owner percent', async () => {
    const cfg = { ...DEFAULT_SYSTEM_CONFIG, financePayment: { ...DEFAULT_SYSTEM_CONFIG.financePayment, maximumDiscountPercent: 15 } }
    await saveSharedSystemConfig(cfg)
    expect(mocks.rpc.mock.calls[0][1].p_patch.policies).toMatchObject({ discount_limit_enabled: true, discount_limit_percent: 15 })
  })

  it('reads the row and maps VAT, numbering, notifications and caches policies', async () => {
    mocks.maybeSingle.mockResolvedValue({
      error: null,
      data: {
        company_name: 'ร้านเอ', tax_id: null, address: 'ที่อยู่', phone: '02', logo_url: null, timezone: 'Asia/Bangkok',
        vat_enabled: true, vat_rate: 7, vat_mode: 'INCLUSIVE',
        doc_number_formats: { BILL: { prefix: 'INV', digits: 5, reset: 'MONTHLY' } },
        policies: { notifications: { returnReminder: { enabled: true, daysBefore: 2 } }, category_defaults: { c1: { unitId: 'u1' } } },
      },
    })
    const cfg = await fetchSharedSystemConfig()
    expect(cfg?.business?.businessName).toBe('ร้านเอ')
    expect(cfg?.financePayment).toMatchObject({ vatEnabled: true, defaultVatPercent: 7, vatCalculationMode: 'INCLUSIVE', maximumDiscountPercent: 100 })
    expect(cfg?.documentNumbering?.rentalBill).toMatchObject({ prefix: 'INV', runningDigits: 5, resetCycle: 'MONTHLY' })
    expect(cfg?.documentNumbering?.quotation.prefix).toBe('QT')
    expect(cfg?.notifications?.returnReminder.daysBefore).toBe(2)
    expect(getPolicies().category_defaults).toEqual({ c1: { unitId: 'u1' } })
  })

  it('signed out / no access → null (defaults stay)', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    await expect(fetchSharedSystemConfig()).resolves.toBeNull()
  })
})
