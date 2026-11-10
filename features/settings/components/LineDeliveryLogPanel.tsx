'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, RefreshCw, RotateCcw, Send } from 'lucide-react'
import { ActionButton } from '@/components/common/ActionButton'
import { CustomSelect } from '@/components/common/CustomSelect'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import { useToast } from '@/components/common/Toast'
import { createClient } from '@/lib/supabase/client'
import { retryLineDelivery, sendLineTestToMe } from '@/app/actions/line'
import { SETTINGS_HELPER, SETTINGS_SECTION, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import { LINE_EDITABLE_TEMPLATES } from '@/lib/line/config'

/**
 * Settings › LINE › ประวัติการส่ง: the last outbox rows (line_deliveries) with their result, a
 * resend for failed / cancelled rows, and a test message to one's own LINE.
 */

/** line_deliveries.status → Thai label + pill colour (shared with the manual reminder list). */
export const LINE_DELIVERY_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'รอส่ง', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  SENDING: { label: 'กำลังส่ง', tone: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  SENT: { label: 'ส่งแล้ว', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  FAILED: { label: 'รอส่งใหม่', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  DEAD: { label: 'ส่งไม่สำเร็จ', tone: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
  CANCELLED: { label: 'ยกเลิก', tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
}

const ERROR_TEXT: Record<string, string> = {
  NETWORK: 'ติดต่อ LINE ไม่ได้',
  TIMEOUT: 'LINE ตอบช้าเกินไป',
  TOKEN_INVALID: 'Access Token ไม่ถูกต้อง',
  FORBIDDEN: 'LINE ไม่อนุญาต',
  RATE_OR_QUOTA_LIMIT: 'เกินโควต้า / ส่งถี่เกินไป',
  LINE_SERVER_ERROR: 'LINE ขัดข้อง',
  UNFOLLOWED: 'ผู้รับบล็อก / ลบ LINE ร้าน',
  TASK_CANCELLED: 'งานถูกยกเลิก',
  HTTP_400: 'LINE ไม่รับข้อความ (ผู้รับอาจยังไม่แอดร้าน)',
}

const TEMPLATE_LABEL: Record<string, string> = {
  ...Object.fromEntries(LINE_EDITABLE_TEMPLATES.map((t) => [t.key, t.label])),
  BILL_MESSAGE: 'ส่งบิล',
  TEST: 'ทดสอบ',
  TASK_WITHDRAWN: 'ถอนงานคนขับ',
  TASK_CANCELLED: 'ยกเลิกงานคนขับ',
}

interface Delivery {
  id: string
  template_key: string
  status: string
  attempts: number
  last_error_code: string | null
  created_at: string
  sent_at: string | null
  contact: { display_name: string | null; typed_name: string | null } | null
}

const TH = 'px-2'
const TD = 'px-2'
const newKey = () => `test-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`

export function LineDeliveryLogPanel() {
  const { showToast } = useToast()
  const [rows, setRows] = useState<Delivery[]>([])
  const [status, setStatus] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = createClient()
      .from('line_deliveries')
      .select('id, template_key, status, attempts, last_error_code, created_at, sent_at, contact:line_contacts(display_name, typed_name)')
      .order('created_at', { ascending: false })
      .limit(100)
    if (status !== 'ALL') q = q.eq('status', status)
    const r = await q
    setError(r.error ? 'โหลดประวัติไม่สำเร็จ (ต้องมีสิทธิ์เมนู LINE)' : null)
    setRows(((r.data ?? []) as unknown as Array<Delivery & { contact: Delivery['contact'] | Delivery['contact'][] }>).map((d) => ({
      ...d,
      contact: Array.isArray(d.contact) ? (d.contact[0] ?? null) : d.contact,
    })))
    setLoading(false)
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const retry = async (d: Delivery) => {
    setBusy(d.id)
    const r = await retryLineDelivery(d.id)
    setBusy(null)
    if (!r.success) showToast('ส่งใหม่ไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
    else showToast('ส่งใหม่แล้ว', r.data?.mode === 'mock' ? 'โหมดทดสอบ: บันทึกไว้ ไม่ส่งถึง LINE จริง' : LINE_DELIVERY_STATUS[r.data?.status ?? '']?.label ?? '', 'SUCCESS')
    await load()
  }

  const test = async () => {
    setBusy('test')
    const r = await sendLineTestToMe(newKey())
    setBusy(null)
    if (!r.success) showToast('ส่งทดสอบไม่สำเร็จ', r.error || 'ผูก LINE ของคุณก่อน', 'ERROR')
    else showToast('ส่งทดสอบแล้ว', 'ดูข้อความใน LINE ของคุณ', 'SUCCESS')
    await load()
  }

  return (
    <div className={SETTINGS_SECTION}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-48">
          <CustomSelect
            value={status}
            onChange={(v) => setStatus(String(v))}
            options={[{ value: 'ALL', label: 'ทุกสถานะ' }, ...Object.entries(LINE_DELIVERY_STATUS).map(([value, s]) => ({ value, label: s.label }))]}
          />
        </div>
        <ActionButton variant="outline" icon={<RefreshCw className={loading ? 'animate-spin' : ''} />} onClick={() => void load()} aria-label="รีเฟรช" />
        <ActionButton variant="info" icon={<Send />} disabled={busy === 'test'} onClick={() => void test()}>
          ส่งข้อความทดสอบถึง LINE ของฉัน
        </ActionButton>
      </div>
      {error && <p className="text-[11px] text-amber-700 dark:text-amber-300">{error}</p>}
      <DataTableFrame
        rowCount={rows.length}
      >
        <table className="w-full text-left border-collapse table-auto text-xs" aria-label="ประวัติการส่ง LINE">
          <thead>
            <tr>
              <th className={TH}>เวลา</th>
              <th className={TH}>ผู้รับ</th>
              <th className={TH}>ข้อความ</th>
              <th className={TH}>สถานะ</th>
              <th className={TH}>สาเหตุ</th>
              <th className={`${TH} text-right`}>จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((d) => {
              const st = LINE_DELIVERY_STATUS[d.status] ?? { label: d.status, tone: '' }
              return (
                <tr key={d.id}>
                  <td className={`${TD} whitespace-nowrap`}>
                    {new Date(d.sent_at ?? d.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className={`${TD} font-semibold text-slate-800 dark:text-slate-200`}>{d.contact?.typed_name || d.contact?.display_name || '-'}</td>
                  <td className={TD}>{TEMPLATE_LABEL[d.template_key] ?? d.template_key}</td>
                  <td className={TD}>
                    <span className={`inline-flex items-center h-6 px-2 rounded-lg text-[11px] font-bold ${st.tone}`}>{st.label}</span>
                  </td>
                  <td className={`${TD} text-slate-600 dark:text-slate-400`}>{d.last_error_code ? (ERROR_TEXT[d.last_error_code] ?? d.last_error_code) : '-'}</td>
                  <td className={`${TD} text-right`}>
                    {['DEAD', 'FAILED', 'CANCELLED'].includes(d.status) && (
                      <ActionButton variant="outline" icon={<RotateCcw />} disabled={busy === d.id} onClick={() => void retry(d)}>
                        ส่งใหม่
                      </ActionButton>
                    )}
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
