'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { ActionButton, SEARCH_ICON_CLASSES, SEARCH_INPUT_CLASSES, TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { toggleRowOnDoubleClick } from '@/components/common/row-selection'
import { listLinePeople, type LinePeopleView, type LinePerson } from '@/app/actions/line'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { useAutoFitPageSize } from '@/lib/hooks/useAutoFitPageSize'
import { LineContactDetail } from '@/features/settings/components/line/LineContactDetail'
import { LinePersonAvatar } from '@/features/settings/components/line/LinePersonAvatar'
import { friendPill, kindPill, linkPill, personPhone, PILL_TONE, registerPill, thaiDateTime, type Pill } from '@/features/settings/components/line/line-people-model'

const PILL = 'inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold whitespace-nowrap'

const PillView = ({ pill }: { pill: Pill }) => <span className={`${PILL} ${PILL_TONE[pill.tone]}`}>{pill.text}</span>

/** Staff and drivers in one list (owner 2026-11-26): a shop has few, so both lists are read whole (50 each). */
const TEAM_READ = 50
/** Rows asked from the database at a time (its most per call). */
const CHUNK = 50
const lastSeen = (p: LinePerson) => p.last_event_at ?? p.created_at

/**
 * One list of people (owner 2026-11-21): searched by the database, never the whole table. No ย้อนกลับ / ถัดไป
 * (owner 2026-11-28: a list table): it scrolls like the other tables and more rows are read as it nears the bottom.
 * Every list of คนใน LINE is this component with a different `view`; TEAM = staff and drivers.
 * `tabs` = what is drawn first in the toolbar row (a title or a filter).
 */
export function LinePeopleList({
  view,
  tabs,
  isOwner,
  onChanged,
  actions,
  searchable = true,
  pickedId,
  onPick,
}: {
  view: LinePeopleView | 'TEAM'
  tabs: ReactNode
  isOwner: boolean
  onChanged: () => void
  actions?: ReactNode
  /** false = no search box (สมาชิก, owner 2026-11-28); with nothing else to show the toolbar row goes too. */
  searchable?: boolean
  /** สมาชิก (owner 2026-11-28): a double-click picks the row (again = unpick) for the buttons on the right;
   *  details then open from ดูรายละเอียด only. Without onPick a tap on the row opens the details. */
  pickedId?: string | null
  onPick?: (person: LinePerson | null) => void
}) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<LinePerson[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // typing waits a moment before it asks the database; a new list or search starts again from the top
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const autoFit = useAutoFitPageSize({ totalItems: total, step: CHUNK, activeKey: `${view}|${query}` })
  const want = autoFit.pageSize

  const load = useCallback(async () => {
    if (view === 'TEAM') {
      const [s, d] = await Promise.all([listLinePeople('STAFF', query, 0, TEAM_READ), listLinePeople('DRIVERS', query, 0, TEAM_READ)])
      if (!alive.current) return
      if (!s.success || !s.data || !d.success || !d.data) {
        setError((!s.success ? s.error : !d.success ? d.error : null) || 'โหลดรายชื่อไม่สำเร็จ')
        return
      }
      const all = [...s.data.rows, ...d.data.rows].sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)))
      setError(null)
      setRows(all)
      setTotal(all.length)
      return
    }
    // the rows down to where the list has been scrolled, read 50 at a time
    const got: LinePerson[] = []
    let count = 0
    for (let from = 0; from < want; from += CHUNK) {
      const r = await listLinePeople(view, query, from, CHUNK)
      if (!alive.current) return
      if (!r.success || !r.data) {
        setError(r.error || 'โหลดรายชื่อไม่สำเร็จ')
        return
      }
      got.push(...r.data.rows)
      count = r.data.total
      if (r.data.rows.length < CHUNK) break
    }
    setError(null)
    setRows(got)
    setTotal(count)
  }, [view, query, want])
  // a person who answers in LINE shows up by itself (no รีเฟรช button); a minute is enough for a list
  useAutoRefresh(load, 60_000)

  const selected = rows.find((r) => r.id === selectedId) ?? null

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {(searchable || tabs || actions) && (
      <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-col sm:flex-row items-stretch sm:items-center`}>
        {tabs}
        {actions && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{actions}</div>}
        {searchable && (
        <div className="relative flex-1 min-w-0">
          <Search className={SEARCH_ICON_CLASSES} />
          <input
            type="text"
            aria-label="ค้นหาคนใน LINE"
            placeholder="ค้นหาชื่อ LINE ชื่อ/เบอร์ที่แจ้ง ชื่อลูกค้า..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={SEARCH_INPUT_CLASSES}
          />
        </div>
        )}
      </div>
      )}
      {error && <p className="m-3 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">{error}</p>}
      <DataTableFrame fill scrollRef={autoFit.containerRef} rowCount={total} shownCount={rows.length} className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent">
        <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} data-testid={`line-people-${view}`}>
          <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
            <tr>
              <th className={`px-3 ${DATA_TABLE_TH_CLASSES}`}>ชื่อใน LINE</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>เพิ่มเพื่อนเมื่อ</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>ชื่อ / เบอร์</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>สถานะ</th>
              <th className={`px-3 text-right ${DATA_TABLE_TH_CLASSES}`}>จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {rows.map((p) => {
              const phone = personPhone(p)
              return (
                <tr
                  key={p.id}
                  onClick={onPick ? undefined : () => setSelectedId(p.id)}
                  onDoubleClick={onPick ? (e) => toggleRowOnDoubleClick(e, () => onPick(pickedId === p.id ? null : p)) : undefined}
                  aria-selected={onPick ? pickedId === p.id : undefined}
                  className={`cursor-pointer transition-colors ${
                    onPick && pickedId === p.id ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'hover:bg-slate-50/80 dark:hover:bg-slate-700/30'
                  }`}
                >
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <LinePersonAvatar name={p.display_name} pictureUrl={p.picture_url} />
                      <b className="truncate text-slate-900 dark:text-slate-100">{p.display_name || 'LINE ที่ไม่ทราบชื่อ'}</b>
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">{thaiDateTime(p.followed_at)}</td>
                  <td className="px-2 py-2 text-slate-800 dark:text-slate-200">
                    <span className="block font-semibold">{p.customer_name || p.profile_name || p.typed_name || 'ยังไม่ระบุชื่อ'}</span>
                    <span className="block tabular-nums text-slate-600 dark:text-slate-400">{phone ?? 'ยังไม่ระบุเบอร์'}</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="flex flex-wrap gap-1">
                      <PillView pill={friendPill(p)} />
                      <PillView pill={registerPill(p)} />
                      <PillView pill={linkPill(p)} />
                        {!!p.restriction_count && <PillView pill={{ text: `ระงับ ${p.restriction_count} ประเภท`, tone: 'red' }} />}
                      <PillView pill={kindPill(p)} />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <ActionButton
                      variant="info"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedId(p.id)
                      }}
                    >
                      ดูรายละเอียด
                    </ActionButton>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
      {selected && (
        <LineContactDetail
          person={selected}
          isOwner={isOwner}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            void load()
            onChanged()
          }}
        />
      )}
    </div>
  )
}
