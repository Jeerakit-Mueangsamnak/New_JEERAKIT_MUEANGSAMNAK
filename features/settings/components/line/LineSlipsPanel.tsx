'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { CheckCircle2, Image as ImageIcon, ReceiptText, XCircle } from 'lucide-react'
import {
  COMMAND_BUTTON_SIZE_CLASSES,
  TABLE_TOOLBAR_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
  TAB_CONTAINER_CLASSES,
} from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { NumericInput } from '@/components/common/NumericInput'
import { useToast } from '@/components/common/Toast'
import { approveLineSlip, getLineSlipImageUrl, listLineSlips, rejectLineSlip, type LineSlipRow, type LineSlipStatus } from '@/app/actions/line'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { PILL_TONE, thaiDateTime, type PillTone } from '@/features/settings/components/line/line-people-model'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { SLIP_CHECK_REASON_LABEL, type SlipCheckReason } from '@/lib/line/slip-check'

/**
 * สลิปรอตรวจ (owner 2026-11-25): slips customers sent from the pay form in LINE. อนุมัติ takes the money into the bill
 * (once: the database locks the slip and uses its own key) and tells the customer; ไม่ผ่าน sends the reason.
 */
type Filter = LineSlipStatus | 'ALL'
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'PENDING', label: 'รอตรวจ' },
  { id: 'APPROVED', label: 'อนุมัติแล้ว' },
  { id: 'REJECTED', label: 'ไม่ผ่าน' },
  { id: 'ALL', label: 'ทั้งหมด' },
]
const STATE: Record<LineSlipStatus, { text: string; tone: PillTone }> = {
  PENDING: { text: 'รอตรวจ', tone: 'amber' },
  APPROVED: { text: 'อนุมัติแล้ว', tone: 'emerald' },
  REJECTED: { text: 'ไม่ผ่าน', tone: 'red' },
}
const CHECK: Record<'PASS' | 'FAIL' | 'ERROR', { text: string; tone: PillTone }> = {
  PASS: { text: 'ตรวจผ่าน', tone: 'emerald' },
  FAIL: { text: 'ตรวจไม่ผ่าน', tone: 'red' },
  ERROR: { text: 'ตรวจไม่ได้', tone: 'slate' },
}
/** Why the automatic check failed, in Thai (the database adds "duplicate" on its own). */
const checkReasons = (s: LineSlipRow): string[] => {
  const reasons = new Set(s.check_detail?.reasons ?? [])
  if (s.check_detail?.duplicate) reasons.add('DUPLICATE')
  return [...reasons].map((r) => SLIP_CHECK_REASON_LABEL[r as SlipCheckReason] ?? r)
}
const money = (n: number | null | undefined) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const TH = `px-2 ${DATA_TABLE_TH_CLASSES}`

