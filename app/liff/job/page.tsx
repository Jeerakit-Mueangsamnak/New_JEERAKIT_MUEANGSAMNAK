'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Camera, CheckCircle2, Loader2, MapPin, Phone, X } from 'lucide-react'
import { COMMAND_BUTTON_SIZE_CLASSES, BUTTON_FUNCTION_COLOURS } from '@/components/common/ActionButton'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { postLiff, useLiff } from '@/lib/line/use-liff'
import { JOB_PHOTO_LIMIT } from '@/lib/line/job-photos'
import { currentRunEvents, stagesForType } from '@/lib/work-order-stages'

/**
 * Driver job form inside LINE (owner 2026-11-13), from the "เปิดฟอร์มงาน" button of the job card:
 * https://liff.line.me/<id>/job?task=<task id>. Shows the job, its items and steps; รับงาน, then each
 * next step with a note and up to 3 photos. The server checks the LINE token and the driver.
 */

interface Job {
  task: { id: string; title: string; detail: string | null; status: 'SENT' | 'ACCEPTED' | 'DONE' | 'CANCELLED' }
  holds: boolean
  appointment: { type: string | null; start: string | null; place: string | null; contact: string | null; phone: string | null; description: string | null }
  items: Array<{ name: string; qty: number; unit: string | null }>
  events: Array<{ stage: string; status: string; timestamp?: string; note?: string; photos?: string[] }>
  next_stage: string | null
}
type Answer = { ok: boolean; message?: string; job?: Job }

