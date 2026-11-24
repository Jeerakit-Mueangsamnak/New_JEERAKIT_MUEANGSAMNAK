'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { COMMAND_BUTTON_SIZE_CLASSES, SEARCH_ICON_CLASSES, SEARCH_INPUT_CLASSES, TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { listLinePeople, type LinePeopleView, type LinePerson } from '@/app/actions/line'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { LineContactDetail } from '@/features/settings/components/line/LineContactDetail'
import { LinePersonAvatar } from '@/features/settings/components/line/LinePersonAvatar'
import { friendPill, kindPill, linkPill, personPhone, PILL_TONE, registerPill, thaiDateTime, type Pill } from '@/features/settings/components/line/line-people-model'

const PAGE = 25
const PILL = 'inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold whitespace-nowrap'

const PillView = ({ pill }: { pill: Pill }) => <span className={`${PILL} ${PILL_TONE[pill.tone]}`}>{pill.text}</span>

/**
 * One list of people (owner 2026-11-21): a page of 25 from the database, searched by the database, never the whole table.
 * Every list of คนใน LINE that is not staff / drivers is this component with a different `view`.
 * `tabs` = the page menu, drawn first in the toolbar row like the other LINE pages.
 */
export function LinePeopleList({ view, tabs, isOwner, onChanged }: { view: LinePeopleView; tabs: ReactNode; isOwner: boolean; onChanged: () => void }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
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

  // typing waits a moment before it asks the database; a new list or search starts from page 1
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => setOffset(0), [view])

  const load = useCallback(async () => {
    const r = await listLinePeople(view, query, offset)
    if (!alive.current) return
    if (!r.success || !r.data) {
      setError(r.error || 'โหลดรายชื่อไม่สำเร็จ')
      return
    }
    setError(null)
    setRows(r.data.rows)
    setTotal(r.data.total)
  }, [view, query, offset])
  // a person who answers in LINE shows up by itself (no รีเฟรช button); a minute is enough for a list
  useAutoRefresh(load, 60_000)

  const selected = rows.find((r) => r.id === selectedId) ?? null
  const pageBtn = 'inline-flex items-center border border-slate-300 dark:border-slate-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed'
  const prev = (
    <button type="button" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))} className={`${COMMAND_BUTTON_SIZE_CLASSES} ${pageBtn}`}>
      <ChevronLeft className="w-3.5 h-3.5" /> ย้อนกลับ
    </button>
  )
  const next = (
    <button type="button" disabled={offset + PAGE >= total} onClick={() => setOffset((o) => o + PAGE)} className={`${COMMAND_BUTTON_SIZE_CLASSES} ${pageBtn}`}>
      ถัดไป <ChevronRight className="w-3.5 h-3.5" />
    </button>
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-col sm:flex-row items-stretch sm:items-center`}>
        {tabs}
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
      </div>
      {error && <p className="m-3 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">{error}</p>}
      <DataTableFrame fill rowCount={total} shownCount={rows.length} countBarStart={prev} countBarEnd={next} className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent">
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
                <tr key={p.id} onClick={() => setSelectedId(p.id)} className="cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
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
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedId(p.id)
                      }}
                      className={`${COMMAND_BUTTON_SIZE_CLASSES} text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer`}
                    >
                      ดูรายละเอียด
                    </button>
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
