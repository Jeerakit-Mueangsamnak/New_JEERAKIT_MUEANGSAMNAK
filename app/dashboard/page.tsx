'use client'

import React, { useState, useEffect, Suspense, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { loadTransactions } from '@/features/finance/services/finance-storage'
import { loadBills } from '@/features/bills/services/bill-storage'
import { loadProducts } from '@/features/products/services/product-storage'
import { loadReservations } from '@/features/reservations/services/reservation-storage'
import { loadNotifications } from '@/features/notifications/services/notification-storage'
import { computeDashboardMetrics } from '@/features/dashboard/services/dashboard-data'
import { AssetsTransactionView } from '@/features/dashboard/components/AssetsTransactionView'
import { StockManagementView } from '@/features/dashboard/components/StockManagementView'
import { BusinessAnalyticsView } from '@/features/dashboard/components/BusinessAnalyticsView'

function DashboardContent() {
  const searchParams = useSearchParams()
  const viewParam = searchParams.get('view') || 'assets'
  const [refreshKey, setRefreshKey] = useState(0)

  // Listen to storage update events
  useEffect(() => {
    const handleStorageUpdate = () => {
      setRefreshKey((prev) => prev + 1)
    }
    window.addEventListener('storage', handleStorageUpdate)
    window.addEventListener('app-storage-update', handleStorageUpdate)
    window.addEventListener('app_settings_changed', handleStorageUpdate)
    return () => {
      window.removeEventListener('storage', handleStorageUpdate)
      window.removeEventListener('app-storage-update', handleStorageUpdate)
      window.removeEventListener('app_settings_changed', handleStorageUpdate)
    }
  }, [])

  // Compute metrics from actual domain persistence
  const metrics = useMemo(() => {
    const txs = loadTransactions()
    const bills = loadBills()
    const products = loadProducts()
    const reservations = loadReservations()
    const notifications = loadNotifications()

    return computeDashboardMetrics(txs, bills, products, reservations, notifications)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const handleManualRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const currentView = viewParam === 'stock' || viewParam === 'business' ? viewParam : 'assets'

  return (
    <div className="p-2 text-slate-900 dark:text-slate-100 min-w-0 max-w-full overflow-x-hidden space-y-2">
      {currentView === 'assets' && (
        <AssetsTransactionView metrics={metrics} onRefresh={handleManualRefresh} />
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
