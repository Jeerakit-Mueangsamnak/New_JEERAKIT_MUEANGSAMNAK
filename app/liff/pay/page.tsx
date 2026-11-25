'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Camera, CheckCircle2, Loader2, X } from 'lucide-react'
import { COMMAND_BUTTON_SIZE_CLASSES, BUTTON_FUNCTION_COLOURS } from '@/components/common/ActionButton'
import { NumericInput } from '@/components/common/NumericInput'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { postLiff, useLiff } from '@/lib/line/use-liff'
import { shrinkPhoto } from '@/lib/line/shrink-photo'
import { formatPromptPayNumber, promptPayPayload } from '@/lib/promptpay'
import { qrDataUrl } from '@/lib/qr-code'

/**
 * Pay form inside LINE (owner 2026-11-25), from the bill card: https://liff.line.me/<id>/pay?bill=<bill id>[&tab=slip].
 * The shop's PromptPay QR for what is still owed, and a slip to send. The slip waits for the shop: nothing is paid
 * until the shop checks it, and the answer comes back in this LINE chat.
 */

interface PayForm {
  bill: { id: string; bill_no: string | null; status: string; grand_total: number; balance_due: number; payable: boolean }
  customer: string | null
  shop: { name: string | null; promptpay: string | null; promptpay_type: string | null; bank: string | null; account_name: string | null; account_no: string | null }
  slips: Array<{ amount: number; status: 'PENDING' | 'APPROVED' | 'REJECTED'; created_at: string; approved_amount: number | null; reject_reason: string | null }>
}
type Answer = { ok: boolean; message?: string } & Partial<PayForm>

