// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('settings storage keeps nothing in the browser', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  it('loading / caching / saving settings never writes browser storage', async () => {
    const { DEFAULT_SYSTEM_CONFIG, loadSystemSettings, resetSystemSettings, setCachedSystemSettings } =
      await import('@/features/settings/services/settings-storage')
    loadSystemSettings()
    setCachedSystemSettings({ ...DEFAULT_SYSTEM_CONFIG, business: { ...DEFAULT_SYSTEM_CONFIG.business, businessName: 'ร้าน' } })
    resetSystemSettings()
    expect(localStorage.length).toBe(0)
  })

  it('a legacy browser cache is ignored (the server row is the only source)', async () => {
    localStorage.setItem('app_system_settings', JSON.stringify({ business: { businessName: 'Old cache' } }))
    const { loadSystemSettings } = await import('@/features/settings/services/settings-storage')
    expect(loadSystemSettings().business.businessName).toBe('')
  })

  it('defaults follow the owner decisions: no VAT rate/mode, no discount limit, PREFIX-DDMMBBBB-001 numbering', async () => {
    const { DEFAULT_SYSTEM_CONFIG } = await import('@/features/settings/services/settings-storage')
    expect(DEFAULT_SYSTEM_CONFIG.taxDiscount).toMatchObject({ vatRate: null, vatMode: null, discountLimitEnabled: false, discountLimitPercent: null })
    expect(DEFAULT_SYSTEM_CONFIG.documentNumbering.BILL).toEqual({ prefix: 'BL', digits: 3 })
    expect(DEFAULT_SYSTEM_CONFIG.notifications.returnReminder).toEqual({ enabled: true, daysBefore: 1 })
  })
})
