'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellRing, RefreshCw, Send } from 'lucide-react'
import { ActionButton } from '@/components/common/ActionButton'
import { CustomSelect } from '@/components/common/CustomSelect'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import { useToast } from '@/components/common/Toast'
import { getReminderCandidates, sendCustomerReminder, type ReminderCandidate } from '@/app/actions/line'
import { SETTINGS_HELPER, SETTINGS_SECTION, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import { LINE_REMINDER_RULES } from '@/lib/line/config'
import { LINE_DELIVERY_STATUS } from '@/features/settings/components/LineDeliveryLogPanel'

/**
 * Settings › LINE › ส่งเตือนเอง: today's reminders a linked customer could get (any rule, on or
 * off in the schedule). Each press queues one message for that bill's / appointment's own
 * customer; the same text as the schedule.
 */

const TH = 'px-2'
const TD = 'px-2'
const RULE_LABEL = Object.fromEntries(LINE_REMINDER_RULES.map((r) => [r.key, r.label]))

const newKey = () => `rem-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`

function dueText(c: ReminderCandidate): string {
  const d = new Date(c.due_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  if (c.days_left > 0) return `${d} (อีก ${c.days_left} วัน)`
  if (c.days_left === 0) return `${d} (วันนี้)`
  return `${d} (เลย ${-c.days_left} วัน)`
}

export function LineRemindersPanel() {
  const { showToast } = useToast()
  const [rows, setRows] = useState<ReminderCandidate[]>([])
  const [rule, setRule] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await getReminderCandidates()
    setError(r.success ? null : r.error || 'โหลดรายการไม่สำเร็จ')
    setRows(r.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
    <div className={SETTINGS_SECTION}>
      <h4 className={SETTINGS_SECTION_TITLE}>
        <BellRing className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
        <span>ส่งเตือนลูกค้าเอง</span>
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <CustomSelect
            value={rule}
            onChange={(v) => setRule(String(v))}
            options={[{ value: 'ALL', label: 'ทุกประเภท' }, ...LINE_REMINDER_RULES.map((r) => ({ value: r.key, label: r.label }))]}
          />
        </div>
        <ActionButton variant="outline" icon={<RefreshCw className={loading ? 'animate-spin' : ''} />} onClick={() => void load()} aria-label="รีเฟรช" />
        <ActionButton variant="primary" icon={<Send />} disabled={!shown.length || Boolean(busy)} onClick={() => void send(shown)}>
          ส่งทั้งหมดที่แสดง ({shown.length})
        </ActionButton>
      </div>
      {error && <p className="text-[11px] text-amber-700 dark:text-amber-300">{error}</p>}
      <DataTableFrame
        rowCount={shown.length}
      >
        <table className="w-full text-left border-collapse table-auto text-xs" aria-label="ตารางส่งเตือนลูกค้า">
          <thead>
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
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((c) => {
              const key = `${c.rule}:${c.source_id}`
              return (
                <tr key={key}>
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
                    <ActionButton variant="outline" icon={<Send />} disabled={Boolean(busy)} onClick={() => void send([c])}>
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
