'use client'

import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { DataTableFrame, DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES } from '@/components/common/DataTableFrame'
import { toggleRowOnDoubleClick } from '@/components/common/row-selection'
import { useToast } from '@/components/common/Toast'
import { getMemberReminders, type LinePerson, type ReminderCandidate } from '@/app/actions/line'
import { useReminderSend } from '@/features/settings/components/line/useReminderSend'

/** One press of a reminder topic for the customer picked in สมาชิก. */
export type MemberRemindRequest = { contact: LinePerson; rule: { key: string; label: string } }

const TH = `px-2 ${DATA_TABLE_TH_CLASSES}`
const money = (n: number | string | null) => (n === null ? '-' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dueText = (c: ReminderCandidate) => {
  const d = new Date(c.due_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  if (c.days_left > 0) return `${d} (อีก ${c.days_left} วัน)`
  if (c.days_left === 0) return `${d} (วันนี้)`
  return `${d} (เลย ${-c.days_left} วัน)`
}

/**
 * แจ้งเตือนลูกค้า (owner 2026-11-28): the topic button sends that reminder to the picked customer. One bill: asked
 * once, then sent. Several bills: a window to tick which bills. None: a short notice. The text is the schedule's own.
 */
export function LineMemberRemind({ request, onDone }: { request: MemberRemindRequest | null; onDone: () => void }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [many, setMany] = useState<ReminderCandidate[] | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const { sendToCustomers: send } = useReminderSend()

  useEffect(() => {
    if (!request) return
    let live = true
    void (async () => {
      const r = await getMemberReminders(request.contact.id)
      if (!live) return
      if (!r.success || !r.data) {
        showToast('โหลดรายการไม่สำเร็จ', r.error, 'ERROR')
        return onDone()
      }
      const rows = r.data.filter((c) => c.rule === request.rule.key)
      const name = request.contact.customer_name || request.contact.display_name || 'ลูกค้า'
      if (rows.length === 0) {
        showToast(`ไม่มีรายการ${request.rule.label}`, `ของ ${name}`, 'INFO')
        return onDone()
      }
      if (rows.length > 1) {
        setTicked(new Set(rows.map((c) => c.source_id)))
        return setMany(rows)
      }
      const c = rows[0]
      const yes = await confirm({ title: `ส่ง${request.rule.label}`, message: `${name} · ${c.ref_no} · ${dueText(c)}`, confirmLabel: 'ส่งเตือน' })
      if (yes && live) await send(rows)
      onDone()
    })()
    return () => {
      live = false
    }
    // a new press only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  const close = () => {
    if (busy) return
    setMany(null)
    onDone()
  }
  const toggle = (id: string) =>
    setTicked((t) => {
      const n = new Set(t)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const sendTicked = async () => {
    if (!many || busy) return
    const list = many.filter((c) => ticked.has(c.source_id))
    if (list.length === 0) return showToast('กรุณาเลือกบิลอย่างน้อย 1 รายการ', undefined, 'ERROR')
    setBusy(true)
    try {
      await send(list)
    } finally {
      setBusy(false)
    }
    setMany(null)
    onDone()
  }

  return (
    <AppModal isOpen={Boolean(many && request)} onClose={close} size="lg">
      <AppModalHeader onClose={close} icon={<BellRing className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}>
        <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
          {request?.rule.label} · {request?.contact.customer_name || request?.contact.display_name || '-'}
        </h3>
      </AppModalHeader>
      <AppModalBody noPadding className="h-[50vh] flex flex-col">
        <DataTableFrame fill rowCount={many?.length ?? 0} className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent">
          <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} aria-label="บิลที่จะส่งเตือน">
            <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
              <tr>
                <th className={`${TH} pl-3 w-8`} />
                <th className={TH}>เลขที่</th>
                <th className={TH}>กำหนด</th>
                <th className={`${TH} pr-3 text-right`}>ยอด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {(many ?? []).map((c) => (
                <tr
                  key={c.source_id}
                  onDoubleClick={(e) => toggleRowOnDoubleClick(e, () => toggle(c.source_id))}
                  className={`transition-colors ${ticked.has(c.source_id) ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                >
                  <td className="pl-3 pr-2 py-2">
                    <input
                      type="checkbox"
                      checked={ticked.has(c.source_id)}
                      onChange={() => toggle(c.source_id)}
                      className="w-4 h-4 rounded text-emerald-700 dark:text-emerald-400 focus:ring-emerald-500 cursor-pointer"
                      aria-label={`เลือก ${c.ref_no}`}
                    />
                  </td>
                  <td className="px-2 py-2 font-mono font-bold text-slate-900 dark:text-slate-100">{c.ref_no}</td>
                  <td className="px-2 py-2 tabular-nums text-slate-700 dark:text-slate-300">{dueText(c)}</td>
                  <td className="px-2 pr-3 py-2 text-right tabular-nums">{money(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableFrame>
      </AppModalBody>
      <AppModalFooter
        onCancel={close}
        onConfirm={() => void sendTicked()}
        confirmText={`ส่งเตือน ${ticked.size} รายการ`}
        confirmButtonColor="blue"
        isConfirmLoading={busy}
        isConfirmDisabled={busy || ticked.size === 0}
      />
    </AppModal>
  )
}
