'use client'

import React, { useState, useEffect, Suspense, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { loadTransactions } from '@/features/finance/services/finance-storage'
import { loadBills } from '@/features/bills/services/bill-storage'
import { loadProducts } from '@/features/products/services/product-storage'
import { loadReservations } from '@/features/reservations/services/reservation-storage'
import { loadNotifications } from '@/features/notifications/services/notification-storage'
import { loadAppointments } from '@/features/appointments/services/appointment-storage'
import { loadSystemSettings } from '@/features/settings/services/settings-storage'
import { loadAllBusinessData } from '@/components/common/MasterDataProvider'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import {
  dashboardAssigneeLookupEnabled,
  fetchDashboardAssigneeNames,
} from '@/features/dashboard/services/dashboard-assignee-service'
import { computeDashboardMetrics } from '@/features/dashboard/services/dashboard-data'
import { AssetsTransactionView } from '@/features/dashboard/components/AssetsTransactionView'
import { StockManagementView } from '@/features/dashboard/components/StockManagementView'
import { BusinessAnalyticsView } from '@/features/dashboard/components/BusinessAnalyticsView'

function DashboardContent() {
  const searchParams = useSearchParams()
  const viewParam = searchParams.get('view') || 'assets'
  const { hasMenu } = useAuth()
  const [refreshKey, setRefreshKey] = useState(0)
  const [assigneeNames, setAssigneeNames] = useState<Map<string, string>>(() => new Map())
  const [refreshError, setRefreshError] = useState('')

  const refreshAssigneeNames = useCallback(async () => {
    if (!dashboardAssigneeLookupEnabled()) {
      setAssigneeNames(new Map())
      return
    }
    setAssigneeNames(await fetchDashboardAssigneeNames())
  }, [])

  // Listen to storage update events
  useEffect(() => {
    const handleStorageUpdate = () => setRefreshKey((prev) => prev + 1)
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
    const txs = loadTransactions()
    const bills = loadBills()
    const products = loadProducts()
    const reservations = loadReservations()
    const notifications = loadNotifications()
    const appointments = loadAppointments()

    return computeDashboardMetrics(
      txs,
      bills,
      products,
      reservations,
      notifications,
      appointments,
      assigneeNames,
      loadSystemSettings().timezone
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, assigneeNames])

  const handleManualRefresh = useCallback(() => {
    setRefreshError('')
    void loadAllBusinessData()
      .then(refreshAssigneeNames)
      .then(() => setRefreshKey((key) => key + 1))
      .catch((error: unknown) => {
        setRefreshError(error instanceof Error ? error.message : String(error))
      })
  }, [refreshAssigneeNames])

  const currentView = viewParam === 'stock' || viewParam === 'business' ? viewParam : 'assets'

  return (
    <div className="p-2 text-slate-900 dark:text-slate-100 min-w-0 max-w-full overflow-x-hidden space-y-2">
      {refreshError && (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          รีเฟรชข้อมูลแดชบอร์ดไม่สำเร็จ: {refreshError}
        </div>
      )}
      {currentView === 'assets' && (
        <AssetsTransactionView metrics={metrics} onRefresh={handleManualRefresh} showFinance={hasMenu('finance')} />
      )}
      {currentView === 'stock' && (
        <StockManagementView metrics={metrics} onRefresh={handleManualRefresh} />
      )}
      {currentView === 'business' && (
        <BusinessAnalyticsView metrics={metrics} onRefresh={handleManualRefresh} />
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardContent />
    </Suspense>
  )
}