/** Phone photo → JPEG of at most 1280 px (a few hundred KB), as a data URL. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = url
    })
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } finally {
    URL.revokeObjectURL(url)
  }
}

const showWhen = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })

const mapUrl = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`

export default function LiffJobPage() {
  const opened = useLiff()
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const taskId = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('task') || ''

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      if (opened.phase !== 'ready') return null
      const r = await postLiff<Answer>(opened.liff, '/api/line/liff-job', { taskId, ...body })
      if (r.job) setJob(r.job)
      return r
    },
    [opened, taskId]
  )

  useEffect(() => {
    if (opened.phase === 'error') setError(opened.message)
    if (opened.phase !== 'ready') return
    void send({ action: 'LOAD' }).then((r) => {
      if (r && !r.ok) setError(r.message || 'เปิดงานไม่สำเร็จ')
    })
  }, [opened, send])

  const act = async (body: Record<string, unknown>) => {
    if (busy) return
    setBusy(true)
    setNotice('')
    const r = await send(body)
    setBusy(false)
    if (!r) return
    setNotice(r.message || (r.ok ? 'บันทึกแล้ว' : 'ทำรายการไม่สำเร็จ'))
    if (r.ok && body.action === 'STEP') {
      setNote('')
      setPhotos([])
    }
  }

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const room = JOB_PHOTO_LIMIT - photos.length
    const picked = await Promise.all(Array.from(files).slice(0, Math.max(0, room)).map(shrinkPhoto))
    setPhotos((p) => [...p, ...picked].slice(0, JOB_PHOTO_LIMIT))
    if (fileRef.current) fileRef.current.value = ''
  }

  if (error || opened.phase === 'loading' || !job) {
    return (
      <main className="min-h-screen p-5 bg-slate-50 dark:bg-black text-sm">
        {error ? (
          <p className="flex items-start gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" /> {error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังเปิดงาน…
          </p>
        )}
      </main>
    )
  }

  const type = job.appointment.type
  const done = new Map(currentRunEvents(job.events).filter((e) => e.status === 'DONE').map((e) => [e.stage.toUpperCase(), e]))
  const steps = stagesForType(type).filter((s) => s.key !== 'DISPATCH' && s.key !== 'CLOSED')
  const next = job.next_stage ? steps.find((s) => s.key === job.next_stage) : undefined
  const open = job.holds && job.task.status !== 'CANCELLED'
  const a = job.appointment
  const rows: Array<[string, React.ReactNode]> = [
    ['วันเวลา', a.start ? showWhen(a.start) : ''],
    ['ลูกค้า', a.contact ?? ''],
    ['โทร', a.phone ? <a href={`tel:${a.phone}`} className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 font-bold"><Phone className="w-3.5 h-3.5" />{a.phone}</a> : ''],
    ['สถานที่', a.place ? <a href={mapUrl(a.place)} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-blue-700 dark:text-blue-400 font-bold"><MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />{a.place}</a> : ''],
    ['รายละเอียด', job.task.detail || a.description || ''],
  ]

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-black text-sm text-slate-900 dark:text-slate-100 pb-8">
      <header className="bg-[#06C755] text-white px-4 py-3">
        <h1 className="text-base font-black leading-6">{job.task.title}</h1>
        <p className="text-xs font-bold opacity-90">
          {job.task.status === 'CANCELLED' || !job.holds ? 'งานนี้ถูกยกเลิกหรือเปลี่ยนคนขับแล้ว' : job.task.status === 'SENT' ? 'รอรับงาน' : next ? `ขั้นถัดไป: ${next.label}` : 'งานเสร็จแล้ว'}
        </p>
      </header>

      <div className="p-3 space-y-3">
        <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.filter(([, v]) => v !== '').map(([label, value]) => (
            <div key={label} className="flex gap-3 px-3 py-2">
              <span className="w-20 shrink-0 text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
              <span className="min-w-0 flex-1 break-words">{value}</span>
            </div>
          ))}
        </section>

        {job.items.length > 0 && (
          <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
            <h2 className="px-3 py-2 text-xs font-black border-b border-slate-100 dark:border-slate-800">รายการของ</h2>
            {job.items.map((it, i) => (
              <div key={i} className="flex justify-between gap-3 px-3 py-1.5 text-xs">
                <span className="min-w-0 break-words">{it.name}</span>
                <span className="shrink-0 font-bold">
                  {Number(it.qty).toLocaleString('th-TH')} {it.unit ?? ''}
                </span>
              </div>
            ))}
          </section>
        )}

        <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
          <h2 className="px-3 py-2 text-xs font-black border-b border-slate-100 dark:border-slate-800">ขั้นตอน</h2>
          {steps.map((s, i) => {
            const ev = done.get(s.key)
            return (
              <div key={s.key} className={`px-3 py-1.5 text-xs ${s.key === next?.key ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''}`}>
                <div className="flex items-center gap-2">
                  {ev ? <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" /> : <span className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 shrink-0" />}
                  <span className={`flex-1 ${ev ? 'font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
                    {i + 1}. {s.label}
                  </span>
                  {ev?.timestamp && <span className="font-mono text-slate-500 dark:text-slate-400">{new Date(ev.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</span>}
                </div>
                {ev?.note && ev.note !== 'อัปเดตทาง LINE' && <p className="ml-6 text-slate-600 dark:text-slate-300 break-words">{ev.note}</p>}
                {ev?.photos && ev.photos.length > 0 && <p className="ml-6 text-slate-500 dark:text-slate-400">รูป {ev.photos.length} รูป</p>}
              </div>
            )
          })}
        </section>

        {open && job.task.status === 'SENT' && (
          <button type="button" disabled={busy} onClick={() => void act({ action: 'ACCEPT' })} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 bg-[#06C755] text-white justify-center disabled:opacity-60`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} รับงาน
          </button>
        )}

        {open && job.task.status === 'ACCEPTED' && next && (
          <section className="rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 p-3 space-y-3">
            <h2 className="text-sm font-black">บันทึกขั้นตอน: {next.label}</h2>
            <div>
              <label className={SETTINGS_LABEL} htmlFor="job-note">หมายเหตุ</label>
              <textarea id="job-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${SETTINGS_INPUT} h-auto py-2`} />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {photos.map((src, i) => (
                  <div key={i} className="relative w-20 h-20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`รูปที่ ${i + 1}`} className="w-20 h-20 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                    <button type="button" aria-label={`ลบรูปที่ ${i + 1}`} onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {photos.length < JOB_PHOTO_LIMIT && (
                <button type="button" onClick={() => fileRef.current?.click()} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 border justify-center ${BUTTON_FUNCTION_COLOURS.open}`}>
                  <Camera className="w-4 h-4" /> ถ่าย / เลือกรูป ({photos.length}/{JOB_PHOTO_LIMIT})
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
            </div>
            <button type="button" disabled={busy} onClick={() => void act({ action: 'STEP', stage: next.key, note, photos })} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 bg-[#06C755] text-white justify-center disabled:opacity-60`}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} บันทึก “{next.label}”
            </button>
          </section>
        )}

        {notice && <p className="text-xs font-bold text-center text-slate-700 dark:text-slate-200">{notice}</p>}

        {job.task.status === 'DONE' && opened.phase === 'ready' && opened.liff.isInClient() && (
          <button type="button" onClick={() => opened.liff.closeWindow()} className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full !h-11 flex items-center gap-2 border justify-center ${BUTTON_FUNCTION_COLOURS.cancel}`}>
            ปิดหน้านี้
          </button>
        )}
      </div>
    </main>
  )
}