export function LineSlipsPanel({ tabs, onChanged }: { tabs: ReactNode; onChanged?: () => void }) {
  const { showToast } = useToast()
  const [filter, setFilter] = useState<Filter>('PENDING')
  const [rows, setRows] = useState<LineSlipRow[]>([])
  const [counts, setCounts] = useState<Record<LineSlipStatus, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{ slip: LineSlipRow; mode: 'VIEW' | 'APPROVE' | 'REJECT'; image: string | null } | null>(null)
  const [amount, setAmount] = useState<number | ''>('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await listLineSlips(filter, 0)
    if (!r.success || !r.data) return setError(r.error || 'โหลดรายการสลิปไม่สำเร็จ')
    setError(null)
    setRows(r.data.rows)
    setCounts(r.data.counts)
  }, [filter])
  useAutoRefresh(load, 60_000)

  const show = async (slip: LineSlipRow, mode: 'VIEW' | 'APPROVE' | 'REJECT') => {
    setAmount(Math.min(slip.amount, slip.balance_due) || '')
    setReason('')
    setOpen({ slip, mode, image: null })
    const r = await getLineSlipImageUrl(slip.image_path)
    setOpen((o) => (o && o.slip.id === slip.id ? { ...o, image: r.success ? (r.data ?? null) : null } : o))
    if (!r.success) showToast('เปิดรูปสลิปไม่สำเร็จ', r.error, 'ERROR')
  }

  const decide = async () => {
    if (!open || busy) return
    const { slip, mode } = open
    if (mode === 'APPROVE' && (amount === '' || amount <= 0)) return showToast('กรุณาใส่ยอดที่ได้รับ', undefined, 'ERROR')
    if (mode === 'REJECT' && !reason.trim()) return showToast('กรุณาระบุเหตุผล', undefined, 'ERROR')
    setBusy(true)
    try {
      const r =
        mode === 'APPROVE'
          ? await approveLineSlip({ slipId: slip.id, billId: slip.bill_id, amount: Number(amount) })
          : await rejectLineSlip({ slipId: slip.id, billId: slip.bill_id, reason })
      if (!r.success) return showToast(mode === 'APPROVE' ? 'อนุมัติไม่สำเร็จ' : 'บันทึกไม่สำเร็จ', r.error, 'ERROR')
      showToast(mode === 'APPROVE' ? 'รับยอดเข้าบิลแล้ว' : 'แจ้งลูกค้าว่าสลิปไม่ผ่านแล้ว', `บิล ${slip.bill_no || '-'}`, 'SUCCESS')
      setOpen(null)
      await load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const tabClass = (on: boolean) => `${TAB_BUTTON_BASE_CLASSES} ${on ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`
  const slip = open?.slip
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-wrap items-center`}>
        {tabs}
        <div className={TAB_CONTAINER_CLASSES} role="tablist" aria-label="สถานะสลิป">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={tabClass(filter === f.id)}>
              {f.label}
              {f.id !== 'ALL' && counts && <span className="tabular-nums">({counts[f.id] ?? 0})</span>}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="m-3 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">{error}</p>}
      <DataTableFrame fill rowCount={rows.length} className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent">
        <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} aria-label="ตารางสลิปจาก LINE">
          <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
            <tr>
              <th className={`${TH} pl-3`}>ส่งเมื่อ</th>
              <th className={TH}>ลูกค้า</th>
              <th className={TH}>บิล</th>
              <th className={`${TH} text-right`}>ยอดในสลิป</th>
              <th className={`${TH} text-right`}>ยอดค้างบิล</th>
              <th className={`${TH} text-center`}>สถานะ</th>
              <th className={`${TH} pr-3 text-right`}>จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="pl-3 pr-2 py-2 tabular-nums text-slate-700 dark:text-slate-300">{thaiDateTime(s.created_at)}</td>
                <td className="px-2 py-2 font-semibold text-slate-900 dark:text-slate-100">
                  {s.customer_name || '-'}
                  {s.line_name && <span className="block text-[10px] font-normal text-slate-500 dark:text-slate-400">LINE {s.line_name}</span>}
                </td>
                <td className="px-2 py-2 font-mono text-slate-800 dark:text-slate-200">{s.bill_no || '-'}</td>
                <td className="px-2 py-2 text-right tabular-nums font-bold">{money(s.approved_amount ?? s.amount)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(s.balance_due)}</td>
                <td className="px-2 py-2 text-center">
                  <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold ${PILL_TONE[STATE[s.status].tone]}`}>{STATE[s.status].text}</span>
                  {s.check_status && (
                    <span
                      title={checkReasons(s).join(' · ') || undefined}
                      className={`ml-1 inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold ${PILL_TONE[CHECK[s.check_status].tone]}`}
                    >
                      {CHECK[s.check_status].text}
                    </span>
                  )}
                  {s.reject_reason && <span className="block mt-0.5 text-[10px] text-red-700 dark:text-red-400">{s.reject_reason}</span>}
                </td>
                <td className="pl-2 pr-3 py-2 text-right whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => void show(s, 'VIEW')} className={`${COMMAND_BUTTON_SIZE_CLASSES} inline-flex items-center text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer`}>
                      <ImageIcon /> ดูสลิป
                    </button>
                    {s.status === 'PENDING' && (
                      <>
                        <button type="button" onClick={() => void show(s, 'APPROVE')} className={`${COMMAND_BUTTON_SIZE_CLASSES} inline-flex items-center text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer`}>
                          <CheckCircle2 /> อนุมัติ
                        </button>
                        <button type="button" onClick={() => void show(s, 'REJECT')} className={`${COMMAND_BUTTON_SIZE_CLASSES} inline-flex items-center text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer`}>
                          <XCircle /> ไม่ผ่าน
                        </button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableFrame>

      <AppModal isOpen={Boolean(open)} onClose={() => !busy && setOpen(null)} size="md">
        <AppModalHeader onClose={() => !busy && setOpen(null)} icon={<ReceiptText className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />}>
          <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
            {open?.mode === 'APPROVE' ? 'อนุมัติสลิป' : open?.mode === 'REJECT' ? 'สลิปไม่ผ่าน' : 'สลิปจาก LINE'} · บิล {slip?.bill_no || '-'}
          </h3>
        </AppModalHeader>
        <AppModalBody className="space-y-3">
          {slip && (
            <p className="text-xs text-slate-700 dark:text-slate-300">
              {slip.customer_name || '-'} · ยอดในสลิป <b className="tabular-nums">{money(slip.amount)}</b> บาท · ยอดค้างบิล <b className="tabular-nums">{money(slip.balance_due)}</b> บาท
            </p>
          )}
          {slip?.check_status && (
            <p className={`text-xs rounded-lg px-2.5 py-1.5 ${PILL_TONE[CHECK[slip.check_status].tone]}`} data-testid="slip-check-result">
              <b>{CHECK[slip.check_status].text}</b>
              {slip.check_detail?.amount_slip !== undefined && <> · ยอดที่ธนาคารยืนยัน {money(slip.check_detail.amount_slip)} บาท</>}
              {slip.check_detail?.receiver && <> · ผู้รับ {slip.check_detail.receiver}</>}
              {checkReasons(slip).length > 0 && <> · {checkReasons(slip).join(' · ')}</>}
            </p>
          )}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 min-h-40 grid place-items-center overflow-hidden">
            {open?.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- a short signed link to a private slip picture
              <img src={open.image} alt="รูปสลิป" className="max-h-[50vh] w-auto object-contain" />
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">กำลังเปิดรูปสลิป…</span>
            )}
          </div>
          {open?.mode === 'APPROVE' && (
            <div>
              <label className={SETTINGS_LABEL} htmlFor="slip-amount">ยอดที่ได้รับจริง (บาท) · รับเข้าบิลเป็นเงินโอน</label>
              <NumericInput id="slip-amount" value={amount} onChange={(v) => setAmount(v === '' ? '' : Number(v))} min={0} allowDecimals className={SETTINGS_INPUT} />
            </div>
          )}
          {open?.mode === 'REJECT' && (
            <div>
              <label className={SETTINGS_LABEL} htmlFor="slip-reason">เหตุผล (ส่งให้ลูกค้าทาง LINE)</label>
              <textarea id="slip-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={`${SETTINGS_INPUT} h-auto py-2`} />
            </div>
          )}
        </AppModalBody>
        {open?.mode === 'VIEW' ? (
          <AppModalFooter onCancel={() => setOpen(null)} cancelText="ปิด" />
        ) : (
          <AppModalFooter
            onCancel={() => setOpen(null)}
            onConfirm={() => void decide()}
            confirmText={open?.mode === 'APPROVE' ? 'อนุมัติและรับยอด' : 'ยืนยันไม่ผ่าน'}
            confirmButtonColor={open?.mode === 'APPROVE' ? 'emerald' : 'red'}
            isConfirmLoading={busy}
            isConfirmDisabled={busy}
          />
        )}
      </AppModal>
    </div>
  )
}
