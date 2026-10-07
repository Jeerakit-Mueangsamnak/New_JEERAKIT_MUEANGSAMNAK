'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

export interface UseAutoFitPageSizeOptions {
  /** Total number of items */
  totalItems: number
  /** Rows rendered first and added each time the user scrolls near the bottom (default 60). */
  step?: number
  /** Changing this (tab / view) starts again from the top. */
  activeKey?: unknown
  /** Kept for old callers; ignored. */
  defaultRowHeight?: number
  defaultHeaderHeight?: number
  extraOffset?: number
  minPageSize?: number
  initialPageSize?: number
}

export interface UseAutoFitPageSizeResult {
  /** Put on the table's scroll container (overflow-y-auto, sticky thead). */
  containerRef: React.RefObject<HTMLDivElement>
  pageSize: number
  /** Always 1: there are no pages any more. */
  currentPage: number
  /** Any call resets the list to the first rows and scrolls to the top (used when filters change). */
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>
  totalPages: number
  startIndex: number
  endIndex: number
}

/**
 * Table rows without paging: the table scrolls inside its own area (sticky header) and more
 * rows are rendered as the user nears the bottom (incremental loading), so long lists stay
 * smooth. Name kept so existing tables keep working with `slice(startIndex, endIndex)`.
 */
export function useAutoFitPageSize({ totalItems, step = 60, activeKey }: UseAutoFitPageSizeOptions): UseAutoFitPageSizeResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(step)

  const reset = useCallback(() => {
    setVisible(step)
    containerRef.current?.scrollTo({ top: 0 })
  }, [step])

  useEffect(() => {
    reset()
  }, [activeKey, reset])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const loadMore = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
        setVisible((v) => (v < totalItems ? v + step : v))
      }
    }
    // A tall screen may show every rendered row without a scrollbar: keep filling.
    loadMore()
    el.addEventListener('scroll', loadMore, { passive: true })
    return () => el.removeEventListener('scroll', loadMore)
  }, [totalItems, step, visible, activeKey])

  const setCurrentPage = useCallback<React.Dispatch<React.SetStateAction<number>>>(() => reset(), [reset])
  const endIndex = Math.min(visible, totalItems)

  return {
    containerRef,
    pageSize: visible,
    currentPage: 1,
    setCurrentPage,
    totalPages: 1,
    startIndex: 0,
    endIndex,
  }
}
