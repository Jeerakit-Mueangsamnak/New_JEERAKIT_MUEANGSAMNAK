'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import {
  TABLE_TOOLBAR_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
  TAB_CONTAINER_CLASSES,
  ActionButton,
} from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { CustomSelect } from '@/components/common/CustomSelect'
import { NumericInput } from '@/components/common/NumericInput'
import { useToast } from '@/components/common/Toast'
import {
  approveLineSlip,
  getLineSlipImageUrl,
  listLineSlipBills,
  listLineSlips,
  rejectLineSlip,
  type LineSlipBillChoice,
  type LineSlipRow,
  type LineSlipStatus,
} from '@/app/actions/line'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { PILL_TONE, thaiDateTime, type PillTone } from '@/features/settings/components/line/line-people-model'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { SLIP_CHECK_REASON_LABEL, type SlipCheckReason } from '@/lib/line/slip-check'

/**
 * สลิปรอตรวจ (owner 2026-11-25; 2026-11-28 one window): the slips on the left, the picked slip's picture on the right.
 * A pending slip gets its bill from a dropdown of the customer's open bills (several bills, several slips), then
 * อนุมัติ takes the money into that bill (once: the database locks the slip and uses its own key) and tells the
 * customer; ไม่ผ่าน sends the reason.
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
const PILL = 'inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold whitespace-nowrap'

export function LineSlipsPanel({ tabs, onChanged }: { tabs: ReactNode; onChanged?: () => void }) {
  const { showToast } = useToast()
  const [filter, setFilter] = useState<Filter>('PENDING')
  const [rows, setRows] = useState<LineSlipRow[]>([])
  const [counts, setCounts] = useState<Record<LineSlipStatus, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [image, setImage] = useState<{ id: string; url: string | null } | null>(null)
  const [bills, setBills] = useState<{ id: string; list: LineSlipBillChoice[] } | null>(null)
  const [billId, setBillId] = useState('')
  const [amount, setAmount] = useState<number | ''>('')
  const [rejecting, setRejecting] = useState(false)
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

  // the first slip is shown at once; a slip gone from the list (decided, other filter) gives way to the first one
  const slip = rows.find((s) => s.id === pickedId) ?? rows[0] ?? null
  const slipId = slip?.id ?? null
  const pending = slip?.status === 'PENDING'

  useEffect(() => {
    if (!slip) return
    let live = true
    setRejecting(false)
    setReason('')
    setBillId(slip.bill_id)
    setAmount(Math.min(slip.amount, slip.balance_due) || '')
    getLineSlipImageUrl(slip.image_path).then((r) => {
      if (!live) return
      setImage({ id: slip.id, url: r.success ? (r.data ?? null) : null })
      if (!r.success) showToast('เปิดรูปสลิปไม่สำเร็จ', r.error, 'ERROR')
    })
    if (slip.status === 'PENDING') {
      listLineSlipBills(slip.id).then((r) => {
        if (!live) return
        if (r.success && r.data) setBills({ id: slip.id, list: r.data })
        else showToast('โหลดบิลของลูกค้าไม่สำเร็จ', r.error, 'ERROR')
      })
    }
    return () => {
      live = false
    }
    // only when another slip is shown, not on every refresh of the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slipId])

  const choices = bills && bills.id === slipId ? bills.list : []
  const chosen = choices.find((b) => b.id === billId)
  const pickBill = (id: string) => {
    setBillId(id)
    const b = choices.find((x) => x.id === id)
    if (slip && b) setAmount(Math.min(slip.amount, b.balance_due) || '')
  }

  const approve = async () => {
    if (!slip || busy) return
    if (!billId) return showToast('กรุณาเลือกบิลของสลิปนี้', undefined, 'ERROR')
    if (amount === '' || amount <= 0) return showToast('กรุณาใส่ยอดที่ได้รับ', undefined, 'ERROR')
    setBusy(true)
    try {
      const r = await approveLineSlip({ slipId: slip.id, billId, amount: Number(amount) })
      if (!r.success) return showToast('อนุมัติไม่สำเร็จ', r.error, 'ERROR')
      showToast('รับยอดเข้าบิลแล้ว', `บิล ${chosen?.bill_no || slip.bill_no || '-'}`, 'SUCCESS')
      await load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (!slip || busy) return
    if (!reason.trim()) return showToast('กรุณาระบุเหตุผล', undefined, 'ERROR')
    setBusy(true)
    try {
      const r = await rejectLineSlip({ slipId: slip.id, billId: slip.bill_id, reason })
      if (!r.success) return showToast('บันทึกไม่สำเร็จ', r.error, 'ERROR')
      showToast('แจ้งลูกค้าว่าสลิปไม่ผ่านแล้ว', `บิล ${slip.bill_no || '-'}`, 'SUCCESS')
      await load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const tabClass = (on: boolean) => `${TAB_BUTTON_BASE_CLASSES} ${on ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`
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
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {/* the slips: tap one to see it on the right */}
        <div className="md:w-[45%] min-h-48 md:min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700">
          <DataTableFrame fill rowCount={rows.length} className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent">
            <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} aria-label="ตารางสลิปจาก LINE">
              <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
                <tr>
                  <th className={`${TH} pl-3`}>ส่งเมื่อ</th>
                  <th className={TH}>ลูกค้า</th>
                  <th className={`${TH} text-right`}>ยอดในสลิป</th>
                  <th className={`${TH} pr-3 text-center`}>สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setPickedId(s.id)}
                    aria-selected={s.id === slipId}
                    className={`cursor-pointer transition-colors ${s.id === slipId ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                  >
                    <td className="pl-3 pr-2 py-2 tabular-nums text-slate-700 dark:text-slate-300">{thaiDateTime(s.created_at)}</td>
                    <td className="px-2 py-2 font-semibold text-slate-900 dark:text-slate-100">
                      {s.customer_name || '-'}
                      <span className="block text-[10px] font-normal font-mono text-slate-500 dark:text-slate-400">บิล {s.bill_no || '-'}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold">{money(s.approved_amount ?? s.amount)}</td>
                    <td className="pl-2 pr-3 py-2 text-center">
                      <span className={`${PILL} ${PILL_TONE[STATE[s.status].tone]}`}>{STATE[s.status].text}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableFrame>
        </div>

        {/* the picked slip: picture, check result, which bill, and the decision */}
        {slip && (
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto p-3 space-y-3" data-testid="line-slip-view">
            <p className="text-xs text-slate-700 dark:text-slate-300">
              {slip.customer_name || '-'}
              {slip.line_name && <> · LINE {slip.line_name}</>} · ยอดในสลิป <b className="tabular-nums">{money(slip.amount)}</b> บาท
            </p>
            {slip.check_status && (
              <p className={`text-xs rounded-lg px-2.5 py-1.5 ${PILL_TONE[CHECK[slip.check_status].tone]}`} data-testid="slip-check-result">
                <b>{CHECK[slip.check_status].text}</b>
                {slip.check_detail?.amount_slip !== undefined && <> · ยอดที่ธนาคารยืนยัน {money(slip.check_detail.amount_slip)} บาท</>}
                {slip.check_detail?.receiver && <> · ผู้รับ {slip.check_detail.receiver}</>}
                {checkReasons(slip).length > 0 && <> · {checkReasons(slip).join(' · ')}</>}
              </p>
            )}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 min-h-40 grid place-items-center overflow-hidden">
              {image?.id === slip.id && image.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a short signed link to a private slip picture
                <img src={image.url} alt="รูปสลิป" className="max-h-[45vh] w-auto object-contain" />
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">กำลังเปิดรูปสลิป…</span>
              )}
            </div>

            {pending ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <span className={SETTINGS_LABEL}>สลิปนี้ของบิล</span>
                    <CustomSelect
                      value={billId}
                      ariaLabel="สลิปนี้ของบิล"
                      onChange={(v) => pickBill(String(v))}
                      options={choices.map((b) => ({ value: b.id, label: b.bill_no || '-', sublabel: `ค้าง ${money(b.balance_due)}` }))}
                    />
                  </div>
                  <div>
                    <label className={SETTINGS_LABEL} htmlFor="slip-amount">ยอดที่ได้รับจริง (บาท)</label>
                    <NumericInput id="slip-amount" value={amount} onChange={(v) => setAmount(v === '' ? '' : Number(v))} min={0} allowDecimals className={SETTINGS_INPUT} />
                  </div>
                </div>
                {rejecting && (
                  <div>
                    <label className={SETTINGS_LABEL} htmlFor="slip-reason">เหตุผล (ส่งให้ลูกค้าทาง LINE)</label>
                    <textarea id="slip-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={`${SETTINGS_INPUT} h-auto py-2`} />
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  {rejecting ? (
                    <>
                      <ActionButton variant="cancel" disabled={busy} onClick={() => setRejecting(false)}>
                        ยกเลิก
                      </ActionButton>
                      <ActionButton variant="danger" icon={<XCircle />} disabled={busy} onClick={() => void reject()}>
                        ยืนยันไม่ผ่าน
                      </ActionButton>
                    </>
                  ) : (
                    <>
                      <ActionButton variant="danger" icon={<XCircle />} disabled={busy} onClick={() => setRejecting(true)}>
                        ไม่ผ่าน
                      </ActionButton>
                      <ActionButton variant="primary" icon={<CheckCircle2 />} disabled={busy || !billId} onClick={() => void approve()}>
                        อนุมัติและรับยอด
                      </ActionButton>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-700 dark:text-slate-300">
                บิล <b className="font-mono">{slip.bill_no || '-'}</b> · <span className={`${PILL} ${PILL_TONE[STATE[slip.status].tone]}`}>{STATE[slip.status].text}</span>
                {slip.decided_at && <> · {thaiDateTime(slip.decided_at)}</>}
                {slip.decided_by && <> · {slip.decided_by}</>}
                {slip.reject_reason && <span className="block mt-1 text-red-700 dark:text-red-400">{slip.reject_reason}</span>}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
