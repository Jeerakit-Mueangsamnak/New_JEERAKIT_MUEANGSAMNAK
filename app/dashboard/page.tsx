'use client'

import React, { useState, useEffect, Suspense, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useFinanceRows } from '@/features/finance/hooks/useFinanceRows'
import { loadBills, countCancelledBills } from '@/features/bills/services/bill-storage'
import { loadProducts } from '@/features/products/services/product-storage'
import { loadReservations } from '@/features/reservations/services/reservation-storage'
import { loadNotifications } from '@/features/notifications/services/notification-storage'
import { fetchAppointmentsFromSupabase, loadAppointments } from '@/features/appointments/services/appointment-storage'
import { loadSystemSettings } from '@/features/settings/services/settings-storage'
import { loadAllBusinessData } from '@/components/common/MasterDataProvider'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import {
  dashboardAssigneeLookupEnabled,
  fetchDashboardAssigneeNames,
} from '@/features/dashboard/services/dashboard-assignee-service'
import { computeDashboardMetrics } from '@/features/dashboard/services/dashboard-data'
import { AssetsTransactionView } from '@/features/dashboard/components/AssetsTransactionView'

// The stock and business tabs (charts) load only when opened
const StockManagementView = dynamic(
  () => import('@/features/dashboard/components/StockManagementView').then((m) => m.StockManagementView),
  { ssr: false }
)
const BusinessAnalyticsView = dynamic(
  () => import('@/features/dashboard/components/BusinessAnalyticsView').then((m) => m.BusinessAnalyticsView),
  { ssr: false }
)

/** Several data events arrive together after a save: recompute once, 300 ms after the last. */
const STORAGE_UPDATE_DEBOUNCE_MS = 300

function DashboardContent() {
  const searchParams = useSearchParams()
  const viewParam = searchParams.get('view') || 'assets'
  const { hasMenu } = useAuth()
  const [refreshKey, setRefreshKey] = useState(0)
  const [assigneeNames, setAssigneeNames] = useState<Map<string, string>>(() => new Map())
  const [refreshError, setRefreshError] = useState('')
  // Cancelled / void bills are not kept loaded: their number comes from a server count.
  const [cancelledCount, setCancelledCount] = useState<number | null>(null)
  // Money rows are read when the dashboard opens (owner 2026-11-20), not at app start.
  const { rows: moneyRows, loading: moneyLoading, reload: reloadMoney } = useFinanceRows()
  // Appointments are not loaded at app start (audit 2026-11-12): read here (60 s cache), then the cards redraw.
  useEffect(() => {
    let alive = true
    fetchAppointmentsFromSupabase(false)
      .then(() => {
        if (alive) setRefreshKey((k) => k + 1)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    let alive = true
    countCancelledBills()
      .then((n) => {
        if (alive) setCancelledCount(n)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [refreshKey])

  const refreshAssigneeNames = useCallback(async () => {
    if (!dashboardAssigneeLookupEnabled()) {
      setAssigneeNames(new Map())
      return
    }
    setAssigneeNames(await fetchDashboardAssigneeNames())
  }, [])

  // Listen to storage update events
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const handleStorageUpdate = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setRefreshKey((prev) => prev + 1), STORAGE_UPDATE_DEBOUNCE_MS)
    }
    const handleBusinessRefresh = () => {
      handleStorageUpdate()
      void refreshAssigneeNames().catch((error: unknown) => {
        setAssigneeNames(new Map())
        setRefreshError(error instanceof Error ? error.message : String(error))
      })
    }
    window.addEventListener('storage', handleStorageUpdate)
    window.addEventListener('app-storage-update', handleStorageUpdate)
    window.addEventListener('app_settings_changed', handleStorageUpdate)
    window.addEventListener('bills_updated', handleStorageUpdate)
    window.addEventListener('products_updated', handleStorageUpdate)
    window.addEventListener('business_data_refreshed', handleBusinessRefresh)
    void refreshAssigneeNames().catch((error: unknown) => {
      setAssigneeNames(new Map())
      setRefreshError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('storage', handleStorageUpdate)
      window.removeEventListener('app-storage-update', handleStorageUpdate)
      window.removeEventListener('app_settings_changed', handleStorageUpdate)
      window.removeEventListener('bills_updated', handleStorageUpdate)
      window.removeEventListener('products_updated', handleStorageUpdate)
      window.removeEventListener('business_data_refreshed', handleBusinessRefresh)
    }
  }, [refreshAssigneeNames])

  // Compute metrics from actual domain persistence
  const metrics = useMemo(() => {
    const txs = moneyRows
    const bills = loadBills()
    const products = loadProducts()
    const reservations = loadReservations()
    const notifications = loadNotifications()
    const appointments = loadAppointments()

    const computed = computeDashboardMetrics(
      txs,
      bills,
      products,
      reservations,
      notifications,
      appointments,
      assigneeNames,
      loadSystemSettings().timezone
    )
    if (cancelledCount !== null) computed.billStatusCounts.cancelled = cancelledCount
    return computed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, assigneeNames, cancelledCount, moneyRows])

  const handleManualRefresh = useCallback(() => {
    setRefreshError('')
    void Promise.all([loadAllBusinessData(), reloadMoney()])
      .then(refreshAssigneeNames)
      .then(() => setRefreshKey((key) => key + 1))
      .catch((error: unknown) => {
        setRefreshError(error instanceof Error ? error.message : String(error))
      })
  }, [refreshAssigneeNames, reloadMoney])

  const currentView = viewParam === 'stock' || viewParam === 'business' ? viewParam : 'assets'

  return (
    <div className="p-2 text-slate-900 dark:text-slate-100 min-w-0 max-w-full overflow-x-hidden space-y-2">
      {refreshError && (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          รีเฟรชข้อมูลแดชบอร์ดไม่สำเร็จ: {refreshError}
        </div>
      )}
      {currentView === 'assets' && (
        <AssetsTransactionView metrics={metrics} onRefresh={handleManualRefresh} showFinance={hasMenu('finance')} moneyLoading={moneyLoading} />
      )}
      {currentView === 'stock' && (
        <StockManagementView metrics={metrics} onRefresh={handleManualRefresh} />
      )}
      {/* Revenue charts and payment channels come from the money rows: shown once they are read. */}
      {currentView === 'business' && moneyLoading && (
        <div className="p-4 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-center min-h-[200px]">
          กำลังโหลดแดชบอร์ด...
        </div>
      )}
      {currentView === 'business' && !moneyLoading && (
        <BusinessAnalyticsView metrics={metrics} onRefresh={handleManualRefresh} />
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-center min-h-[200px]">
          กำลังโหลดแดชบอร์ด...
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  )
}
