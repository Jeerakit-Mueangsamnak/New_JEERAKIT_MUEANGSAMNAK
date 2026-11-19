// @vitest-environment jsdom
/**
 * Egress check 2026-11-20 (owner approved plan ก):
 * 1. LINE server code reads only the LINE parts of store_settings.policies (the column carries ~600 KB of images).
 * 2. A page change re-reads role / status / menus at most once a minute and without the profile picture.
 * 3. Categories and units are read once per full load (handed to the product read).
 * 4. A tab back in view reads bills / stock / notices after 1 minute, everything else after 5 minutes;
 *    a bill command refreshes only the stock figures.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'

const fake = vi.hoisted(() => ({
  selects: [] as Array<{ table: string; columns: string }>,
  profile: { role: 'OWNER', status: 'ACTIVE', is_approved: true, avatar_url: 'data:image/jpeg;base64,PIC' } as Record<string, unknown>,
  session: null as null | { user: { id: string; email: string }; access_token: string },
  pathname: '/pos',
  refreshUser: vi.fn(async (_opts?: { keepAvatar?: boolean }) => {}),
  stockRows: [] as Array<{ product_id: string; stock_state: string; quantity: number }>,
}))

// ─── 1. LINE reads ───────────────────────────────────────────────────────────

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('1. LINE reads only the LINE parts of the shop settings', () => {
  it.each(['app/actions/line.ts', 'lib/line/supabase-store.ts'])('%s never selects the whole policies column', (file) => {
    const src = read(file)
    const selects = [...src.matchAll(/from\('store_settings'\)[\s\S]{0,40}?\.select\(([^)]*)\)/g)].map((m) => m[1])
    expect(selects.length).toBeGreaterThan(0)
    for (const columns of selects) {
      expect(columns).not.toMatch(/'[^']*\bpolicies\b(?!->)[^']*'/)
      expect(columns).not.toContain('*')
    }
  })

  it('the paths name exactly the two values LINE uses', async () => {
    const { SHOP_LINE_ID_COLUMN, SHOP_LINE_TEMPLATES_COLUMN } = await import('@/lib/line/policy')
    expect(SHOP_LINE_ID_COLUMN).toBe('line_id:policies->business_profile->>lineId')
    expect(SHOP_LINE_TEMPLATES_COLUMN).toBe('templates:policies->line->templates')
  })
})

// ─── 2. member re-read ───────────────────────────────────────────────────────

vi.mock('@/lib/supabase/client', () => {
  const from = (table: string) => {
    const builder = {
      select: (columns: string) => {
        fake.selects.push({ table, columns })
        if (table === 'stock_balances') {
          const page = { order: () => page, range: () => Promise.resolve({ data: fake.stockRows, error: null }) }
          return page
        }
        return builder
      },
      eq: () => (table === 'user_menu_access' ? Promise.resolve({ data: [{ menu_code: 'POS' }], error: null }) : builder),
      maybeSingle: () => {
        const cols = fake.selects.filter((s) => s.table === 'profiles').at(-1)?.columns ?? '*'
        const data = cols === '*' ? fake.profile : Object.fromEntries(Object.entries(fake.profile).filter(([k]) => k !== 'avatar_url'))
        return Promise.resolve({ data, error: null })
      },
    }
    return builder
  }
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: fake.session } }),
      getUser: () => Promise.resolve({ data: { user: fake.session?.user ?? null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
    from,
  }
  return { createClient: () => client }
})
vi.mock('@/app/actions/auth', () => ({ logout: vi.fn(async () => {}) }))

describe('2. the member re-read on a page change', () => {
  beforeEach(() => {
    fake.selects = []
    fake.session = { user: { id: 'u1', email: 'u1@shop.test' }, access_token: 't' }
  })
  afterEach(cleanup)

  it('keepAvatar reads the access columns only and keeps the picture already shown', async () => {
    const { AuthProvider, useAuth } = await import('@/features/auth/contexts/AuthContext')
    const seen: { refresh?: (o?: { keepAvatar?: boolean }) => Promise<void>; avatar?: string | null; status?: string } = {}
    function Probe() {
      const { user, refreshUser } = useAuth()
      seen.refresh = refreshUser
      seen.avatar = user?.avatarUrl ?? null
      seen.status = user?.status
      return null
    }
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(seen.status).toBe('ACTIVE'))
    expect(fake.selects.filter((s) => s.table === 'profiles').map((s) => s.columns)).toEqual(['*'])
    expect(seen.avatar).toBe('data:image/jpeg;base64,PIC')

    await act(async () => { await seen.refresh?.({ keepAvatar: true }) })
    const light = fake.selects.filter((s) => s.table === 'profiles').at(-1)!.columns
    expect(light).not.toContain('avatar_url')
    expect(light).not.toBe('*')
    for (const col of ['role', 'status', 'is_approved']) expect(light).toContain(col)
    expect(seen.avatar).toBe('data:image/jpeg;base64,PIC')

    // A suspension seen by the light read still takes effect
    fake.profile = { ...fake.profile, status: 'SUSPENDED' }
    await act(async () => { await seen.refresh?.({ keepAvatar: true }) })
    expect(seen.status).toBe('SUSPENDED')
    fake.profile = { ...fake.profile, status: 'ACTIVE' }

    // A plain refresh (after editing my own profile) reads the picture again
    await act(async () => { await seen.refresh?.() })
    expect(fake.selects.filter((s) => s.table === 'profiles').at(-1)!.columns).toBe('*')
  })
})

describe('2b. AuthShell re-reads on a page change at most once a minute', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.doUnmock('@/features/auth/contexts/AuthContext')
    vi.doUnmock('@/features/auth/contexts/AppLockContext')
    vi.doUnmock('next/navigation')
  })

  it('skips page changes within a minute of the last re-read, without the picture after that', async () => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'))
    vi.doMock('next/navigation', () => ({ usePathname: () => fake.pathname, useRouter: () => ({ replace: vi.fn() }) }))
    vi.doMock('@/features/auth/contexts/AppLockContext', () => ({
      useAppLock: () => ({ pinEnabled: false, isLocked: false, loading: false, unlockApp: vi.fn() }),
    }))
    vi.doMock('@/features/auth/contexts/AuthContext', () => ({
      useAuth: () => ({
        session: { user: { id: 'u1' } },
        loading: false,
        user: { id: 'u1', status: 'ACTIVE', role: 'OWNER', menus: [] },
        hasMenu: () => true,
        refreshUser: fake.refreshUser,
      }),
    }))
    const { AuthShell, ACCESS_RECHECK_MIN_MS } = await import('@/features/auth/components/AuthShell')
    fake.refreshUser.mockClear()
    fake.pathname = '/pos'
    const view = render(<AuthShell><div /></AuthShell>)
    for (const p of ['/bills', '/customers', '/pos']) {
      fake.pathname = p
      view.rerender(<AuthShell><div /></AuthShell>)
    }
    expect(fake.refreshUser).not.toHaveBeenCalled()

    vi.setSystemTime(new Date(Date.now() + ACCESS_RECHECK_MIN_MS))
    fake.pathname = '/products'
    view.rerender(<AuthShell><div /></AuthShell>)
    expect(fake.refreshUser).toHaveBeenCalledTimes(1)
    expect(fake.refreshUser).toHaveBeenCalledWith({ keepAvatar: true })

    fake.pathname = '/bills'
    view.rerender(<AuthShell><div /></AuthShell>)
    expect(fake.refreshUser).toHaveBeenCalledTimes(1)
  })
})

// ─── 3 + 4. product / stock reads ────────────────────────────────────────────

describe('3. stock figures can be refreshed alone', () => {
  it('applyStockBalances gives the same stock figures as a full product read, the rest untouched', async () => {
    const { mapProductRow, applyStockBalances } = await import('@/features/products/api/product-repository')
    const row = {
      id: 'p1', sku: 'A1', name: 'นั่งร้าน', category_id: null, unit_id: 'u', item_type: 'RENT', calculation_type: 'PER_DAY',
      sale_price: null, rental_price: 10, reorder_point: 0, can_sell: false, can_rent: true, is_accessory: false,
      is_rent_chargeable: true, requires_return: true, default_damage_fee: 0, default_loss_fee: 0, active: true,
      created_at: '', updated_at: '',
    }
    const lookups = (b: Record<string, number>) => ({
      categories: new Map(), units: new Map([['u', 'ชุด']]), balances: new Map([['p1', b]]), costs: new Map(),
    })
    const before = mapProductRow(row, lookups({ AVAILABLE: 10 }))
    const after = { AVAILABLE: 4, RESERVED: 2, RENTED_OUT: 3, REPAIR: 1, LOST: 1 }
    const [patched] = applyStockBalances([before], new Map([['p1', after]]))
    expect(patched).toEqual(mapProductRow(row, lookups(after)))
    expect(patched.totalQuantity).toBe(10)
    expect(patched.availableQuantity).toBe(4)
  })
})

describe('4. MasterDataProvider refreshes each kind of data on its own time', () => {
  const calls: string[] = []
  beforeEach(() => {
    calls.length = 0
    vi.resetModules()
    vi.doMock('@/features/settings/api/settings-repository', () => ({ fetchSharedSystemConfig: vi.fn(async () => { calls.push('settings'); return null }) }))
    vi.doMock('@/features/products/api/product-repository', async (orig) => ({
      ...(await orig<object>()),
      fetchProductsFromSupabase: vi.fn(async (lists?: { categories: Promise<unknown>; units: Promise<unknown> }) => {
        calls.push(lists ? 'products(shared lists)' : 'products(own lists)')
        return []
      }),
      fetchCategoriesFromSupabase: vi.fn(async () => { calls.push('categories'); return [] }),
      fetchUnitsFromSupabase: vi.fn(async () => { calls.push('units'); return [] }),
    }))
    vi.doMock('@/features/products/services/product-storage', async (orig) => ({
      ...(await orig<object>()),
      syncStockFromSupabase: vi.fn(async () => { calls.push('stock'); return [] }),
    }))
    vi.doMock('@/features/customers/api/customer-repository', async (orig) => ({
      ...(await orig<object>()),
      fetchCustomersFromSupabase: vi.fn(async () => { calls.push('customers'); return [] }),
    }))
    vi.doMock('@/features/bills/services/bill-storage', async (orig) => ({
      ...(await orig<object>()),
      fetchBillsFromSupabase: vi.fn(async () => { calls.push('bills'); return [] }),
    }))
    vi.doMock('@/features/finance/services/finance-storage', async (orig) => ({
      ...(await orig<object>()),
      fetchTransactionsFromSupabase: vi.fn(async () => { calls.push('finance'); return [] }),
    }))
    vi.doMock('@/features/notifications/services/notification-storage', async (orig) => ({
      ...(await orig<object>()),
      runNotificationScan: vi.fn(async () => {}),
      fetchNotificationsFromSupabase: vi.fn(async () => { calls.push('notifications'); return [] }),
    }))
  })

  it('full load once, then nothing within 1 minute, work data after 1 minute, everything after 5', async () => {
    const m = await import('@/components/common/MasterDataProvider')
    await m.loadAllBusinessData()
    // Money rows are not read at app start (owner 2026-11-20): the money screens read them.
    expect([...calls].sort()).toEqual(
      ['bills', 'categories', 'customers', 'notifications', 'products(shared lists)', 'settings', 'units'].sort()
    )
    const t0 = Date.now()

    calls.length = 0
    expect(await m.refreshStaleBusinessData(t0 + m.WORK_REFRESH_MIN_MS - 1)).toBe(false)
    expect(calls).toEqual([])

    expect(await m.refreshStaleBusinessData(t0 + m.WORK_REFRESH_MIN_MS + 1)).toBe(true)
    expect([...calls].sort()).toEqual(['bills', 'notifications', 'stock'])

    calls.length = 0
    expect(await m.refreshStaleBusinessData(Date.now() + m.GENERAL_REFRESH_MIN_MS)).toBe(true)
    expect(calls).toContain('customers')
    expect(calls).toContain('settings')
    expect(calls.filter((c) => c === 'categories')).toHaveLength(1)
    expect(calls.filter((c) => c === 'units')).toHaveLength(1)
    expect(calls).not.toContain('finance')
  })

  it('a full load asked while the work data is loading still runs (not swallowed by the smaller load)', async () => {
    const m = await import('@/components/common/MasterDataProvider')
    await m.loadAllBusinessData()
    calls.length = 0
    const work = m.refreshStaleBusinessData(Date.now() + m.WORK_REFRESH_MIN_MS + 1)
    const all = m.loadAllBusinessData()
    await Promise.all([work, all])
    expect(calls).toContain('stock')
    expect(calls).toContain('customers')
  })
})
