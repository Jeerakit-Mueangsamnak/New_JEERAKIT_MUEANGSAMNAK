'use client'

import React, { createContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { setCachedProducts, startProductsRead, applyProductsRead, syncStockFromSupabase } from '@/features/products/services/product-storage'
import { setCachedCategories, type CalculationType, type ProductCategoryItem } from '@/lib/category-rules-storage'
import { setCachedUnits } from '@/lib/unit-storage'
import { setCachedCustomers } from '@/features/customers/services/customer-storage'
import {
  fetchProductsFromSupabase,
  fetchCategoriesFromSupabase,
  fetchUnitsFromSupabase,
  type CategoryRow,
  type UnitRow,
} from '@/features/products/api/product-repository'
import { fetchCustomersFromSupabase } from '@/features/customers/api/customer-repository'
import { fetchBillsFromSupabase, setCachedBills } from '@/features/bills/services/bill-storage'
import { setCachedQuotations } from '@/features/quotations/services/quotation-storage'
import { setCachedAppointments } from '@/features/appointments/services/appointment-storage'
import { clearFinanceCache } from '@/features/finance/services/finance-storage'
import { fetchNotificationsFromSupabase, setCachedNotifications, runNotificationScan } from '@/features/notifications/services/notification-storage'
import { fetchSharedSystemConfig } from '@/features/settings/api/settings-repository'
import { setCachedSystemSettings, resetSystemSettings } from '@/features/settings/services/settings-storage'
import { getCategoryDefaults } from '@/lib/db/policies'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { isPublicRoute } from '@/features/auth/services/public-routes'

interface MasterDataContextType {
  isLoaded: boolean
  error: Error | null
}

const MasterDataContext = createContext<MasterDataContextType>({ isLoaded: false, error: null })
/**
 * True when Supabase answers that the table is not in the database yet
 * (PostgREST PGRST205 / Postgres 42P01). Repositories either rethrow the raw
 * error or wrap its message, so both shapes are checked.
 */
function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string; sqlState?: string } | null)?.code ?? (err as { sqlState?: string } | null)?.sqlState
  if (code === 'PGRST205' || code === '42P01') return true
  const raw = (err as { raw?: string } | null)?.raw
  const message = raw ?? (err instanceof Error ? err.message : String((err as { message?: string } | null)?.message ?? ''))
  return /Could not find the table|relation .* does not exist/i.test(message)
}

/** Business tables that are not created yet load as empty instead of blocking the whole app. */
async function loadOrEmpty<T>(label: string, load: () => Promise<T[]>, set?: (rows: T[]) => void): Promise<T[]> {
  try {
    const rows = await load()
    set?.(rows)
    return rows
  } catch (err) {
    if (!isMissingTableError(err)) throw err
    console.warn(`[Supabase] ${label}: table not created yet, loading as empty`)
    set?.([])
    return []
  }
}

function mapCategories(categories: CategoryRow[]): ProductCategoryItem[] {
  const defaults = getCategoryDefaults()
  // Suspended categories are cached too: loadCategories() offers only active ones, ตั้งค่าสินค้า lists all.
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    calculationType: defaults[c.id]?.calculationType as CalculationType | undefined,
    defaultUnitId: defaults[c.id]?.unitId,
    isActive: c.active,
  }))
}

const mapUnits = (units: UnitRow[]) => units.map((u) => ({ id: u.id, name: u.name, isActive: u.active }))

/**
 * A tab coming back into view reads again only the data older than its refresh time (owner 2026-11-20):
 * work in progress (open bills, stock, notices) after 1 minute; the rest (shop settings, products,
 * categories, units, customers) after 5 minutes. Money screens read their own data (finance-storage). A save re-reads its own data at once
 * (bill-service, product / customer / finance storage) and the server checks the latest figures in every action.
 */
export const WORK_REFRESH_MIN_MS = 60_000
export const GENERAL_REFRESH_MIN_MS = 5 * 60_000

let _loading: { kind: 'all' | 'work'; run: Promise<void> } | null = null
let _allLoadedAt = 0
let _workLoadedAt = 0

/** One load at a time: a call while a load covering it runs waits for that load instead of starting another. */
function runExclusive(kind: 'all' | 'work', load: () => Promise<void>): Promise<void> {
  if (_loading && (_loading.kind === 'all' || kind === 'work')) return _loading.run
  // A complete load asked while only the work data is loading starts after it.
  const before = _loading?.run.catch(() => undefined) ?? Promise.resolve()
  const run: Promise<void> = before.then(load).finally(() => {
    if (_loading?.run === run) _loading = null
  })
  _loading = { kind, run }
  return run
}

/** Reloads every business cache from Supabase (v4.3 schema, RLS SELECT only). */
export function loadAllBusinessData(opts: { scanNotices?: boolean } = {}): Promise<void> {
  return runExclusive('all', async () => {
    await loadAllBusinessDataOnce(opts)
    _allLoadedAt = _workLoadedAt = Date.now()
  })
}

/** Reads again what is older than its refresh time (tab back in view); true when something was read. */
export async function refreshStaleBusinessData(now = Date.now()): Promise<boolean> {
  if (now - _allLoadedAt >= GENERAL_REFRESH_MIN_MS) {
    await loadAllBusinessData()
    return true
  }
  if (now - _workLoadedAt >= WORK_REFRESH_MIN_MS) {
    await runExclusive('work', async () => {
      await Promise.all([
        loadOrEmpty('bills', () => fetchBillsFromSupabase(true)),
        syncStockFromSupabase(),
        loadOrEmpty('notifications', fetchNotificationsFromSupabase, setCachedNotifications),
      ])
      _workLoadedAt = Date.now()
    })
    return true
  }
  return false
}

