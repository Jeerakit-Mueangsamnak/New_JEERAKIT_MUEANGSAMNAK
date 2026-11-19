'use client'

import React, { useState, useMemo, useEffect, Suspense, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { loadAllBusinessData } from '@/components/common/MasterDataProvider'
import { fetchClosedBills } from '@/features/bills/services/bill-storage'
import { ensureRevenueLedgerSince, ensureTransactionsSince, fetchTransactionsFromSupabase } from '@/features/finance/services/finance-storage'
import { fetchQuotationsFromSupabase } from '@/features/quotations/services/quotation-storage'
import { getPreviousPeriod, toLocalDateString } from '@/features/reports/services/report-data-common'
import { useToast } from '@/components/common/Toast'
import { ReportFilter } from '@/features/reports/components/ReportFilter'
import { FinanceReportView } from '@/features/reports/components/FinanceReportView'
import { SalesRentalReportView } from '@/features/reports/components/SalesRentalReportView'
import { OperationsReportView } from '@/features/reports/components/OperationsReportView'
import { StockReportView } from '@/features/reports/components/StockReportView'
import { BusinessReportView } from '@/features/reports/components/BusinessReportView'
import {
  ReportDateFilter,
  getFinanceReportData,
  getSalesRentalReportData,
  getOperationsReportData,
  getStockReportData,
  getBusinessReportData,
} from '@/features/reports/services/report-data'

/** The report views the menu offers (?view=…). */
const REPORT_VIEWS = ['finance', 'sales-rental', 'operations', 'stock', 'business'] as const

function getInitialDates(): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  return { start, end }
}

