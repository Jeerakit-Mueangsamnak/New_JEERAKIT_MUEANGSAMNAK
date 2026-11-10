'use client'

/**
 * คนใน LINE (/line): who is on the shop's LINE OA, and (OWNER only) ตั้งค่า LINE, moved here from
 * ตั้งค่าระบบ (owner 2026-11-06). Summary cards on top, then one card: tabs รอร้านตรวจ | ลูกค้าที่ผูก LINE |
 * พนักงานส่งของ | ตั้งค่า LINE (OWNER); ตั้งค่า LINE shows its own tabs on a second row.
 * - รอร้านตรวจ: friends not linked yet — still not answered in the chat, or typed the phone of a
 *   customer who already has another LINE (or of several customers). The shop may type name +
 *   phone for them (same rule as the chat, decided by the database) or reject them.
 * - พนักงานส่งของ: drivers without a POS account and their one-time links.
 * - ลูกค้าที่ผูก LINE แล้ว, tagged when they registered themselves in the chat.
 * - QR / link to add the shop OA as a friend (adding a friend links nobody).
 * The list refreshes when the screen comes back into view and every 30 s while it is shown
 * (no realtime: line_contacts carries the LINE user id, which never reaches a browser).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { CheckCircle2, Copy, Link2Off, MessageCircle, QrCode, RefreshCw, Search, Settings2, UserPlus, Users, UserX } from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { DataTableFrame, DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES } from '@/components/common/DataTableFrame'
import {
  ActionButton,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
  TAB_CONTAINER_CLASSES,
  COMMAND_BUTTON_SIZE_CLASSES,
  SEARCH_INPUT_CLASSES,
  SEARCH_ICON_CLASSES,
  TABLE_TOOLBAR_CLASSES,
} from '@/components/common/ActionButton'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { createClient } from '@/lib/supabase/client'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { LINE_TEMPLATES, type LineTemplateKey } from '@/lib/line/templates'
import { getLineOaInfo, registerLineContactByShop, rejectLineContact, unlinkLineContact } from '@/app/actions/line'
import { DeliveryDriversPanel } from '@/features/settings/components/DeliveryDriversPanel'
import { LineChatPreview, type LineChatBubble } from '@/features/settings/components/LineChatPreview'
import { LINE_SETTINGS_VIEWS, type LineSettingsView } from '@/features/settings/components/LineSettingsPanel'
import { LineSettingsWorkspace } from '@/features/settings/components/LineSettingsWorkspace'
import { SETTINGS_HELPER, SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'

type RegisterStatus = 'WAITING' | 'PHONE_TAKEN' | 'DUPLICATE'
type PeopleView = 'PENDING' | 'LINKED' | 'DRIVERS' | 'SETTINGS'

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
const STATUS_TONE: Record<RegisterStatus, string> = {
  WAITING: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  PHONE_TAKEN: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  DUPLICATE: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
}
const PILL = 'inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold whitespace-nowrap'
/** Red text button in a table row (same look as the red actions on จัดการบิลเช่า). */
const DANGER_TEXT_BUTTON =
  `${COMMAND_BUTTON_SIZE_CLASSES} inline-flex items-center text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`
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
  const { user } = useAuth()
  // ตั้งค่า LINE is the OWNER's (staff see คนใน LINE only)
  const isOwner = user?.role === 'OWNER'
  const [tab, setTab] = useState<PeopleView>('PENDING')
  // staff never see ตั้งค่า LINE, even from a ?tab=settings link
  const view: PeopleView = tab === 'SETTINGS' && !isOwner ? 'PENDING' : tab
  const [initialSettingsView, setInitialSettingsView] = useState<LineSettingsView>('CONNECTION')
  const [search, setSearch] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
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

  // Links: /line?tab=settings[&view=TEMPLATES] (old ตั้งค่า › LINE links land here)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('tab') !== 'settings') return
    const v = q.get('view')
    if (v && LINE_SETTINGS_VIEWS.some((x) => x.id === v)) setInitialSettingsView(v as LineSettingsView)
    setTab('SETTINGS')
  }, [])

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
  const term = search.trim().toLowerCase()
  const matches = (...values: Array<string | null | undefined>) => !term || values.some((v) => (v || '').toLowerCase().includes(term))
  const shownPending = pending.filter((c) => matches(c.display_name, c.typed_name, c.typed_phone))
  const shownLinked = linked.filter((c) => {
    const cu = customers[c.customer_id]
    return matches(cu?.name, cu?.phone, c.display_name)
  })
  const blockedCount = linked.filter((c) => !c.followed).length

  const peopleTabs: Array<{ id: PeopleView; label: string; count?: number; alert?: boolean; icon?: ReactNode }> = [
    { id: 'PENDING', label: 'รอร้านตรวจ', count: pending.length, alert: pending.length > 0 },
    { id: 'LINKED', label: 'ลูกค้าที่ผูก LINE', count: linked.length },
    { id: 'DRIVERS', label: 'พนักงานส่งของ' },
    ...(isOwner ? [{ id: 'SETTINGS' as const, label: 'ตั้งค่า LINE', icon: <Settings2 className="w-3.5 h-3.5" /> }] : []),
  ]
  const listView = view === 'PENDING' || view === 'LINKED'
  const tabBar = (
    <div className="overflow-x-auto no-scrollbar shrink-0">
      <div className={TAB_CONTAINER_CLASSES} role="tablist" aria-label="คนใน LINE">
        {peopleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={view === t.id}
            onClick={() => setTab(t.id)}
            className={`${TAB_BUTTON_BASE_CLASSES} ${view === t.id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span
                className={`min-w-5 h-5 px-1.5 rounded-full grid place-items-center text-[10px] font-bold tabular-nums ${
                  t.alert ? 'bg-amber-500 text-slate-900' : 'bg-slate-300/70 text-slate-700 dark:bg-slate-600 dark:text-slate-200'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-2 gap-2 bg-slate-100 dark:bg-slate-900 text-xs">
      {/* Summary: same cards as จัดการบิลเช่า */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 sm:gap-2 shrink-0">
        <StatCard tone="amber" label="รอร้านตรวจ" value={`${pending.length} คน`} icon={<UserPlus className="w-3.5 h-3.5" />} />
        <StatCard tone="emerald" label="ลูกค้าที่ผูก LINE" value={`${linked.length} คน`} icon={<Users className="w-3.5 h-3.5" />} />
        <StatCard tone="red" label="บล็อก / ลบ LINE ร้าน" value={`${blockedCount} คน`} icon={<UserX className="w-3.5 h-3.5" />} />
        <div className="bg-blue-50/60 dark:bg-blue-950/40 p-2 sm:p-2.5 rounded-xl border border-blue-200 dark:border-blue-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[10px] sm:text-[11px] text-blue-700 dark:text-blue-300 font-semibold">LINE ID ของร้าน</span>
            <h3 className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400 mt-0.5 truncate">{oa?.lineId || 'ยังไม่ได้ตั้ง'}</h3>
          </div>
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} shrink-0 bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs flex items-center cursor-pointer`}
          >
            <QrCode className="w-3.5 h-3.5" />
            QR เพิ่มเพื่อน
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
        {/* Toolbar: which list, search, refresh (พนักงานส่งของ draws its own row: tabs + add-driver fields) */}
        {view !== 'DRIVERS' && (
          <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-col sm:flex-row items-stretch sm:items-center`}>
            {tabBar}
            {listView && (
              <div className="relative flex-1 min-w-0">
                <Search className={SEARCH_ICON_CLASSES} />
                <input
                  type="text"
                  aria-label="ค้นหาคนใน LINE"
                  placeholder={view === 'PENDING' ? 'ค้นหาชื่อ LINE หรือชื่อ/เบอร์ที่พิมพ์มา...' : 'ค้นหาชื่อลูกค้า เบอร์โทร หรือชื่อ LINE...'}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={SEARCH_INPUT_CLASSES}
                />
              </div>
            )}
            {listView && (
              <ActionButton variant="outline" className="shrink-0" icon={<RefreshCw className={loading ? 'animate-spin' : ''} />} onClick={() => void load()}>
                รีเฟรช
              </ActionButton>
            )}
          </div>
        )}

        {notReady && listView && (
          <p className="m-3 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">
            ฐานข้อมูลนี้ยังไม่มีส่วนสมัครผ่าน LINE (รอติดตั้ง Migration) จึงยังแสดงรายชื่อไม่ได้
          </p>
        )}

        {view === 'PENDING' && (
          <DataTableFrame
            fill
            rowCount={shownPending.length}
            className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent"
          >
            <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} data-testid="line-pending">
              <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
                <tr>
                  <th className={`px-3 ${DATA_TABLE_TH_CLASSES}`}>ชื่อใน LINE</th>
                  <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>เพิ่มเพื่อนเมื่อ</th>
                  <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>ชื่อ / เบอร์ที่พิมพ์มา</th>
                  <th className={`px-2 text-center ${DATA_TABLE_TH_CLASSES}`}>สถานะ</th>
                  <th className={`px-3 text-right ${DATA_TABLE_TH_CLASSES}`}>จัดการ</th>
                </tr>
              </thead>
              {shownPending.map((c) => {
                const owner = c.register_customer_id ? customers[c.register_customer_id] : undefined
                const formOpen = openForm === c.id
                const note =
                  c.register_status === 'PHONE_TAKEN'
                    ? `เบอร์นี้เป็นของลูกค้า "${owner?.name || '-'}" ซึ่งผูก LINE${takenBy[c.register_customer_id || ''] ? ` "${takenBy[c.register_customer_id || '']}"` : ''} อยู่แล้ว (1 คนผูกได้ 1 LINE) ถ้าลูกค้าเปลี่ยน LINE ให้ยกเลิกการผูกเดิมก่อน`
                    : c.register_status === 'DUPLICATE'
                      ? 'เบอร์ที่พิมพ์มาตรงกับลูกค้าหลายรายการ ให้แก้ข้อมูลลูกค้าที่ซ้ำก่อน แล้วกด "ร้านกรอกให้"'
                      : null
                return (
                  <tbody key={c.id} className="border-b border-slate-100 dark:border-slate-700">
                    <tr
                      onClick={() => setFocusId(c.id)}
                      className={`transition-colors ${formOpen ? 'bg-emerald-50/50 dark:bg-emerald-900/20' : isNew(c.id) ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'hover:bg-slate-50/80 dark:hover:bg-slate-700/30'}`}
                    >
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <Avatar text={c.display_name} />
                          <b className="truncate text-slate-900 dark:text-slate-100">{c.display_name || 'LINE ที่ไม่ทราบชื่อ'}</b>
                          {isNew(c.id) && <span className={`${PILL} bg-emerald-700 text-white`}>ใหม่</span>}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400 tabular-nums">{thaiDate(c.created_at)}</td>
                      <td className="px-2 py-2">
                        {c.typed_name || c.typed_phone ? (
                          <>
                            <span className="block font-bold text-slate-900 dark:text-slate-100">{c.typed_name || '-'}</span>
                            <span className="block text-[10px] text-slate-600 dark:text-slate-400 tabular-nums">{phoneText(c.typed_phone) || '-'}</span>
                          </>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        <span className={`${PILL} ${STATUS_TONE[c.register_status]}`}>{STATUS_LABEL[c.register_status]}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex justify-end gap-1.5">
                          <ActionButton
                            variant={formOpen ? 'outline' : 'primary'}
                            disabled={busy === c.id}
                            onClick={() => {
                              setFocusId(c.id)
                              setForm({ name: c.typed_name || '', phone: c.typed_phone || '' })
                              setOpenForm(formOpen ? null : c.id)
                            }}
                          >
                            {formOpen ? 'ปิด' : 'ร้านกรอกให้'}
                          </ActionButton>
                          <button type="button" className={DANGER_TEXT_BUTTON} disabled={busy === c.id} onClick={() => void reject(c)}>
                            ไม่รับ
                          </button>
                        </span>
                      </td>
                    </tr>
                    {(note || formOpen) && (
                      <tr className={formOpen ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : ''}>
                        <td colSpan={5} className="px-3 pb-3 pt-0">
                          {note && (
                            <p className="mb-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">{note}</p>
                          )}
                          {formOpen && (
                            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-3">
                              <form
                                className="self-start grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3"
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
                              </form>
                              {focused?.id === c.id && (
                                <LineChatPreview
                                  shopName={shopName}
                                  caption={
                                    <>
                                      <MessageCircle className="inline w-3.5 h-3.5 mr-1 text-emerald-700 dark:text-emerald-400" />
                                      <b className="text-slate-800 dark:text-slate-200">{preview.caption}</b>
                                    </>
                                  }
                                  bubbles={preview.bubbles}
                                />
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                )
              })}
            </table>
          </DataTableFrame>
        )}

        {view === 'LINKED' && (
          <DataTableFrame
            fill
            rowCount={shownLinked.length}
            className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent"
          >
            <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} data-testid="line-linked-customers">
              <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
                <tr>
                  <th className={`px-3 ${DATA_TABLE_TH_CLASSES}`}>ลูกค้า / เบอร์</th>
                  <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>ชื่อใน LINE</th>
                  <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>ผูกเมื่อ</th>
                  <th className={`px-2 text-center ${DATA_TABLE_TH_CLASSES}`}>สถานะ</th>
                  <th className={`px-3 text-right ${DATA_TABLE_TH_CLASSES}`}>จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {shownLinked.map((c) => {
                  const cu = customers[c.customer_id]
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <Avatar text={cu?.name ?? null} tone="emerald" />
                          <span className="min-w-0">
                            <Link href={`/customers?customer=${encodeURIComponent(c.customer_id)}`} className="block truncate font-bold text-slate-900 dark:text-slate-100 hover:underline">
                              {cu?.name || '-'}
                            </Link>
                            <span className="block text-[10px] text-slate-600 dark:text-slate-400 tabular-nums">{phoneText(cu?.phone ?? null) || '-'}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{c.display_name || 'ไม่ทราบชื่อ'}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400 tabular-nums">{thaiDate(c.linked_at)}</td>
                      <td className="px-2 py-2 text-center">
                        <span className="inline-flex flex-wrap justify-center gap-1">
                          {c.followed ? (
                            <span className={`${PILL} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300`}>ส่งข้อความได้</span>
                          ) : (
                            <span className={`${PILL} bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300`}>บล็อก/ลบ LINE ร้าน</span>
                          )}
                          {c.self_registered && <span className={`${PILL} bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300`}>สมัครเองทาง LINE</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" className={DANGER_TEXT_BUTTON} disabled={busy === c.id} onClick={() => void unlink(c)}>
                          <Link2Off className="w-3.5 h-3.5" />
                          ยกเลิกการผูก
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DataTableFrame>
        )}

        {view === 'DRIVERS' && <DeliveryDriversPanel tabs={tabBar} />}

        {/* ตั้งค่า LINE: its own tabs come as the second row under these tabs */}
        {view === 'SETTINGS' && <LineSettingsWorkspace initialView={initialSettingsView} />}
      </div>

      {/* QR to add the shop LINE as a friend (adding a friend links nobody) */}
      <AppModal isOpen={qrOpen} onClose={() => setQrOpen(false)} size="sm">
        <AppModalHeader onClose={() => setQrOpen(false)} icon={<QrCode className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />}>
          <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">QR เพิ่มเพื่อน LINE ร้าน</h3>
        </AppModalHeader>
        <AppModalBody className="flex flex-col items-center gap-3 text-center">
          {!oa ? (
            <p className={SETTINGS_HELPER}>กำลังโหลด…</p>
          ) : oa.addFriendUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL QR, nothing to optimise */}
              {oa.qr && <img src={oa.qr} alt="QR เพิ่มเพื่อน LINE ร้าน" className="w-52 h-52 rounded-xl bg-white p-2 border border-slate-200" />}
              <p className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">{oa.lineId}</p>
            </>
          ) : (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              ยังไม่ได้ใส่ LINE ID ของร้าน ใส่ได้ที่{' '}
              <Link href="/settings?tab=business" className="underline font-bold">
                ตั้งค่า › ข้อมูลกิจการ
              </Link>
            </p>
          )}
        </AppModalBody>
        {oa?.addFriendUrl && (
          <AppModalFooter>
            <ActionButton variant="outline" icon={<Copy />} onClick={() => void copy(oa.addFriendUrl as string, 'คัดลอกลิงก์แล้ว', 'ลิงก์นี้ใช้เพิ่มเพื่อนอย่างเดียว ยังไม่ผูกกับใคร')}>
              คัดลอกลิงก์เพิ่มเพื่อน
            </ActionButton>
          </AppModalFooter>
        )}
      </AppModal>
    </div>
  )
}

const STAT_TONE = {
  amber: { box: 'bg-amber-50/60 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800', label: 'text-amber-800 dark:text-amber-300', value: 'text-amber-700 dark:text-amber-400', icon: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300' },
  emerald: { box: 'bg-emerald-50/60 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800', label: 'text-emerald-700 dark:text-emerald-300', value: 'text-emerald-700 dark:text-emerald-400', icon: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300' },
  red: { box: 'bg-red-50/60 dark:bg-red-950/40 border-red-200 dark:border-red-800', label: 'text-red-700 dark:text-red-300', value: 'text-red-700 dark:text-red-400', icon: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300' },
} as const

/** Summary card, the same look as the cards on จัดการบิลเช่า. */
function StatCard({ tone, label, value, icon }: { tone: keyof typeof STAT_TONE; label: string; value: string; icon: ReactNode }) {
  const t = STAT_TONE[tone]
  return (
    <div className={`p-2 sm:p-2.5 rounded-xl border flex items-center justify-between ${t.box}`}>
      <div>
        <span className={`text-[10px] sm:text-[11px] font-semibold ${t.label}`}>{label}</span>
        <h3 className={`text-base sm:text-lg font-black mt-0.5 ${t.value}`}>{value}</h3>
      </div>
      <div className={`p-1.5 rounded-lg ${t.icon}`}>{icon}</div>
    </div>
  )
}

function Avatar({ text, tone = 'slate' }: { text: string | null; tone?: 'slate' | 'emerald' }) {
  const color =
    tone === 'emerald'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
      : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
  return <span className={`w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold shrink-0 ${color}`}>{initials(text)}</span>
}