async function loadAllBusinessDataOnce(opts: { scanNotices?: boolean }): Promise<void> {
  // An OWNER session also refreshes the notices (idempotent: one notice per event); the server's
  // hourly job does the same. It runs beside the load, and the bell gets the new notices when done.
  if (opts.scanNotices) {
    void runNotificationScan()
      .then(() => loadOrEmpty('notifications', fetchNotificationsFromSupabase, setCachedNotifications))
      .catch(() => undefined)
  }

  // Shop settings (the only place store_settings is loaded) and the product catalogue load together;
  // category defaults are applied once the settings are in. Categories and units are read once and handed to
  // the product read, which needs their names too.
  const categoriesRead = loadOrEmpty('product_categories', fetchCategoriesFromSupabase)
  const unitsRead = loadOrEmpty('units', fetchUnitsFromSupabase)
  const productsSeq = startProductsRead()
  const catalogue = Promise.all([
    loadOrEmpty('products', () => fetchProductsFromSupabase({ categories: categoriesRead, units: unitsRead })),
    categoriesRead,
    unitsRead,
  ])
  const shared = await fetchSharedSystemConfig()
  if (shared) setCachedSystemSettings(shared)

  // Dates on bills and appointments use the shop's time zone from the settings, so these start after them.
  const rest = Promise.all([
    loadOrEmpty('customers', fetchCustomersFromSupabase, setCachedCustomers),
    loadOrEmpty('bills', () => fetchBillsFromSupabase(true)),
    // Quotations and appointments are read by the pages that show them (audit 2026-11-12: not at app start):
    // quotations, customers, POS, reports, appointments, dashboard, drivers.
    // Money rows are read by the screens that show them (owner 2026-11-20): statement, reports, dashboard, customers.
    loadOrEmpty('notifications', fetchNotificationsFromSupabase, setCachedNotifications),
  ])

  const [products, categories, units] = await catalogue
  setCachedCategories(mapCategories(categories))
  setCachedUnits(mapUnits(units))
  applyProductsRead(productsSeq, products)

  await rest
}

function clearAllBusinessData(): void {
  resetSystemSettings()
  setCachedProducts([])
  setCachedCategories([])
  setCachedUnits([])
  setCachedCustomers([])
  setCachedBills([])
  setCachedQuotations([])
  setCachedAppointments([])
  clearFinanceCache()
  setCachedNotifications([])
}

export function MasterDataProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const { session, user, loading: authLoading } = useAuth()
  // Public pages (login, register, ...) never wait for shop data: right after signing in the data
  // loads while /pos is still opening, and covering the login page with the loading screen made it
  // come back (re-mounted, form reset) before /pos arrived — it looked like a bounce to the login.
  const onPublicPage = isPublicRoute(usePathname())
  // Shop data is only for ACTIVE members; PENDING/SUSPENDED sessions load nothing.
  const canLoadShopData = Boolean(session) && user?.status === 'ACTIVE'
  // Every auth event (TOKEN_REFRESHED, SIGNED_IN on tab focus, ...) hands out a new session
  // object for the same user; only a different user may reload, or the whole app unmounts.
  const sessionUserId = session?.user?.id ?? null
  const loadedForUserId = useRef<string | null>(null)
  const roleRef = useRef(user?.role)
  roleRef.current = user?.role

  useEffect(() => {
    let active = true
    async function initData() {
      if (authLoading) return
      if (!canLoadShopData) {
        loadedForUserId.current = null
        clearAllBusinessData()
        setIsLoaded(true)
        return
      }
      if (loadedForUserId.current === sessionUserId) return
      setIsLoaded(false)
      setError(null)
      try {
        await loadAllBusinessData({ scanNotices: roleRef.current === 'OWNER' })
        if (active) {
          loadedForUserId.current = sessionUserId
          setIsLoaded(true)
        }
      } catch (err: unknown) {
        console.error('Failed to load master data from Supabase:', err)
        if (active) setError(err instanceof Error ? err : new Error(String(err)))
      }
    }
    void initData()
    return () => {
      active = false
    }
  }, [sessionUserId, authLoading, canLoadShopData, retryAttempt])

  // Other devices change data too: refresh when the tab comes back into view, each kind of data only once it is
  // older than its refresh time (switching apps back and forth on the iPad does not reload everything each time).
  useEffect(() => {
    if (authLoading || !canLoadShopData) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void refreshStaleBusinessData()
        .then((read) => {
          if (read) window.dispatchEvent(new Event('business_data_refreshed'))
        })
        .catch((err: unknown) => console.error('Background refresh failed:', err))
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [authLoading, canLoadShopData])

  if (authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400">
        <div className="flex flex-col items-center">
          <RefreshCw className="h-8 w-8 animate-spin mb-4" />
          <p className="font-semibold">กำลังตรวจสอบสิทธิ์...</p>
        </div>
      </div>
    )
  }

  if (error && !onPublicPage) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 flex-col">
        <h2 className="text-2xl font-bold mb-4">เชื่อมต่อฐานข้อมูลล้มเหลว</h2>
        <p>{error.message}</p>
        <button
          type="button"
          onClick={() => setRetryAttempt((attempt) => attempt + 1)}
          className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950"
        >
          ลองโหลดข้อมูลอีกครั้ง
        </button>
      </div>
    )
  }

  if (!isLoaded && !onPublicPage) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400">
        <div className="flex flex-col items-center">
          <RefreshCw className="h-8 w-8 animate-spin mb-4" />
          <p className="font-semibold">กำลังโหลดข้อมูลระบบ...</p>
        </div>
      </div>
    )
  }

  return <MasterDataContext.Provider value={{ isLoaded, error }}>{children}</MasterDataContext.Provider>
}
