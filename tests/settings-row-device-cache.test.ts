// 2026-11-19 speed: the ~1.2 MB settings row is downloaded only when the server's updated_at changed.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  selects: [] as string[],
  saved: new Map<string, unknown>(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: (columns: string) => {
        db.selects.push(columns)
        return {
          maybeSingle: async () =>
            db.row
              ? { data: columns === 'updated_at' ? { updated_at: db.row.updated_at } : structuredClone(db.row), error: null }
              : { data: null, error: { message: 'permission denied' } },
        }
      },
    }),
  }),
}))
vi.mock('@/lib/db/rpc', () => ({ rpc: db.rpc }))
vi.mock('@/lib/db/device-cache', () => ({
  SETTINGS_ROW_CACHE_KEY: 'store-settings-row:v1',
  readDeviceCache: vi.fn(async (key: string) => db.saved.get(key)),
  writeDeviceCache: vi.fn(async (key: string, value: unknown) => {
    db.saved.set(key, structuredClone(value))
  }),
}))

const row = (companyName: string, updatedAt: string) => ({
  company_name: companyName,
  tax_id: null,
  address: null,
  phone: null,
  logo_url: 'data:image/png;base64,AAAA',
  timezone: 'Asia/Bangkok',
  vat_enabled: false,
  vat_rate: 7,
  vat_mode: 'EXCLUSIVE',
  doc_number_formats: null,
  policies: {},
  updated_at: updatedAt,
})

describe('fetchSharedSystemConfig › settings row kept on the device', () => {
  beforeEach(() => {
    db.saved.clear()
    db.selects.length = 0
  })

  it('first start downloads the row; later starts only ask updated_at until a save changes it', async () => {
    const { fetchSharedSystemConfig } = await import('@/features/settings/api/settings-repository')
    db.row = row('ร้านเอ', '2026-11-19T01:00:00Z')

    expect((await fetchSharedSystemConfig())?.business.businessName).toBe('ร้านเอ')
    expect(db.selects).toEqual(['*'])

    expect((await fetchSharedSystemConfig())?.business.businessName).toBe('ร้านเอ')
    expect(db.selects).toEqual(['*', 'updated_at'])

    // Saved on another device: updated_at moves, the full row is read again
    db.row = row('ร้านบี', '2026-11-19T02:00:00Z')
    expect((await fetchSharedSystemConfig())?.business.businessName).toBe('ร้านบี')
    expect(db.selects).toEqual(['*', 'updated_at', 'updated_at', '*'])
  })

  it('a save on this device keeps the copy current (no full download afterwards)', async () => {
    const { fetchSharedSystemConfig, saveSettingsSection } = await import('@/features/settings/api/settings-repository')
    const { DEFAULT_SYSTEM_CONFIG } = await import('@/features/settings/services/settings-storage')
    db.row = row('ร้านเอ', '2026-11-19T01:00:00Z')
    await fetchSharedSystemConfig()
    db.row = row('ร้านซี', '2026-11-19T03:00:00Z')
    db.rpc.mockResolvedValueOnce(structuredClone(db.row))
    await saveSettingsSection('business', DEFAULT_SYSTEM_CONFIG)
    db.selects.length = 0
    expect((await fetchSharedSystemConfig())?.business.businessName).toBe('ร้านซี')
    expect(db.selects).toEqual(['updated_at'])
  })

  it('no access → null, even with a copy on the device', async () => {
    const { fetchSharedSystemConfig } = await import('@/features/settings/api/settings-repository')
    db.row = row('ร้านเอ', '2026-11-19T01:00:00Z')
    await fetchSharedSystemConfig()
    db.row = null
    await expect(fetchSharedSystemConfig()).resolves.toBeNull()
  })
})