const money = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const showWhen = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })
const SLIP_STATE: Record<PayForm['slips'][number]['status'], { text: string; cls: string }> = {
  PENDING: { text: 'รอร้านตรวจ', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' },
  APPROVED: { text: 'ร้านรับยอดแล้ว', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' },
  REJECTED: { text: 'ร้านยืนยันไม่ได้', cls: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' },
}

export default function LiffPayPage() {
  const opened = useLiff()
  const [form, setForm] = useState<PayForm | null>(null)
  const [error, setError] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const slipRef = useRef<HTMLElement>(null)
  const query = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
  const billId = query?.get('bill') || ''
  const toSlip = query?.get('tab') === 'slip'

  const take = useCallback((r: Answer) => {
    if (r.bill && r.shop) setForm({ bill: r.bill, customer: r.customer ?? null, shop: r.shop, slips: r.slips ?? [] })
  }, [])

  useEffect(() => {
    if (opened.phase === 'error') setError(opened.message)
    if (opened.phase !== 'ready') return
    void postLiff<Answer>(opened.liff, '/api/line/liff-pay', { action: 'LOAD', billId }).then((r) => {
      if (!r.ok) return setError(r.message || 'เปิดบิลไม่สำเร็จ')
      take(r)
      if (r.bill) setAmount(r.bill.balance_due > 0 ? r.bill.balance_due : '')
    })
  }, [opened, billId, take])

  // the shop's PromptPay QR for what is still owed (drawn here; nothing is sent anywhere)
  useEffect(() => {
    const id = form?.shop.promptpay
    const owed = form?.bill.balance_due ?? 0
    const payload = id && owed > 0 ? promptPayPayload(id, owed) : null
    if (!payload) return setQr(null)
    void qrDataUrl(payload, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(null))
  }, [form?.shop.promptpay, form?.bill.balance_due])

  useEffect(() => {
    if (form && toSlip) slipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [form, toSlip])

  const pick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    // a slip must stay readable: larger than a job photo
    setPhoto(await shrinkPhoto(file, 1600, 0.8))
    if (fileRef.current) fileRef.current.value = ''
  }

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (opened.phase !== 'ready' || busy || !form) return
    if (!photo) return setMessage('กรุณาแนบรูปสลิป')
    if (amount === '' || amount <= 0) return setMessage('กรุณาใส่ยอดที่โอน')
    if (amount > form.bill.balance_due) return setMessage(`ยอดที่โอนต้องไม่เกินยอดค้าง ${money(form.bill.balance_due)} บาท`)
    setBusy(true)
    setMessage('')
    const r = await postLiff<Answer>(opened.liff, '/api/line/liff-pay', { action: 'SLIP', billId, amount, photo })
    setBusy(false)
    if (!r.ok) return setMessage(r.message || 'ส่งสลิปไม่สำเร็จ')
    take(r)
    setPhoto(null)
    setSent(true)
  }

  if (error || !form) {
    return (
      <main className="min-h-screen p-5 bg-slate-50 dark:bg-black text-sm">
        {error ? (
          <p className="flex items-start gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" /> {error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังเปิดบิล…
          </p>
        )}
      </main>
    )
  }

  const { bill, shop } = form
  const card = 'mx-3 mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3'
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-black text-sm text-slate-900 dark:text-slate-100 pb-8">
      <header className="bg-[#06C755] text-white px-4 py-3">
        <h1 className="text-base font-black leading-6">ชำระเงิน · บิล {bill.bill_no || '-'}</h1>
        <p className="text-xs font-bold opacity-90">{[form.customer, shop.name].filter(Boolean).join(' · ')}</p>
      </header>

      <section className={card}>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">ยอดค้างชำระ</p>
        <p className="text-2xl font-black tabular-nums text-emerald-700 dark:text-emerald-400">{money(bill.balance_due)} บาท</p>
      </section>

      {bill.payable && (
        <section className={`${card} flex flex-col items-center gap-2 text-center`}>
          {qr && shop.promptpay ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL QR, nothing to optimise */}
              <img src={qr} alt="QR พร้อมเพย์ของร้าน" className="w-56 h-56 rounded-xl bg-white p-2 border border-slate-200" />
              <p className="font-bold">พร้อมเพย์ {formatPromptPayNumber(shop.promptpay, shop.promptpay_type)}</p>
            </>
          ) : null}
          {(shop.bank || shop.account_no) && (
            <p className="font-bold">
              {[shop.bank, shop.account_no].filter(Boolean).join(' ')}
            </p>
          )}
          {shop.account_name && <p className="text-xs text-slate-600 dark:text-slate-300">ชื่อบัญชี {shop.account_name}</p>}
          {!shop.promptpay && !shop.account_no && <p className="text-xs text-amber-700 dark:text-amber-300">ร้านยังไม่ได้ใส่บัญชีรับเงิน กรุณาติดต่อร้าน</p>}
        </section>
      )}

      <section ref={slipRef} className={card}>
        <h2 className="text-sm font-black mb-2">แนบสลิป</h2>
        {sent ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-emerald-700 dark:text-emerald-300 font-bold">
              <CheckCircle2 className="w-5 h-5 shrink-0" /> ส่งสลิปแล้ว ร้านจะตรวจและแจ้งผลทาง LINE นี้
            </p>
            {bill.payable && (
              <button type="button" onClick={() => setSent(false)} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 border justify-center ${BUTTON_FUNCTION_COLOURS.cancel}`}>
                แนบสลิปอีกใบ
              </button>
            )}
            {opened.phase === 'ready' && opened.liff.isInClient() && (
              <button type="button" onClick={() => opened.liff.closeWindow()} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 bg-[#06C755] text-white justify-center`}>
                ปิดหน้านี้
              </button>
            )}
          </div>
        ) : bill.payable ? (
          <form onSubmit={(e) => void send(e)} className="space-y-3">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files)} />
            {photo ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- the picked photo, shown before it is sent */}
                <img src={photo} alt="สลิปที่เลือก" className="w-full max-h-80 object-contain rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800" />
                <button type="button" aria-label="เอารูปออก" onClick={() => setPhoto(null)} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 border justify-center ${BUTTON_FUNCTION_COLOURS.cancel}`}>
                <Camera className="w-4 h-4" /> เลือกรูปสลิป
              </button>
            )}
            <div>
              <label className={SETTINGS_LABEL} htmlFor="pay-amount">ยอดที่โอน (บาท)</label>
              <NumericInput id="pay-amount" value={amount} onChange={(v) => setAmount(v === '' ? '' : Number(v))} min={0} allowDecimals className={SETTINGS_INPUT} />
            </div>
            {message && <p className="text-xs font-bold text-red-700 dark:text-red-400">{message}</p>}
            <button type="submit" disabled={busy} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 bg-[#06C755] text-white justify-center disabled:opacity-60`}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} ส่งสลิป
            </button>
          </form>
        ) : (
          <p className="text-slate-600 dark:text-slate-300">บิลนี้ไม่มียอดค้างชำระแล้ว</p>
        )}
      </section>

      {form.slips.length > 0 && (
        <section className={card}>
          <h2 className="text-sm font-black mb-2">สลิปที่ส่งแล้ว</h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {form.slips.map((s, i) => (
              <li key={`${s.created_at}-${i}`} className="py-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold tabular-nums">{money(s.approved_amount ?? s.amount)} บาท</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{showWhen(s.created_at)}</p>
                  {s.reject_reason && <p className="text-xs text-red-700 dark:text-red-400">{s.reject_reason}</p>}
                </div>
                <span className={`shrink-0 h-6 px-2 rounded-full text-[11px] font-bold inline-flex items-center ${SLIP_STATE[s.status].cls}`}>{SLIP_STATE[s.status].text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