function ReportsWorkspace() {
  const searchParams = useSearchParams()
  const currentView = searchParams.get('view') || 'finance'
  const knownView = (REPORT_VIEWS as readonly string[]).includes(currentView)
  const { showToast } = useToast()

  // Date filter state
  const initial = useMemo(() => getInitialDates(), [])
  const [startDate, setStartDate] = useState<Date>(initial.start)
  const [endDate, setEndDate] = useState<Date>(initial.end)
  const [preset, setPreset] = useState<string>('this_month')
  const [granularity, setGranularity] = useState<'daily' | 'monthly'>('daily')
  const [refreshKey, setRefreshKey] = useState<number>(0)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  // The app keeps only bills still in work loaded: finished bills of the report period, and of the
  // period before it (comparison), are read from the server whenever the period changes.
  const [rangeLoadKey, setRangeLoadKey] = useState<number>(0)
  // The reports show only once the period's data is in: no figure from an older read shows meanwhile.
  const [rangeReady, setRangeReady] = useState<boolean>(false)
  useEffect(() => {
    let alive = true
    setRangeReady(false)
    const { prevStart } = getPreviousPeriod(startDate, endDate)
    // Finished bills, money rows and revenue lines of this period and the one before; money is not read at
    // app start (owner 2026-11-20): read here unless the last read is under a minute old.
    Promise.all([
      fetchClosedBills({ from: toLocalDateString(prevStart), to: toLocalDateString(endDate) }),
      ensureTransactionsSince(prevStart),
      ensureRevenueLedgerSince(prevStart),
      // Quotations are not loaded at app start (audit 2026-11-12); 60 s cache
      fetchQuotationsFromSupabase(false),
    ])
      .then(() => {
        if (alive) setRangeLoadKey((k) => k + 1)
      })
      .catch((err: unknown) => {
        console.error('Report data load failed:', err)
        if (alive) showToast('โหลดข้อมูลรายงานไม่สำเร็จ', 'กรุณากดรีเฟรชอีกครั้ง', 'ERROR')
      })
      .finally(() => {
        if (alive) setRangeReady(true)
      })
    return () => {
      alive = false
    }
  }, [startDate, endDate, refreshKey, showToast])

  // Handle Preset Changes
  const handlePresetChange = useCallback((newPreset: string) => {
    setPreset(newPreset)
    const now = new Date()
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

    if (newPreset === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
      setStartDate(todayStart)
      setEndDate(todayEnd)
      setGranularity('daily')
    } else if (newPreset === 'last_7_days') {
      const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)
      start.setHours(0, 0, 0, 0)
      setStartDate(start)
      setEndDate(todayEnd)
      setGranularity('daily')
    } else if (newPreset === 'last_30_days') {
      const start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)
      start.setHours(0, 0, 0, 0)
      setStartDate(start)
      setEndDate(todayEnd)
      setGranularity('daily')
    } else if (newPreset === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)
      setStartDate(start)
      setEndDate(todayEnd)
      setGranularity('daily')
    } else if (newPreset === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0)
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
      setStartDate(start)
      setEndDate(end)
      setGranularity('daily')
    } else if (newPreset === 'this_year') {
      const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0)
      setStartDate(start)
      setEndDate(todayEnd)
      setGranularity('monthly')
    } else if (newPreset === 'all') {
      const start = new Date(2020, 0, 1, 0, 0, 0)
      setStartDate(start)
      setEndDate(todayEnd)
      setGranularity('monthly')
    }
  }, [])

  const handleStartDateChange = useCallback((d: Date | null) => {
    if (d) {
      setStartDate(d)
      setPreset('custom')
    }
  }, [])

  const handleEndDateChange = useCallback((d: Date | null) => {
    if (d) {
      setEndDate(d)
      setPreset('custom')
    }
  }, [])

  // รีเฟรช = reload the latest data from the server, then recompute the reports.
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    const { prevStart } = getPreviousPeriod(startDate, endDate)
    void Promise.all([loadAllBusinessData(), fetchTransactionsFromSupabase(), ensureRevenueLedgerSince(prevStart, true)])
      .catch((err: unknown) => {
        console.error('Report refresh failed:', err)
        showToast('รีเฟรชรายงานไม่สำเร็จ', 'โหลดข้อมูลล่าสุดไม่ได้ หน้าจอยังแสดงข้อมูลชุดเดิม กรุณาลองกดรีเฟรชอีกครั้ง', 'ERROR')
      })
      .finally(() => {
        setRefreshKey((k) => k + 1)
        setIsRefreshing(false)
      })
  }, [showToast, startDate, endDate])

  // Filter Object
  const filter: ReportDateFilter = useMemo(
    () => ({
      startDate,
      endDate,
      granularity,
    }),
    // refreshKey / rangeLoadKey are intentional: the refresh button and the period's bills arriving
    // need a new filter object so the reports below recompute
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startDate, endDate, granularity, refreshKey, rangeLoadKey]
  )

  // Report Data
  const financeData = useMemo(() => {
    if (currentView === 'finance') return getFinanceReportData(filter)
    return null
  }, [currentView, filter])

  const salesRentalData = useMemo(() => {
    if (currentView === 'sales-rental') return getSalesRentalReportData(filter)
    return null
  }, [currentView, filter])

  const operationsData = useMemo(() => {
    if (currentView === 'operations') return getOperationsReportData(filter)
    return null
  }, [currentView, filter])

  const stockData = useMemo(() => {
    if (currentView === 'stock') return getStockReportData(filter)
    return null
  }, [currentView, filter])

  const businessData = useMemo(() => {
    if (currentView === 'business') return getBusinessReportData(filter)
    return null
  }, [currentView, filter])

  return (
    <div className="p-2 space-y-2 min-h-full bg-slate-50/50 dark:bg-black text-slate-900 dark:text-slate-100 select-none">
      {/* ─── Global Compact Filter Bar ────────────────────────────────────────── */}
      <ReportFilter
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={handleStartDateChange}
        onEndDateChange={handleEndDateChange}
        preset={preset}
        onPresetChange={handlePresetChange}
        granularity={granularity}
        onGranularityChange={setGranularity}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {/* ─── Report Content By View ────────────────────────────────────────── */}
      {rangeReady && currentView === 'finance' && financeData && (
        <FinanceReportView data={financeData} />
      )}

      {rangeReady && currentView === 'sales-rental' && salesRentalData && (
        <SalesRentalReportView data={salesRentalData} />
      )}

      {rangeReady && currentView === 'operations' && operationsData && (
        <OperationsReportView data={operationsData} />
      )}

      {rangeReady && currentView === 'stock' && stockData && (
        <StockReportView data={stockData} />
      )}

      {rangeReady && currentView === 'business' && businessData && (
        <BusinessReportView data={businessData} />
      )}

      {!rangeReady && knownView && (
        <div className="p-4 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-center min-h-[200px]">
          กำลังโหลดข้อมูลรายงานสรุป...
        </div>
      )}

      {!knownView && (
        <div role="alert" className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-sm font-bold text-slate-600 dark:text-slate-400">
          ไม่พบรายงานที่เลือก กรุณาเลือกรายงานจากเมนูด้านซ้าย
        </div>
      )}
    </div>
  )
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-center min-h-[200px]">
          กำลังโหลดข้อมูลรายงานสรุป...
        </div>
      }
    >
      <ReportsWorkspace />
    </Suspense>
  )
}
