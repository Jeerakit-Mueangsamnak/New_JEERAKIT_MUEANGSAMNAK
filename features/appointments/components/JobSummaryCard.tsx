'use client'

import React from 'react'
import { Calendar, Clock, MapPin, Phone, User } from 'lucide-react'
import { formatPhoneNumber, formatThaiNumericDate } from '@/lib/utils/format'

export interface JobSummaryCardProps {
  title: string
  /** Shown on the right of the title (e.g. the job status badge). */
  badge?: React.ReactNode
  customerName?: string | null
  phone?: string | null
  location?: string | null
  date?: string | null
  startTime?: string | null
  endTime?: string | null
  className?: string
  'data-testid'?: string
}

/**
 * The one job summary box (job details panel and the สั่งงาน dialog): job name, then
 * icon + customer, icon + phone, icon + delivery site, then calendar + date | clock + time. Long text wraps,
 * so the box grows in height only.
 */
export function JobSummaryCard({
  title,
  badge,
  customerName,
  phone,
  location,
  date,
  startTime,
  endTime,
  className = '',
  'data-testid': testId,
}: JobSummaryCardProps) {
  const row = 'flex items-start gap-1.5 min-w-0'
  const time = startTime ? `${startTime}${endTime ? ` - ${endTime}` : ''} น.` : '-'
  return (
    <div
      data-testid={testId}
      className={`bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5 ${className}`.trim()}
    >
      <div className="flex justify-between items-start gap-2">
        <h2 className="text-sm font-black text-slate-900 dark:text-slate-100 min-w-0 break-words">{title}</h2>
        {badge}
      </div>
      <p className={`${row} font-bold text-slate-900 dark:text-slate-100`}>
        <User className="w-4 h-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-label="ลูกค้า" />
        <span className="min-w-0 break-words">{customerName || '-'}</span>
      </p>
      <p className={`${row} font-mono font-bold text-blue-600 dark:text-blue-400`}>
        <Phone className="w-4 h-4 shrink-0" aria-label="เบอร์โทร" />
        <span className="min-w-0 break-words">{formatPhoneNumber(phone) || '-'}</span>
      </p>
      <p className={row}>
        <MapPin className="w-4 h-4 shrink-0 text-red-700 dark:text-red-400" aria-label="สถานที่จัดส่ง" />
        <span
          className={`min-w-0 whitespace-pre-line break-words ${location ? 'text-slate-800 dark:text-slate-200' : 'text-slate-600 dark:text-slate-400 italic'}`}
        >
          {location || 'ไม่ได้ระบุสถานที่'}
        </span>
      </p>
      {/* Last row: calendar icon + date | clock icon + time */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-semibold text-slate-700 dark:text-slate-300">
        <p className={row}>
          <Calendar className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" aria-label="วันที่" />
          <span data-testid="job-date" className="min-w-0 break-words">{date ? formatThaiNumericDate(date) : '-'}</span>
        </p>
        <p className={row}>
          <Clock className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" aria-label="เวลา" />
          <span data-testid="job-time" className="min-w-0 break-words">{time}</span>
        </p>
      </div>
    </div>
  )
}
