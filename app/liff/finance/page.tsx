'use client'
import React, { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { COMMAND_BUTTON_SIZE_CLASSES, BUTTON_FUNCTION_COLOURS } from '@/components/common/ActionButton'
import { NumericInput } from '@/components/common/NumericInput'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { EXPENSE_CATEGORIES } from '@/features/finance/expense-categories'
import { postLiff, useLiff } from '@/lib/line/use-liff'

/**
 * Income / expense form inside LINE (owner 2026-11-13): https://liff.line.me/<id>/finance, for the
 * OWNER's own linked LINE only. Saved straight into finance, same lists as การเงิน › เพิ่มรายการ.
 */

const CHANNELS = [
  { code: 'CASH', label: 'เงินสด' },
  { code: 'TRANSFER', label: 'โอนธนาคาร' },
  { code: 'QR', label: 'PromptPay QR' },
  { code: 'OTHER', label: 'อื่น ๆ' },
]
type Kind = 'INCOME' | 'EXPENSE'

export default function LiffFinancePage() {
  const opened = useLiff()
  const [error, setError] = useState('')
  const [owner, setOwner] = useState<string | null>(null)
  const [incomeItems, setIncomeItems] = useState<string[]>([])
  const [kind, setKind] = useState<Kind>('EXPENSE')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState<number | ''>('')
  const [channel, setChannel] = useState('CASH')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState<{ docNo: string; amount: number } | null>(null)

  useEffect(() => {
    if (opened.phase === 'error') setError(opened.message)
    if (opened.phase !== 'ready') return
    void postLiff<{ ok: boolean; message?: string; name?: string; incomeItems?: string[] }>(opened.liff, '/api/line/liff-finance', { action: 'LOAD' }).then((r) => {
      if (!r.ok) return setError(r.message || 'เปิดฟอร์มไม่สำเร็จ')
      setOwner(r.name || '')
      setIncomeItems(r.incomeItems?.length ? r.incomeItems : ['รายรับอื่นๆ'])
    })
  }, [opened])

  const categories = kind === 'EXPENSE' ? EXPENSE_CATEGORIES.map((c) => ({ value: c.code, label: c.label })) : incomeItems.map((x) => ({ value: x, label: x }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (opened.phase !== 'ready' || busy) return
    if (!category) return setMessage('กรุณาเลือกหมวด')
    if (amount === '' || amount <= 0) return setMessage('กรุณากรอกจำนวนเงินมากกว่า 0')
    setBusy(true)
    setMessage('')
    const r = await postLiff<{ ok: boolean; message?: string; docNo?: string; amount?: number }>(opened.liff, '/api/line/liff-finance', {
      action: 'SAVE',
      kind,
      category,
      amount,
      channel,
      note,
    })
    setBusy(false)
    if (!r.ok) return setMessage(r.message || 'บันทึกไม่สำเร็จ')
    setSaved({ docNo: r.docNo || '', amount: r.amount ?? Number(amount) })
  }

  const again = () => {
    setSaved(null)
    setCategory('')
    setAmount('')
    setNote('')
    setMessage('')
  }

  if (error || owner === null) {
    return (
      <main className="min-h-screen p-5 bg-slate-50 dark:bg-black text-sm">
        {error ? (
          <p className="flex items-start gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" /> {error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังเปิดฟอร์ม…
          </p>
        )}
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-black text-sm text-slate-900 dark:text-slate-100 pb-8">
      <header className="bg-[#06C755] text-white px-4 py-3">
        <h1 className="text-base font-black leading-6">บันทึกรายรับ / รายจ่าย</h1>
        {owner && <p className="text-xs font-bold opacity-90">{owner}</p>}
      </header>

      {saved ? (
        <div className="p-4 space-y-3">
          <p className="flex items-start gap-2 text-emerald-700 dark:text-emerald-300 font-bold">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            บันทึกเข้าการเงินแล้ว {saved.docNo} · {saved.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
          </p>
          <button type="button" onClick={again} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 bg-[#06C755] text-white justify-center`}>
            บันทึกอีกรายการ
          </button>
          {opened.phase === 'ready' && opened.liff.isInClient() && (
            <button type="button" onClick={() => opened.liff.closeWindow()} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 border justify-center ${BUTTON_FUNCTION_COLOURS.cancel}`}>
              ปิดหน้านี้
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={(e) => void save(e)} className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ประเภทรายการ">
            {(['INCOME', 'EXPENSE'] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k)
                  setCategory('')
                }}
                className={`h-11 rounded-xl border text-sm font-black ${
                  kind === k
                    ? k === 'INCOME'
                      ? 'bg-emerald-700 border-emerald-700 text-white'
                      : 'bg-red-700 border-red-700 text-white'
                    : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'
                }`}
              >
                {k === 'INCOME' ? 'รายรับ' : 'รายจ่าย'}
              </button>
            ))}
          </div>
          <div>
            <label className={SETTINGS_LABEL} htmlFor="fin-category">หมวด</label>
            <select id="fin-category" value={category} onChange={(e) => setCategory(e.target.value)} className={SETTINGS_INPUT}>
              <option value="">เลือกหมวด</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={SETTINGS_LABEL} htmlFor="fin-amount">จำนวนเงิน (บาท)</label>
            <NumericInput id="fin-amount" value={amount} onChange={(v) => setAmount(v === '' ? '' : Number(v))} min={0} allowDecimals className={SETTINGS_INPUT} />
          </div>
          <div>
            <label className={SETTINGS_LABEL} htmlFor="fin-channel">ช่องทาง</label>
            <select id="fin-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={SETTINGS_INPUT}>
              {CHANNELS.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={SETTINGS_LABEL} htmlFor="fin-note">รายละเอียด</label>
            <textarea id="fin-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${SETTINGS_INPUT} h-auto py-2`} />
          </div>
          {message && <p className="text-xs font-bold text-red-700 dark:text-red-400">{message}</p>}
          <button type="submit" disabled={busy} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 bg-[#06C755] text-white justify-center disabled:opacity-60`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} บันทึก
          </button>
        </form>
      )}
    </main>
  )
}
