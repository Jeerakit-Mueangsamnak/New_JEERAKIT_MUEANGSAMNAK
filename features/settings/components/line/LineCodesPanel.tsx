'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { Ban } from 'lucide-react'
import { ActionButton, TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { listLineCodes, revokeLineCode, type LineCodeRow } from '@/app/actions/line'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { PILL_TONE, thaiDateTime, type PillTone } from '@/features/settings/components/line/line-people-model'

/**
 * จัดการรหัสเชิญ (OWNER): the codes the shop made for a customer, a staff member or a driver, with the state each one is
 * in. The secret itself is never kept (the database keeps only its hash), so it is never listed; an open code can be
 * cancelled. New codes are made where the person is: the customer page, พนักงานร้าน, พนักงานส่งของ.
 */
const STATE: Record<LineCodeRow['state'], { text: string; tone: PillTone }> = {
  OPEN: { text: 'ใช้ได้อยู่', tone: 'emerald' },
  USED: { text: 'ใช้แล้ว', tone: 'slate' },
  REVOKED: { text: 'ยกเลิกแล้ว', tone: 'red' },
  EXPIRED: { text: 'หมดอายุ', tone: 'amber' },
}
const PURPOSE: Record<string, string> = { STAFF: 'พนักงาน', CUSTOMER: 'ลูกค้า', DRIVER: 'คนขับรถ' }

export function LineCodesPanel({ tabs }: { tabs: ReactNode }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<LineCodeRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await listLineCodes()
    if (!r.success || !r.data) return setError(r.error || 'โหลดรายการรหัสไม่สำเร็จ')
    setError(null)
    setRows(r.data)
  }, [])
  useAutoRefresh(load, 60_000)

  const revoke = async (c: LineCodeRow) => {
    const ok = await confirm({ title: `ยกเลิกรหัสของ ${c.target || 'รายการนี้'}`, message: 'รหัสนี้จะใช้ผูกบัญชีไม่ได้อีก', confirmLabel: 'ยกเลิกรหัส', danger: true })
    if (!ok) return
    setBusy(c.id)
    try {
      const r = await revokeLineCode(c.id)
      if (!r.success) return showToast('ยกเลิกไม่สำเร็จ', r.error, 'ERROR')
      showToast('ยกเลิกรหัสแล้ว', c.target ?? undefined, 'SUCCESS')
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex items-center`}>{tabs}</div>
      {error && <p className="m-3 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">{error}</p>}
      <DataTableFrame fill rowCount={rows.length} className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent">
        <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} data-testid="line-codes">
          <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
            <tr>
              <th className={`px-3 ${DATA_TABLE_TH_CLASSES}`}>ประเภท</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>ของใคร</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>สร้างเมื่อ / โดย</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>หมดอายุ</th>
              <th className={`px-2 text-center ${DATA_TABLE_TH_CLASSES}`}>สถานะ</th>
              <th className={`px-3 text-right ${DATA_TABLE_TH_CLASSES}`}>จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{c.driver_code ? PURPOSE.DRIVER : (PURPOSE[c.purpose] ?? c.purpose)}</td>
                <td className="px-2 py-2 text-slate-800 dark:text-slate-200">{c.target || 'ยังไม่ทราบ'}</td>
                <td className="px-2 py-2 tabular-nums text-slate-700 dark:text-slate-300">
                  {thaiDateTime(c.created_at)} · {c.created_by || 'ระบบ'}
                </td>
                <td className="px-2 py-2 tabular-nums text-slate-700 dark:text-slate-300">{thaiDateTime(c.expires_at)}</td>
                <td className="px-2 py-2 text-center">
                  <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold ${PILL_TONE[STATE[c.state].tone]}`}>{STATE[c.state].text}</span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {c.state === 'OPEN' && (
                    <ActionButton variant="danger" icon={<Ban />} disabled={busy === c.id} onClick={() => void revoke(c)}>
                      ยกเลิกรหัส
                    </ActionButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}
