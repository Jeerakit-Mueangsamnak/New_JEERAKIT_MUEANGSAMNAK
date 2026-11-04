'use client'

/**
 * คนใน LINE (/line): who is on the shop's LINE OA.
 * - รอร้านตรวจ: friends not linked yet — still not answered in the chat, or typed the phone of a
 *   customer who already has another LINE (or of several customers). The shop may type name +
 *   phone for them (same rule as the chat, decided by the database) or reject them.
 * - พนักงานส่งของ: drivers without a POS account and their one-time links.
 * - ลูกค้าที่ผูก LINE แล้ว, tagged when they registered themselves in the chat.
 * - QR / link to add the shop OA as a friend (adding a friend links nobody).
 * The list refreshes when the screen comes back into view and every 30 s while it is shown
 * (no realtime: line_contacts carries the LINE user id, which never reaches a browser).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { CheckCircle2, Copy, Link2Off, MessageCircle, QrCode, RefreshCw, UserPlus, Users } from 'lucide-react'
import { ActionButton } from '@/components/common/ActionButton'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { createClient } from '@/lib/supabase/client'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { LINE_TEMPLATES, type LineTemplateKey } from '@/lib/line/templates'
import { getLineOaInfo, registerLineContactByShop, rejectLineContact, unlinkLineContact } from '@/app/actions/line'
import { DeliveryDriversPanel } from '@/features/settings/components/DeliveryDriversPanel'
import { LineChatPreview, type LineChatBubble } from '@/features/settings/components/LineChatPreview'
import { SETTINGS_HELPER, SETTINGS_INPUT, SETTINGS_LABEL, SETTINGS_SECTION, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'

type RegisterStatus = 'WAITING' | 'PHONE_TAKEN' | 'DUPLICATE'

interface PendingContact {
  id: string
  display_name: string | null
  register_status: RegisterStatus
  register_customer_id: string | null
  typed_name: string | null
  typed_phone: string | null
  created_at: string
  last_event_at: string | null
}
interface LinkedContact {
  id: string
  display_name: string | null
  customer_id: string
  linked_at: string | null
  followed: boolean
  self_registered: boolean
}
interface CustomerLite {
  id: string
  name: string
  phone: string | null
}

const STATUS_LABEL: Record<RegisterStatus, string> = {
  WAITING: 'ยังไม่ตอบในแชต',
  PHONE_TAKEN: 'เบอร์นี้ผูก LINE อื่นแล้ว',
  DUPLICATE: 'เบอร์นี้มีลูกค้าหลายรายการ',
}
const PILL = 'inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold'
const REFRESH_MS = 30_000
const PLACEHOLDER = /\{([^{}]+)\}/g

const thaiDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'
const initials = (s: string | null) => (s || '?').trim().slice(0, 2)
const phoneText = (p: string | null) => (p && /^\d{10}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p || '')

export function LinePeoplePage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { settings } = useSystemSettings()
  const [pending, setPending] = useState<PendingContact[]>([])
  const [linked, setLinked] = useState<LinkedContact[]>([])
  const [customers, setCustomers] = useState<Record<string, CustomerLite>>({})
  const [takenBy, setTakenBy] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [notReady, setNotReady] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [openForm, setOpenForm] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', phone: '' })
  const [focusId, setFocusId] = useState<string | null>(null)
  const firstSeen = useRef<Set<string> | null>(null)
  const [oa, setOa] = useState<{ lineId: string | null; addFriendUrl: string | null; qr: string | null } | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [p, l] = await Promise.all([
      supabase
        .from('line_contacts')
        .select('id, display_name, register_status, register_customer_id, typed_name, typed_phone, created_at, last_event_at')
        .eq('status', 'UNLINKED')
        .in('register_status', ['WAITING', 'PHONE_TAKEN', 'DUPLICATE'])
        .order('last_event_at', { ascending: false })
        .limit(200),
      supabase
        .from('line_contacts')
        .select('id, display_name, customer_id, linked_at, followed, self_registered')
        .eq('status', 'LINKED')
        .not('customer_id', 'is', null)
        .order('linked_at', { ascending: false })
        .limit(500),
    ])
    if (p.error || l.error) {
      setNotReady(true)
      setLoading(false)
      return
    }
    setNotReady(false)
    const pendingRows = (p.data as PendingContact[] | null) ?? []
    const linkedRows = (l.data as LinkedContact[] | null) ?? []
    if (firstSeen.current === null) firstSeen.current = new Set(pendingRows.map((x) => x.id))

    // names of the customers on screen (linked ones, and the owners of a phone already taken)
    const takenIds = [...new Set(pendingRows.map((x) => x.register_customer_id).filter((x): x is string => Boolean(x)))]
    const ids = [...new Set([...linkedRows.map((x) => x.customer_id), ...takenIds])]
    const cu = ids.length ? await supabase.from('customers').select('id, name, phone').in('id', ids) : { data: [] as CustomerLite[] }
    setCustomers(Object.fromEntries(((cu.data as CustomerLite[] | null) ?? []).map((c) => [c.id, c])))
    setTakenBy(Object.fromEntries(takenIds.map((id) => [id, linkedRows.find((x) => x.customer_id === id)?.display_name ?? null])))
    setPending(pendingRows)
    setLinked(linkedRows)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const t = setInterval(onVisible, REFRESH_MS)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  useEffect(() => {
    getLineOaInfo()
      .then(async (r) => {
        const url = r.success ? r.data?.addFriendUrl ?? null : null
        const qr = url ? await QRCode.toDataURL(url, { margin: 1, width: 200 }).catch(() => null) : null
        setOa({ lineId: r.data?.lineId ?? null, addFriendUrl: url, qr })
      })
      .catch(() => setOa({ lineId: null, addFriendUrl: null, qr: null }))
  }, [])

  const copy = async (text: string, title: string, body: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(title, body, 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  const submitForm = async (c: PendingContact) => {
    setBusy(c.id)
    try {
      const r = await registerLineContactByShop(c.id, form.name, form.phone)
      if (!r.success || !r.data) {
        showToast('ผูกไม่สำเร็จ', r.error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        return
      }
      const res = r.data
      if (res.result === 'LINKED_CUSTOMER') {
        showToast(
          res.created ? 'สร้างลูกค้าและผูก LINE แล้ว' : 'ผูก LINE แล้ว',
          res.created ? `${res.name || form.name} เป็นลูกค้าใหม่และผูก LINE แล้ว` : `ผูก LINE กับลูกค้าเดิม ${res.name || ''} แล้ว`,
          'SUCCESS'
        )
        setOpenForm(null)
      } else if (res.result === 'PHONE_TAKEN') {
        showToast('ผูกไม่ได้', 'เบอร์นี้เป็นของลูกค้าที่ผูก LINE อื่นไว้แล้ว 1 คนผูกได้ 1 LINE', 'ERROR')
      } else if (res.result === 'DUPLICATE') {
        showToast('ผูกไม่ได้', 'เบอร์นี้มีลูกค้าหลายรายการ ให้แก้ข้อมูลลูกค้าที่ซ้ำก่อน', 'ERROR')
      } else if (res.result === 'ALREADY_LINKED') {
        showToast('ผูกแล้ว', 'LINE นี้ผูกกับลูกค้าแล้ว', 'INFO')
      } else {
        showToast('ข้อมูลไม่ครบ', 'ใส่ชื่อ-นามสกุลและเบอร์โทร 10 หลัก', 'ERROR')
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  const reject = async (c: PendingContact) => {
    const ok = await confirm({
      title: `ไม่รับ: ${c.display_name || 'LINE ที่ไม่ทราบชื่อ'}`,
      message: 'ลบออกจากรายการ LINE นั้นยังเป็นเพื่อนกับร้านอยู่ แต่ไม่ผูกกับใคร',
      confirmLabel: 'ไม่รับ',
      danger: true,
    })
    if (!ok) return
    setBusy(c.id)
    try {
      const r = await rejectLineContact(c.id)
      if (!r.success) {
        showToast('ทำรายการไม่สำเร็จ', r.error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        return
      }
      showToast('ไม่รับแล้ว', 'ลบออกจากรายการแล้ว', 'SUCCESS')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const unlink = async (c: LinkedContact) => {
    const name = customers[c.customer_id]?.name || 'ลูกค้า'
    const ok = await confirm({
      title: `ยกเลิกการผูก LINE: ${name}`,
      message: 'ข้อความที่ยังไม่ส่งถึงลูกค้าคนนี้จะถูกยกเลิก',
      confirmLabel: 'ยกเลิกการผูก',
      danger: true,
    })
    if (!ok) return
    setBusy(c.id)
    try {
      const r = await unlinkLineContact(c.id)
      if (!r.success) {
        showToast('ยกเลิกไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
        return
      }
      showToast('ยกเลิกการผูกแล้ว', name, 'SUCCESS')
      await load()
    } finally {
      setBusy(null)
    }
  }

  // ── chat preview: what the focused pending friend has seen ─────────────────
  const shopName = settings.business.businessName.trim() || 'ร้านของคุณ'
  const templates = settings.line.templates
  const say = useCallback(
    (key: LineTemplateKey) => {
      const own = LINE_TEMPLATES[key]
      const draft = templates[key]
      const allowed = new Set<string>(own.vars)
      const usable = draft && draft.trim() && ![...draft.matchAll(PLACEHOLDER)].some((m) => !allowed.has(m[1]))
      return (usable ? draft : own.text).replace(PLACEHOLDER, (all, n: string) => (n === 'ชื่อร้าน' ? shopName : all))
    },
    [templates, shopName]
  )
  const focused = pending.find((p) => p.id === focusId) ?? pending[0]
  const preview = useMemo<{ caption: string; bubbles: LineChatBubble[] }>(() => {
    if (!focused) return { caption: 'ตัวอย่างใน LINE', bubbles: [{ from: 'shop', text: 'ยังไม่มีใครรอร้านตรวจ', empty: true }] }
    const bubbles: LineChatBubble[] = [{ from: 'shop', text: say('REGISTER_WELCOME') }]
    if (focused.typed_name && focused.typed_phone) {
      bubbles.push({ from: 'me', text: `${focused.typed_name} ${focused.typed_phone}` })
      if (focused.register_status === 'PHONE_TAKEN') bubbles.push({ from: 'shop', text: say('REGISTER_PHONE_TAKEN') })
      if (focused.register_status === 'DUPLICATE') bubbles.push({ from: 'shop', text: say('REGISTER_PENDING') })
    }
    return { caption: `"${focused.display_name || 'LINE ที่ไม่ทราบชื่อ'}" เห็นแบบนี้`, bubbles }
  }, [focused, say])

  const isNew = (id: string) => firstSeen.current !== null && !firstSeen.current.has(id)

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-900 text-xs p-2">
      <div className="flex-1 min-h-0 min-w-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-y-auto">
        <div className="px-3 sm:px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#06C755] text-white grid place-items-center text-[9px] font-bold">LINE</span>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">คนใน LINE</h2>
          {!notReady && (
            <span className={SETTINGS_HELPER}>
              ลูกค้าที่ผูกแล้ว {linked.length} คน · รอร้านตรวจ {pending.length} คน
            </span>
          )}
          <span className="ml-auto" />
          <ActionButton size="sm" variant="outline" icon={<RefreshCw className={loading ? 'animate-spin' : ''} />} onClick={() => void load()} aria-label="รีเฟรช" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {notReady && (
              <p className="m-3 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">
                ฐานข้อมูลนี้ยังไม่มีส่วนสมัครผ่าน LINE (รอติดตั้ง Migration) จึงยังแสดงรายชื่อไม่ได้
              </p>
            )}

            {/* (a) รอร้านตรวจ */}
            <div className={SETTINGS_SECTION}>
              <h4 className={SETTINGS_SECTION_TITLE}>
                <UserPlus className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span>รอร้านตรวจ</span>
                <span className={`${PILL} bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200 tabular-nums`}>{pending.length}</span>
              </h4>
              <p className={SETTINGS_HELPER}>
                คนที่เพิ่มเพื่อน LINE ร้านแล้วยังไม่ได้ผูก ระบบส่งแชตให้พิมพ์ชื่อและเบอร์โทรเอง ถ้าเบอร์ไม่มีในระบบ ระบบสร้างลูกค้าใหม่และผูกให้ ถ้าตรงกับลูกค้าเดิม
                ระบบผูกให้เลย ที่ขึ้นตรงนี้มีแค่คนที่ยังไม่ตอบ และคนที่พิมพ์เบอร์ของลูกค้าที่ผูก LINE อื่นไว้แล้ว · รายการอัปเดตเองเมื่อกลับมาที่หน้านี้
              </p>
              <ul className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700" data-testid="line-pending">
                {pending.length === 0 && <li className="p-3 text-slate-500 dark:text-slate-400">{loading ? 'กำลังโหลด…' : 'ไม่มีใครรอร้านตรวจ'}</li>}
                {pending.map((c) => {
                  const owner = c.register_customer_id ? customers[c.register_customer_id] : undefined
                  return (
                    <li key={c.id} className={isNew(c.id) ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : ''}>
                      <div className="flex flex-wrap items-center gap-2.5 px-3 py-2.5" onClick={() => setFocusId(c.id)}>
                        <span className="w-9 h-9 rounded-full grid place-items-center font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                          {initials(c.display_name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <b className="text-slate-900 dark:text-slate-100">{c.display_name || 'LINE ที่ไม่ทราบชื่อ'}</b>
                            {isNew(c.id) && <span className={`${PILL} bg-[#06C755] text-white`}>ใหม่</span>}
                            <span className={`${PILL} bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300`}>{STATUS_LABEL[c.register_status]}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            เพิ่มเพื่อน {thaiDate(c.created_at)}
                            {c.typed_name && c.typed_phone && (
                              <>
                                {' '}
                                · พิมพ์มาว่า <b className="text-slate-800 dark:text-slate-200">{c.typed_name}</b> <span className="tabular-nums">{phoneText(c.typed_phone)}</span>
                              </>
                            )}
                          </p>
                        </div>
                        <span className="flex flex-wrap gap-1.5">
                          <ActionButton
                            size="sm"
                            variant="outline"
                            disabled={busy === c.id}
                            onClick={() => {
                              setFocusId(c.id)
                              setForm({ name: c.typed_name || '', phone: c.typed_phone || '' })
                              setOpenForm(openForm === c.id ? null : c.id)
                            }}
                          >
                            {openForm === c.id ? 'ปิด' : 'ร้านกรอกให้'}
                          </ActionButton>
                          <ActionButton size="sm" variant="ghost" disabled={busy === c.id} onClick={() => void reject(c)}>
                            ไม่รับ
                          </ActionButton>
                        </span>
                      </div>
                      {c.register_status === 'PHONE_TAKEN' && (
                        <p className="mx-3 mb-2.5 sm:ml-[60px] rounded-lg px-2.5 py-1.5 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">
                          เบอร์นี้เป็นของลูกค้า <b>{owner?.name || '-'}</b> ซึ่งผูก LINE{takenBy[c.register_customer_id || ''] ? ` "${takenBy[c.register_customer_id || '']}"` : ''} อยู่แล้ว 1 คนผูกได้ 1 LINE
                          ถ้าลูกค้าเปลี่ยน LINE ให้ยกเลิกการผูกเดิมก่อน
                        </p>
                      )}
                      {c.register_status === 'DUPLICATE' && (
                        <p className="mx-3 mb-2.5 sm:ml-[60px] rounded-lg px-2.5 py-1.5 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">
                          เบอร์ที่พิมพ์มาตรงกับลูกค้าหลายรายการ ระบบจึงไม่เดาว่าเป็นใคร ให้แก้ข้อมูลลูกค้าที่ซ้ำก่อน แล้วกด &quot;ร้านกรอกให้&quot;
                        </p>
                      )}
                      {openForm === c.id && (
                        <form
                          className="mx-3 mb-3 sm:ml-[60px] grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end rounded-xl border border-slate-200 dark:border-slate-700 p-2.5"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void submitForm(c)
                          }}
                        >
                          <div>
                            <label className={SETTINGS_LABEL} htmlFor={`reg-name-${c.id}`}>
                              ชื่อ-นามสกุล
                            </label>
                            <input id={`reg-name-${c.id}`} className={SETTINGS_INPUT} maxLength={200} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                          </div>
                          <div>
                            <label className={SETTINGS_LABEL} htmlFor={`reg-phone-${c.id}`}>
                              เบอร์โทร
                            </label>
                            <input
                              id={`reg-phone-${c.id}`}
                              className={`${SETTINGS_INPUT} tabular-nums`}
                              inputMode="tel"
                              maxLength={20}
                              placeholder="08x-xxx-xxxx"
                              value={form.phone}
                              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                            />
                          </div>
                          <ActionButton
                            type="submit"
                            variant="primary"
                            icon={<CheckCircle2 />}
                            disabled={busy === c.id || !form.name.trim() || !/^0\d{9}$/.test(form.phone.replace(/\D/g, ''))}
                          >
                            ตรวจข้อมูล
                          </ActionButton>
                          <p className={`${SETTINGS_HELPER} sm:col-span-3`}>
                            เบอร์ใหม่ = สร้างลูกค้าใหม่และผูก LINE · เบอร์ของลูกค้าเดิมที่ยังไม่มี LINE = ผูกกับลูกค้าคนนั้น · ไม่ส่งข้อความไปหาลูกค้า
                          </p>
                        </form>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* (b) พนักงานส่งของ */}
            <DeliveryDriversPanel />

            {/* (c) ลูกค้าที่ผูก LINE แล้ว */}
            <div className={SETTINGS_SECTION}>
              <h4 className={SETTINGS_SECTION_TITLE}>
                <Users className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span>ลูกค้าที่ผูก LINE แล้ว</span>
                <span className={`${PILL} bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200 tabular-nums`}>{linked.length}</span>
              </h4>
              <ul className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700 max-h-[420px] overflow-y-auto" data-testid="line-linked-customers">
                {linked.length === 0 && <li className="p-3 text-slate-500 dark:text-slate-400">{loading ? 'กำลังโหลด…' : 'ยังไม่มีลูกค้าที่ผูก LINE'}</li>}
                {linked.map((c) => {
                  const cu = customers[c.customer_id]
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-2.5 px-3 py-2">
                      <span className="w-9 h-9 rounded-full grid place-items-center font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                        {initials(cu?.name ?? null)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/customers?customer=${encodeURIComponent(c.customer_id)}`} className="font-bold text-slate-900 dark:text-slate-100 hover:underline">
                            {cu?.name || '-'}
                          </Link>
                          {c.self_registered && <span className={`${PILL} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300`}>สมัครเองทาง LINE</span>}
                          {!c.followed && <span className={`${PILL} bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300`}>บล็อก/ลบ LINE ร้าน</span>}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {phoneText(cu?.phone ?? null) || '-'} · LINE &quot;{c.display_name || 'ไม่ทราบชื่อ'}&quot; · ผูกเมื่อ {thaiDate(c.linked_at)}
                        </p>
                      </div>
                      <ActionButton size="sm" variant="ghost" icon={<Link2Off />} className="text-red-700 dark:text-red-400" disabled={busy === c.id} onClick={() => void unlink(c)}>
                        ยกเลิกการผูก
                      </ActionButton>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* (d) QR เพิ่มเพื่อน LINE ร้าน */}
            <div className={SETTINGS_SECTION}>
              <h4 className={SETTINGS_SECTION_TITLE}>
                <QrCode className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span>QR เพิ่มเพื่อน LINE ร้าน</span>
              </h4>
              <p className={SETTINGS_HELPER}>สำหรับติดหน้าร้านหรือแชร์ทั่วไป เพิ่มเพื่อนอย่างเดียวยังไม่ผูกกับใคร</p>
              {!oa ? (
                <p className={SETTINGS_HELPER}>กำลังโหลด…</p>
              ) : oa.addFriendUrl ? (
                <div className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3 max-w-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL QR, nothing to optimise */}
                  {oa.qr && <img src={oa.qr} alt="QR เพิ่มเพื่อน LINE ร้าน" className="w-32 h-32 rounded-lg bg-white p-1" />}
                  <div className="space-y-2 min-w-0">
                    <div>
                      <p className={SETTINGS_HELPER}>LINE ID ของร้าน</p>
                      <p className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">{oa.lineId}</p>
                    </div>
                    <ActionButton size="sm" variant="outline" icon={<Copy />} onClick={() => void copy(oa.addFriendUrl as string, 'คัดลอกลิงก์แล้ว', 'ลิงก์นี้ใช้เพิ่มเพื่อนอย่างเดียว ยังไม่ผูกกับใคร')}>
                      คัดลอกลิงก์เพิ่มเพื่อน
                    </ActionButton>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  ยังไม่ได้ใส่ LINE ID ของร้าน ใส่ได้ที่{' '}
                  <Link href="/settings?tab=business" className="underline font-bold">
                    ตั้งค่า › กิจการ
                  </Link>
                </p>
              )}
            </div>
          </div>

          <aside className="border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 sm:p-4" aria-label="ตัวอย่างใน LINE">
            <div className="lg:sticky lg:top-3">
              <LineChatPreview
                shopName={shopName}
                caption={
                  <>
                    <MessageCircle className="inline w-3.5 h-3.5 mr-1 text-emerald-700 dark:text-emerald-400" />
                    <b className="text-slate-800 dark:text-slate-200">{preview.caption}</b>
                  </>
                }
                bubbles={preview.bubbles}
                note="ข้อความตามที่ตั้งไว้ใน ตั้งค่า › LINE › ข้อความที่ส่งทาง LINE"
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
