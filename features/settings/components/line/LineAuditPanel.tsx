'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { COMMAND_BUTTON_SIZE_CLASSES, TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { listLineAudit, type LineAuditRow } from '@/app/actions/line'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { thaiDateTime } from '@/features/settings/components/line/line-people-model'

/** ประวัติการตรวจสอบ (OWNER): who did what in LINE, newest first, 50 at a time. */
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
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<LineAuditRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)

  const load = useCallback(async () => {
    const r = await listLineAudit(offset)
    if (!r.success || !r.data) return setError(r.error || 'โหลดประวัติไม่สำเร็จ')
    setError(null)
    setRows(r.data)
    setMore(r.data.length === PAGE)
  }, [offset])
  useAutoRefresh(load, 120_000)

  const btn = `${COMMAND_BUTTON_SIZE_CLASSES} inline-flex items-center border border-slate-300 dark:border-slate-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed`
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex items-center`}>{tabs}</div>
      {error && <p className="m-3 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">{error}</p>}
      <DataTableFrame
        fill
        rowCount={rows.length}
        countBarStart={
          <button type="button" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))} className={btn}>
            <ChevronLeft className="w-3.5 h-3.5" /> ย้อนกลับ
          </button>
        }
        countBarEnd={
          <button type="button" disabled={!more} onClick={() => setOffset((o) => o + PAGE)} className={btn}>
            ถัดไป <ChevronRight className="w-3.5 h-3.5" />
          </button>
        }
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
