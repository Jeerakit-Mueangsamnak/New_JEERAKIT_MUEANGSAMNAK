'use client'

import React from 'react'
import { Calendar, Clock } from 'lucide-react'
import { useLiveClock } from '@/lib/hooks/useLiveClock'
import { HEADER_CONTROL_CLASSES } from '@/components/common/ActionButton'

/**
 * Date + time pill of the app header. Its own component so the per-second tick re-renders
 * only this pill, not the whole TopHeader. The date hides on narrow screens.
 */
export function LiveClockBadge() {
  const { currentDateStr, currentTimeStr } = useLiveClock()

  return (
    <div className={`${HEADER_CONTROL_CLASSES} gap-1.5 sm:gap-2 px-2.5 sm:px-3 text-[11px] sm:text-xs text-slate-700 dark:text-slate-300 font-semibold`}>
      <Calendar className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0 hidden sm:block" />
      <span className="hidden md:inline">{currentDateStr || 'กำลังโหลด...'}</span>
      <span className="text-slate-300 dark:text-slate-400 hidden md:inline">|</span>
      <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
      <span className="font-mono text-slate-900 dark:text-slate-100 font-bold shrink-0">{currentTimeStr}</span>
    </div>
  )
}
