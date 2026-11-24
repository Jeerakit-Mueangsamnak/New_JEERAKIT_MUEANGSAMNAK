'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ensureTransactionsSince,
  fetchTransactionsFromSupabase,
  isTransactionsFresh,
  loadTransactions,
  type StatementTransaction,
} from '@/features/finance/services/finance-storage'

/**
 * Statement rows for a money screen (owner 2026-11-20): read when the screen opens (or comes back into view)
 * unless the last read is under a minute old and reaches `since`. While a read runs `loading` is true and no
 * rows are given, so no old figure shows; a money step on a bill updates the rows in place (finance_updated).
 */
export function useFinanceRows(since?: Date | null): {
  rows: StatementTransaction[]
  loading: boolean
  reload: () => Promise<void>
} {
  const [loading, setLoading] = useState(() => !isTransactionsFresh(since))
  const [rows, setRows] = useState<StatementTransaction[]>(() => (isTransactionsFresh(since) ? loadTransactions() : []))
  const [visibleTick, setVisibleTick] = useState(0)
  const sinceTime = since && !Number.isNaN(since.getTime()) ? since.getTime() : null

  useEffect(() => {
    let alive = true
    const from = sinceTime === null ? null : new Date(sinceTime)
    if (isTransactionsFresh(from)) {
      setRows(loadTransactions())
      setLoading(false)
      return
    }
    setLoading(true)
    setRows([])
    ensureTransactionsSince(from)
      .then((list) => {
        if (alive) setRows(list)
      })
      .catch((err: unknown) => console.error('Reading money rows failed:', err))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [sinceTime, visibleTick])

  useEffect(() => {
    const fromCache = () => setRows(loadTransactions())
    const onVisible = () => {
      if (document.visibilityState === 'visible') setVisibleTick((t) => t + 1)
    }
    window.addEventListener('finance_updated', fromCache)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('finance_updated', fromCache)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setRows([])
    try {
      setRows(await fetchTransactionsFromSupabase())
    } finally {
      setLoading(false)
    }
  }, [])

  return { rows, loading, reload }
}
