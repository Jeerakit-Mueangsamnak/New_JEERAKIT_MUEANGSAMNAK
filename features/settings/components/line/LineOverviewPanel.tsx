'use client'

import { type ReactNode } from 'react'
import { CountUp } from '@/components/common/CountUp'
import { TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'
import { type LinePeopleCounts, type LinePeopleView } from '@/app/actions/line'
import { PEOPLE_VIEW_LABEL } from '@/features/settings/components/line/line-people-model'
import { LineQrCards, type LineOaInfo } from '@/features/settings/components/line/LineQrCards'

/**
 * ภาพรวม: how many people are in each list (one small answer from the database, never a download of the lists).
 * A tile opens its list. On top: the customer / staff QR cards (owner 2026-11-25, line.html).
 */
const TILES: ReadonlyArray<{ view: LinePeopleView; key: keyof LinePeopleCounts; alert?: boolean }> = [
  { view: 'ALL', key: 'all' },
  { view: 'PENDING', key: 'pending', alert: true },
  { view: 'NEEDINFO', key: 'needinfo', alert: true },
  { view: 'UNREG', key: 'unreg' },
  { view: 'GENERAL', key: 'general' },
  { view: 'CUSTOMERS', key: 'customers' },
  { view: 'STAFF', key: 'staff' },
  { view: 'DRIVERS', key: 'drivers' },
  { view: 'REJECTED', key: 'rejected' },
  { view: 'UNLINKED', key: 'unlinked' },
  { view: 'BLOCKED', key: 'blocked' },
]

export function LineOverviewPanel({ tabs, counts, onOpen, oa = null, isOwner = false }: { tabs: ReactNode; counts: LinePeopleCounts | null; onOpen: (view: LinePeopleView) => void; oa?: LineOaInfo | null; isOwner?: boolean }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex items-center`}>{tabs}</div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <LineQrCards oa={oa} isOwner={isOwner} />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2" data-testid="line-overview">
          {TILES.map((t) => {
            const n = counts?.[t.key] ?? 0
            const attention = t.alert && n > 0
            return (
              <button
                key={t.view}
                type="button"
                onClick={() => onOpen(t.view)}
                className={`text-left rounded-xl border p-3 cursor-pointer transition-colors ${
                  attention
                    ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40'
                }`}
              >
                <span className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">{PEOPLE_VIEW_LABEL[t.view]}</span>
                <span className="block text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                  <CountUp value={n} /> <span className="text-xs font-bold">คน</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
