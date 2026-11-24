'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { Send } from 'lucide-react'
import { ActionButton, TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'
import { CustomSelect } from '@/components/common/CustomSelect'
import { DataTableFrame, DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES } from '@/components/common/DataTableFrame'
import { useToast } from '@/components/common/Toast'
import { getReminderCandidates, sendCustomerReminder, type ReminderCandidate } from '@/app/actions/line'
import { LINE_REMINDER_RULES } from '@/lib/line/config'
import { LINE_DELIVERY_STATUS } from '@/features/settings/components/LineDeliveryLogPanel'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'

/**
 * LINE › การส่ง › ส่งเตือนเอง: today's reminders a linked customer could get (any rule, on or off in the
 * schedule). Each press queues one message for that bill's / appointment's own customer; the same text as the
 * schedule. The list keeps itself up to date (no รีเฟรช button).
 */

const TH = `px-2 ${DATA_TABLE_TH_CLASSES}`
const TD = 'px-2 py-2'
const RULE_LABEL = Object.fromEntries(LINE_REMINDER_RULES.map((r) => [r.key, r.label]))

const newKey = () => `rem-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`

function dueText(c: ReminderCandidate): string {
  const d = new Date(c.due_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  if (c.days_left > 0) return `${d} (อีก ${c.days_left} วัน)`
  if (c.days_left === 0) return `${d} (วันนี้)`
  return `${d} (เลย ${-c.days_left} วัน)`
}

/** `tabs`: the LINE menu tab bars, first in this page's toolbar row. */
export function LineRemindersPanel({ tabs }: { tabs?: ReactNode }) {
  const { showToast } = useToast()
  const [rows, setRows] = useState<ReminderCandidate[]>([])
  const [rule, setRule] = useState('ALL')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await getReminderCandidates()
    setError(r.success ? null : r.error || 'โหลดรายการไม่สำเร็จ')
    setRows(r.data ?? [])
  }, [])

  useAutoRefresh(load)

  const shown = rule === 'ALL' ? rows : rows.filter((r) => r.rule === rule)

  const send = async (list: ReminderCandidate[]) => {
    let ok = 0
    let fail = 0
    for (const c of list) {
      setBusy(`${c.rule}:${c.source_id}`)
      const r = await sendCustomerReminder({ rule: c.rule, sourceId: c.source_id, idempotencyKey: newKey() })
      if (r.success) ok++
      else {
        fail++
        if (list.length === 1) showToast('ส่งไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
      }
    }
    setBusy(null)
    if (ok) showToast('ส่งเตือนแล้ว', `${ok} รายการ${fail ? ` · ไม่สำเร็จ ${fail}` : ''}`, 'SUCCESS')
    await load()
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-wrap items-center`}>
        {tabs}
        <div className="w-48 shrink-0">
          <CustomSelect
            value={rule}
            onChange={(v) => setRule(String(v))}
            ariaLabel="ประเภทการเตือน"
            options={[{ value: 'ALL', label: 'ทุกประเภท' }, ...LINE_REMINDER_RULES.map((r) => ({ value: r.key, label: r.label }))]}
          />
        </div>
        <ActionButton variant="primary" className="ml-auto" icon={<Send />} disabled={!shown.length || Boolean(busy)} onClick={() => void send(shown)}>
          ส่งทั้งหมดที่แสดง ({shown.length})
        </ActionButton>
      </div>
      {error && <p className="mx-3 mt-2 text-[11px] text-amber-700 dark:text-amber-300">{error}</p>}
      <DataTableFrame fill rowCount={shown.length} className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent">
        <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} aria-label="ตารางส่งเตือนลูกค้า">
          <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
            <tr>
              <th className={TH}>ประเภท</th>
              <th className={TH}>ลูกค้า</th>
              <th className={TH}>บิล / นัดหมาย</th>
              <th className={TH}>กำหนด</th>
              <th className={`${TH} text-right`}>ยอดค้าง</th>
              <th className={TH}>ส่งล่าสุด</th>
              <th className={`${TH} text-right`}>จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {shown.map((c) => {
              const key = `${c.rule}:${c.source_id}`
              return (
                <tr key={key} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                  <td className={TD}>{RULE_LABEL[c.rule] ?? c.rule}</td>
                  <td className={`${TD} font-semibold text-slate-800 dark:text-slate-200`}>{c.customer_name}</td>
                  <td className={`${TD} font-mono`}>{c.ref_no}</td>
                  <td className={`${TD} ${c.days_left < 0 ? 'text-red-700 dark:text-red-400 font-semibold' : ''}`}>{dueText(c)}</td>
                  <td className={`${TD} text-right font-mono`}>{c.amount == null ? '-' : Number(c.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                  <td className={TD}>
                    {c.last_queued_at
                      ? `${new Date(c.last_queued_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${LINE_DELIVERY_STATUS[c.last_status ?? '']?.label ?? c.last_status}`
                      : '-'}
                  </td>
                  <td className={`${TD} text-right`}>
                    <ActionButton variant="share" icon={<Send />} disabled={Boolean(busy)} onClick={() => void send([c])}>
                      {busy === key ? 'กำลังส่ง…' : 'ส่งเตือน'}
                    </ActionButton>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}
