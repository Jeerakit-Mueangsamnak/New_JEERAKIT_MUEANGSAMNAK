'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Ban, ClipboardList, Send } from 'lucide-react'
import {
  ActionButton,
  COMMAND_BUTTON_SIZE_CLASSES,
  TABLE_TOOLBAR_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
  TAB_CONTAINER_CLASSES,
} from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { CustomSelect } from '@/components/common/CustomSelect'
import { useToast } from '@/components/common/Toast'
import { useAskText, useConfirm } from '@/components/common/ConfirmDialogProvider'
import { createClient } from '@/lib/supabase/client'
import { cancelLineTask, createLineTask, listLineTasks, setLineTaskStatus, type LineTaskRow, type LineTaskStatus } from '@/app/actions/line'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { PILL_TONE, thaiDateTime, type PillTone } from '@/features/settings/components/line/line-people-model'
import { SETTINGS_INPUT, SETTINGS_INPUT_MONO, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'

/**
 * สั่งงานพนักงาน (owner 2026-11-25, from line.html): a task to a staff member's LINE, and the list of tasks with their
 * state. The staff member presses รับงาน / เสร็จแล้ว in LINE; the shop may also set the state here, including มีปัญหา.
 */
type Filter = LineTaskStatus | 'ALL'
type SettableStatus = Exclude<LineTaskStatus, 'CANCELLED'>
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'ALL', label: 'ทั้งหมด' },
  { id: 'SENT', label: 'รอดำเนินการ' },
  { id: 'ACCEPTED', label: 'กำลังดำเนินการ' },
  { id: 'DONE', label: 'เสร็จสิ้น' },
  { id: 'ISSUE', label: 'มีปัญหา' },
]
const STATE: Record<LineTaskStatus, { text: string; tone: PillTone }> = {
  SENT: { text: 'รอดำเนินการ', tone: 'amber' },
  ACCEPTED: { text: 'กำลังดำเนินการ', tone: 'blue' },
  DONE: { text: 'เสร็จสิ้น', tone: 'emerald' },
  ISSUE: { text: 'มีปัญหา', tone: 'red' },
  CANCELLED: { text: 'ยกเลิกแล้ว', tone: 'slate' },
}
const SETTABLE: SettableStatus[] = ['SENT', 'ACCEPTED', 'DONE', 'ISSUE']
/** The owner's own list of kinds (line.html) */
const TASK_TYPES = ['จัดส่ง & ติดตั้ง', 'รับคืนสินค้า', 'เตรียมสต็อกสินค้า', 'ตรวจสอบหน้างาน']
const TH = `px-2 ${DATA_TABLE_TH_CLASSES}`

interface Staff {
  id: string
  name: string
  linked: boolean
}

