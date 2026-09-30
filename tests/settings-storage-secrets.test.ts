// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/audits/services/audit-storage', () => ({
  recordAuditLog: vi.fn(),
  generateCorrelationId: () => 'test-correlation-id',
}))

describe('settings storage sensitive-field handling', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  it('removes legacy LINE credentials from the browser cache when settings load', async () => {
    localStorage.setItem('app_system_settings', JSON.stringify({
      business: { businessName: 'Test Business' },
      appointmentsNotifications: {
        lineNotifyToken: 'legacy-token',
        lineOaSecret: 'legacy-secret',
      },
    }))

    const { loadSystemSettings } = await import('@/features/settings/services/settings-storage')
    const settings = loadSystemSettings()
    const cached = JSON.parse(localStorage.getItem('app_system_settings') || '{}')

    expect(settings.business.businessName).toBe('Test Business')
    expect(settings).not.toHaveProperty('appointmentsNotifications')
    expect(cached).not.toHaveProperty('appointmentsNotifications')
    expect(JSON.stringify(cached)).not.toContain('legacy-token')
    expect(JSON.stringify(cached)).not.toContain('legacy-secret')
  })

  it('never writes LINE credentials when saving or caching settings', async () => {
    const { DEFAULT_SYSTEM_CONFIG, saveSystemSettings, setCachedSystemSettings } =
      await import('@/features/settings/services/settings-storage')

    saveSystemSettings(DEFAULT_SYSTEM_CONFIG)
    setCachedSystemSettings(DEFAULT_SYSTEM_CONFIG)

    const cached = JSON.parse(localStorage.getItem('app_system_settings') || '{}')
    expect(cached).not.toHaveProperty('appointmentsNotifications')
  })
})
