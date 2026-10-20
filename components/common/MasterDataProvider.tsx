'use client'

import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { setCachedProducts } from '@/features/products/services/product-storage'
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
import { fetchQuotationsFromSupabase, setCachedQuotations } from '@/features/quotations/services/quotation-storage'
import { fetchAppointmentsFromSupabase, setCachedAppointments } from '@/features/appointments/services/appointment-storage'
import { fetchTransactionsFromSupabase, setCachedTransactions, setCachedRevenueLedger } from '@/features/finance/services/finance-storage'
import { fetchNotificationsFromSupabase, setCachedNotifications, runNotificationScan } from '@/features/notifications/services/notification-storage'
import { fetchSharedSystemConfig } from '@/features/settings/api/settings-repository'
import { setCachedSystemSettings, resetSystemSettings } from '@/features/settings/services/settings-storage'
import { getCategoryDefaults } from '@/lib/db/policies'
import { useAuth } from '@/features/auth/contexts/AuthContext'

interface MasterDataContextType {
  isLoaded: boolean
  error: Error | null
}

const MasterDataContext = createContext<MasterDataContextType>({ isLoaded: false, error: null })

export function useMasterData() {
  return useContext(MasterDataContext)
}

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
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    calculationType: defaults[c.id]?.calculationType as CalculationType | undefined,
    defaultUnitId: defaults[c.id]?.unitId,
    isActive: c.active,
  }))
}

const mapUnits = (units: UnitRow[]) => units.map((u) => ({ id: u.id, name: u.name, isActive: u.active }))

/** Reloads every business cache from Supabase (v4.3 schema, RLS SELECT only). */
export async function loadAllBusinessData(opts: { scanNotices?: boolean } = {}): Promise<void> {
  // Until the scheduled job is set up on the server, an OWNER session refreshes the notices
  // (idempotent: one notice per event).
  if (opts.scanNotices) await runNotificationScan()

  // Shop settings first (the only place store_settings is loaded): category defaults and
  // notification settings live in store_settings.policies.
  const shared = await fetchSharedSystemConfig()
  if (shared) setCachedSystemSettings(shared)

  const [products, categories, units] = await Promise.all([
    loadOrEmpty('products', fetchProductsFromSupabase),
    loadOrEmpty('product_categories', fetchCategoriesFromSupabase),
    loadOrEmpty('units', fetchUnitsFromSupabase),
  ])
  setCachedCategories(mapCategories(categories))
  setCachedUnits(mapUnits(units))
  setCachedProducts(products)

  await Promise.all([
    loadOrEmpty('customers', fetchCustomersFromSupabase, setCachedCustomers),
    loadOrEmpty('bills', fetchBillsFromSupabase, setCachedBills),
    loadOrEmpty('quotations', fetchQuotationsFromSupabase, setCachedQuotations),
    loadOrEmpty('appointments', fetchAppointmentsFromSupabase, setCachedAppointments),
    loadOrEmpty('finance', fetchTransactionsFromSupabase, setCachedTransactions),
    loadOrEmpty('notifications', fetchNotificationsFromSupabase, setCachedNotifications),
  ])
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
  setCachedTransactions([])
  setCachedRevenueLedger([])
  setCachedNotifications([])
}

export function MasterDataProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const { session, user, loading: authLoading } = useAuth()
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
  }, [sessionUserId, authLoading, canLoadShopData])

  // Other devices change data too: refresh when the tab comes back into view.
  useEffect(() => {
    if (authLoading || !canLoadShopData) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadAllBusinessData()
          .then(() => window.dispatchEvent(new Event('business_data_refreshed')))
          .catch((err: unknown) => console.error('Background refresh failed:', err))
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [authLoading, canLoadShopData])

  if (authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-500">
        <div className="flex flex-col items-center">
          <RefreshCw className="h-8 w-8 animate-spin mb-4" />
          <p className="font-semibold">กำลังตรวจสอบสิทธิ์...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-red-50 text-red-500 flex-col">
        <h2 className="text-2xl font-bold mb-4">เชื่อมต่อฐานข้อมูลล้มเหลว</h2>
        <p>{error.message}</p>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-500">
        <div className="flex flex-col items-center">
          <RefreshCw className="h-8 w-8 animate-spin mb-4" />
          <p className="font-semibold">กำลังโหลดข้อมูลระบบ...</p>
        </div>
      </div>
    )
  }

  return <MasterDataContext.Provider value={{ isLoaded, error }}>{children}</MasterDataContext.Provider>
}
