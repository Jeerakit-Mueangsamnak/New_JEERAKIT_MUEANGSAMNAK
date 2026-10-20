'use client'

import React from 'react'
import { Calendar, Clock } from 'lucide-react'
import { useLiveClock } from '@/lib/hooks/useLiveClock'

/**
 * Date + time pill of the app header. Its own component so the per-second tick re-renders
 * only this pill, not the whole Sidebar / TopHeader.
 */
export function LiveClockBadge({ variant }: { variant: 'header' | 'mobile' }) {
  const { currentDateStr, currentTimeStr } = useLiveClock()

  if (variant === 'header') {
    return (
      <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700/80 text-xs text-slate-700 dark:text-slate-300 font-semibold shadow-xs">
        <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span>{currentDateStr || 'กำลังโหลด...'}</span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
        <span className="font-mono text-slate-900 dark:text-slate-100 font-bold">{currentTimeStr}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700/80 text-[11px] sm:text-xs text-slate-700 dark:text-slate-300 font-semibold shadow-xs">
      <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 hidden sm:block" />
      <span className="hidden md:inline">{currentDateStr || 'กำลังโหลด...'}</span>
      <span className="text-slate-300 dark:text-slate-600 hidden md:inline">|</span>
      <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
      <span className="font-mono text-slate-900 dark:text-slate-100 font-bold shrink-0">{currentTimeStr}</span>
    </div>
  )
}
