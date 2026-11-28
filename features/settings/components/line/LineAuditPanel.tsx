'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { listLineAudit, type LineAuditRow } from '@/app/actions/line'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { useAutoFitPageSize } from '@/lib/hooks/useAutoFitPageSize'
import { thaiDateTime } from '@/features/settings/components/line/line-people-model'

/** ประวัติการตรวจสอบ (OWNER): who did what in LINE, newest first; no ย้อนกลับ / ถัดไป, 50 more are read as it scrolls down. */
const PAGE = 50
const ACTION: Record<string, string> = {
  LINE_REGISTER: 'ส่งคำขอลงทะเบียน',
  LINE_REGISTER_APPROVE: 'อนุมัติลงทะเบียน',
  LINE_REGISTER_NEED_INFO: 'ขอข้อมูลเพิ่ม',
  LINE_CONTACT_REJECT: 'ปฏิเสธ',
  LINE_LINK: 'ผูกบัญชี',
  LINE_UNLINK: 'ยกเลิกการผูก',
  LINE_CONTACT_UNLINK: 'ยกเลิกการผูก',
  LINE_SHOP_MESSAGE: 'ร้านส่งข้อความ',
  LINE_CODE_REVOKE: 'ยกเลิกรหัสเชิญ',
  CUSTOMER_CREATE: 'สร้างลูกค้า',
}

export function LineAuditPanel({ tabs }: { tabs: ReactNode }) {
  const [rows, setRows] = useState<LineAuditRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  // one more than what is read while the database has more, so scrolling to the bottom asks for the next 50
  const autoFit = useAutoFitPageSize({ totalItems: rows.length + (more ? 1 : 0), step: PAGE })
  const want = autoFit.pageSize

  const load = useCallback(async () => {
    const got: LineAuditRow[] = []
    let full = false
    for (let from = 0; from < want; from += PAGE) {
      const r = await listLineAudit(from)
      if (!r.success || !r.data) return setError(r.error || 'โหลดประวัติไม่สำเร็จ')
      got.push(...r.data)
      full = r.data.length === PAGE
      if (!full) break
    }
    setError(null)
    setRows(got)
    setMore(full)
  }, [want])
  useAutoRefresh(load, 120_000)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex items-center`}>{tabs}</div>
      {error && <p className="m-3 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">{error}</p>}
      <DataTableFrame
        fill
        scrollRef={autoFit.containerRef}
        rowCount={rows.length}
        className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent"
      >
        <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} data-testid="line-audit">
          <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
            <tr>
              <th className={`px-3 ${DATA_TABLE_TH_CLASSES}`}>เมื่อ</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>ใครทำ</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>ทำอะไร</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>ผล</th>
              <th className={`px-3 ${DATA_TABLE_TH_CLASSES}`}>เหตุผล / รายละเอียด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">{thaiDateTime(a.created_at)}</td>
                <td className="px-2 py-2 text-slate-900 dark:text-slate-100">{a.actor}</td>
                <td className="px-2 py-2 font-semibold text-slate-900 dark:text-slate-100">{ACTION[a.action] ?? a.action}</td>
                <td className="px-2 py-2 text-slate-800 dark:text-slate-200">{a.result === 'SUCCESS' ? 'สำเร็จ' : 'ไม่สำเร็จ'}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 break-all">{a.reason || a.detail || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}