export function LineTasksPanel({ tabs }: { tabs: ReactNode }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const askText = useAskText()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [rows, setRows] = useState<LineTaskRow[]>([])
  const [counts, setCounts] = useState<Record<Filter, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [staff, setStaff] = useState<Staff[]>([])
  const [assignee, setAssignee] = useState('')
  const [kind, setKind] = useState(TASK_TYPES[0])
  const [billNo, setBillNo] = useState('')
  const [detail, setDetail] = useState('')
  const [startAs, setStartAs] = useState<'SENT' | 'ACCEPTED'>('SENT')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await listLineTasks(filter, 0)
    if (!r.success || !r.data) return setError(r.error || 'โหลดรายการงานไม่สำเร็จ')
    setError(null)
    setRows(r.data.rows)
    setCounts(r.data.counts)
  }, [filter])
  useAutoRefresh(load, 60_000)

  // staff who can get a task: every member, the linked ones selectable (names only, through member_directory)
  useEffect(() => {
    const supabase = createClient()
    void Promise.all([supabase.rpc('member_directory'), supabase.from('line_contacts').select('profile_id').eq('status', 'LINKED').not('profile_id', 'is', null)]).then(([p, c]) => {
      const linked = new Set(((c.data as Array<{ profile_id: string }> | null) ?? []).map((x) => x.profile_id))
      const list = ((p.data as Array<{ id: string; display_name: string | null; username: string | null }> | null) ?? []).map((s) => ({
        id: s.id,
        name: s.display_name || s.username || '-',
        linked: linked.has(s.id),
      }))
      setStaff(list)
      setAssignee((cur) => cur || list.find((s) => s.linked)?.id || '')
    })
  }, [])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    const text = detail.trim()
    if (!assignee) return showToast('กรุณาเลือกพนักงานที่ผูก LINE แล้ว', undefined, 'ERROR')
    if (!text) return showToast('กรุณาพิมพ์รายละเอียดงาน', undefined, 'ERROR')
    setBusy('new')
    try {
      let billId: string | null = null
      const no = billNo.trim().replace(/^#/, '')
      if (no) {
        const { data } = await createClient().from('bills').select('id').eq('bill_no', no).maybeSingle()
        if (!data?.id) return showToast('ไม่พบเลขที่บิลนี้', no, 'ERROR')
        billId = data.id as string
      }
      // the staff member reads the kind, the bill and the work in the LINE message (เรื่อง)
      const title = `${kind}${no ? ` · บิล ${no}` : ''}: ${text}`.slice(0, 200)
      const r = await createLineTask({ assigneeId: assignee, title, detail: text, billId, idempotencyKey: `task-${crypto.randomUUID()}` })
      if (!r.success || !r.data) return showToast('สั่งงานไม่สำเร็จ', r.error, 'ERROR')
      if (startAs === 'ACCEPTED') await setLineTaskStatus(r.data.task_id, 'ACCEPTED')
      showToast('ส่งงานเข้า LINE พนักงานแล้ว', staff.find((s) => s.id === assignee)?.name, 'SUCCESS')
      setDetail('')
      setBillNo('')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const setStatus = async (t: LineTaskRow, status: SettableStatus) => {
    if (status === t.status) return
    let note: string | undefined
    if (status === 'ISSUE') {
      const typed = await askText({ title: `มีปัญหา: ${t.title}`, message: 'ปัญหาที่พบ (ไม่บังคับ)', confirmLabel: 'บันทึก', required: false })
      if (typed === null) return
      note = typed
    }
    setBusy(t.id)
    try {
      const r = await setLineTaskStatus(t.id, status, note)
      if (!r.success) return showToast('อัปเดตสถานะไม่สำเร็จ', r.error, 'ERROR')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const cancel = async (t: LineTaskRow) => {
    const ok = await confirm({ title: `ยกเลิกงาน "${t.title}"`, message: 'พนักงานจะกดรับงานหรือปิดงานนี้ใน LINE ไม่ได้อีก', confirmLabel: 'ยกเลิกงาน', danger: true })
    if (!ok) return
    setBusy(t.id)
    try {
      const r = await cancelLineTask(t.id, 'ร้านยกเลิกงาน')
      if (!r.success) return showToast('ยกเลิกไม่สำเร็จ', r.error, 'ERROR')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const tabClass = (on: boolean) => `${TAB_BUTTON_BASE_CLASSES} ${on ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-wrap items-center`}>
        {tabs}
        <div className={TAB_CONTAINER_CLASSES} role="tablist" aria-label="สถานะงาน">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={tabClass(filter === f.id)}>
              {f.label}
              {counts && <span className="tabular-nums">({counts[f.id] ?? 0})</span>}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="m-3 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">{error}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-2 p-2">
        <form onSubmit={(e) => void send(e)} className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 p-3 space-y-3 self-start">
          <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ClipboardList className="w-3.5 h-3.5" /> สร้างใบสั่งงานใหม่ให้พนักงาน
          </h3>
          <div>
            <label className={SETTINGS_LABEL}>เลือกพนักงานผู้รับงาน</label>
            <CustomSelect
              ariaLabel="เลือกพนักงานผู้รับงาน"
              value={assignee}
              onChange={(v) => setAssignee(String(v))}
              placeholder="ยังไม่มีพนักงานที่ผูก LINE"
              options={staff.filter((s) => s.linked).map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={SETTINGS_LABEL}>ประเภทงาน</label>
              <CustomSelect ariaLabel="ประเภทงาน" value={kind} onChange={(v) => setKind(String(v))} options={TASK_TYPES.map((t) => ({ value: t, label: t }))} />
            </div>
            <div>
              <label className={SETTINGS_LABEL} htmlFor="task-bill">เลขที่บิลอ้างอิง</label>
              <input id="task-bill" value={billNo} maxLength={40} onChange={(e) => setBillNo(e.target.value)} className={SETTINGS_INPUT_MONO} />
            </div>
          </div>
          <div>
            <label className={SETTINGS_LABEL} htmlFor="task-detail">รายละเอียดงาน / สถานที่นัดหมาย *</label>
            <textarea id="task-detail" rows={3} maxLength={2000} value={detail} onChange={(e) => setDetail(e.target.value)} className={`${SETTINGS_INPUT} h-auto py-2`} />
          </div>
          <div>
            <label className={SETTINGS_LABEL}>สถานะเริ่มต้น</label>
            <CustomSelect
              ariaLabel="สถานะเริ่มต้น"
              value={startAs}
              onChange={(v) => setStartAs(v === 'ACCEPTED' ? 'ACCEPTED' : 'SENT')}
              options={[
                { value: 'SENT', label: STATE.SENT.text },
                { value: 'ACCEPTED', label: STATE.ACCEPTED.text },
              ]}
            />
          </div>
          <ActionButton type="submit" variant="share" icon={<Send />} disabled={busy === 'new'} className="w-full">
            สั่งงาน & ส่งแจ้งเตือนเข้า LINE พนักงาน
          </ActionButton>
        </form>

        <DataTableFrame fill rowCount={rows.length} className="lg:col-span-7 min-h-[240px] lg:min-h-0 min-w-0 rounded-xl">
          <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} aria-label="ตารางงานพนักงาน">
            <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
              <tr>
                <th className={`${TH} pl-3`}>งาน / บิล</th>
                <th className={TH}>ผู้รับผิดชอบ</th>
                <th className={`${TH} text-center`}>สถานะปัจจุบัน</th>
                <th className={`${TH} pr-3 text-right`}>อัปเดตสถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="pl-3 pr-2 py-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{t.title}</span>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {thaiDateTime(t.created_at)}
                      {t.created_by ? ` · ${t.created_by}` : ''}
                    </span>
                    {t.status === 'ISSUE' && t.issue_note && <span className="block text-[10px] text-red-700 dark:text-red-400">{t.issue_note}</span>}
                  </td>
                  <td className="px-2 py-2 text-slate-800 dark:text-slate-200">{t.assignee || '-'}</td>
                  <td className="px-2 py-2 text-center">
                    <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold ${PILL_TONE[STATE[t.status].tone]}`}>{STATE[t.status].text}</span>
                  </td>
                  <td className="pl-2 pr-3 py-2 text-right whitespace-nowrap">
                    {t.status !== 'CANCELLED' && (
                      <span className="inline-flex items-center gap-1">
                        <CustomSelect
                          ariaLabel="อัปเดตสถานะ"
                          value={t.status}
                          disabled={busy === t.id}
                          align="right"
                          onChange={(v) => void setStatus(t, v as SettableStatus)}
                          options={SETTABLE.map((s) => ({ value: s, label: STATE[s].text }))}
                          className="w-36"
                        />
                        {t.status !== 'DONE' && (
                          <button
                            type="button"
                            disabled={busy === t.id}
                            onClick={() => void cancel(t)}
                            aria-label="ยกเลิกงาน"
                            className={`${COMMAND_BUTTON_SIZE_CLASSES} inline-flex items-center text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 cursor-pointer`}
                          >
                            <Ban />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableFrame>
      </div>
    </div>
  )
}
