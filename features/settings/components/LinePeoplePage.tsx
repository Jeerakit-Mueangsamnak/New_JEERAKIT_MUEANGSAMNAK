'use client'

/**
 * เมนู LINE (/line), owner 2026-11-26: four tabs in one row across the top, no bar on the left.
 *   สมาชิก          · one table, ลูกค้า or พนักงาน picked from the tab's dropdown (owner 2026-11-28); on the right the
 *                     buttons that send for that group (each opens its list in a window)
 *   ยืนยัน & จัดการ · the requests to check and making a link for a customer or a staff member
 *   แก้ไขข้อความ (OWNER) · first choose whose messages (ลูกค้า / พนักงาน / เจ้าของ), then edit them with the variables
 *   ตั้งค่า LINE (OWNER) · everything else, as a second row of tabs
 * Summary cards on top. Lists have no ย้อนกลับ / ถัดไป: they scroll, read more from the database near the bottom, and refresh by themselves.
 */
import { CountUp } from '@/components/common/CountUp'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { qrDataUrl } from '@/lib/qr-code'
import {
  BellRing,
  ClipboardList,
  Copy,
  MessageSquare,
  QrCode,
  ReceiptText,
  Settings2,
  Truck,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import {
  ActionButton,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
  TAB_CONTAINER_CLASSES,
} from '@/components/common/ActionButton'
import { CustomSelect } from '@/components/common/CustomSelect'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useToast } from '@/components/common/Toast'
import { getLineOaInfo, getLinePeopleCounts, type LinePeopleCounts, type LinePeopleView, type LinePerson } from '@/app/actions/line'
import type { LineTemplateCategory } from '@/lib/line/config'
import { DeliveryDriversPanel } from '@/features/settings/components/DeliveryDriversPanel'
import { LineConnectionPanel, type LineSettingsView } from '@/features/settings/components/LineSettingsPanel'
import { LineSettingsWorkspace } from '@/features/settings/components/LineSettingsWorkspace'
import { LineBillCardDesigner } from '@/features/settings/components/LineBillCardDesigner'
import { LineMessageComposer } from '@/features/settings/components/LineMessageComposer'
import { LineMembersPanel } from '@/features/settings/components/LineMembersPanel'
import { LineDeliveryLogPanel } from '@/features/settings/components/LineDeliveryLogPanel'
import { LinePeopleList } from '@/features/settings/components/line/LinePeopleList'
import { LineInviteArea } from '@/features/settings/components/line/LineInviteArea'
import { PEOPLE_VIEW_LABEL } from '@/features/settings/components/line/line-people-model'
import { NewCustomerModal } from '@/features/customers/components/NewCustomerModal'
import { useCreateCustomer } from '@/features/customers/hooks/useCreateCustomer'
import type { Customer } from '@/lib/types/rental-pos'
import { LineCodesPanel } from '@/features/settings/components/line/LineCodesPanel'
import { LineSlipsPanel } from '@/features/settings/components/line/LineSlipsPanel'
import { LineMemberRemind, type MemberRemindRequest } from '@/features/settings/components/line/LineMemberRemind'
import { LINE_REMINDER_RULES } from '@/lib/line/config'
import { LineTasksPanel } from '@/features/settings/components/line/LineTasksPanel'
import { LineAuditPanel } from '@/features/settings/components/line/LineAuditPanel'
import { LineRichMenuSettings } from '@/features/settings/components/line/LineRichMenuSettings'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { SETTINGS_HELPER } from '@/features/settings/components/settings-ui'
import { SettingsSwitch } from '@/features/settings/components/SettingsRows'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'

type MainTab = 'PEOPLE' | 'MANAGE' | 'MESSAGES' | 'SETTINGS'

/** แจ้งเตือนอัตโนมัติ on / off per audience (owner 2026-11-28), policies.line.<key>.enabled, missing = on.
 *  Off stops the automatic due-date round only; the per-rule switches and sending by hand stay. */
type AutoAlertKey = 'customerAlerts' | 'staffAlerts' | 'ownerAlerts'
const AUTO_ALERTS: ReadonlyArray<{ key: AutoAlertKey; label: string; group: 'CUSTOMERS' | 'TEAM' }> = [
  { key: 'customerAlerts', label: 'ลูกค้า', group: 'CUSTOMERS' },
  { key: 'staffAlerts', label: 'พนักงาน', group: 'TEAM' },
  { key: 'ownerAlerts', label: 'เจ้าของระบบ', group: 'TEAM' },
]
type IconType = typeof Users
const icon = (Node: IconType) => <Node className="w-3.5 h-3.5" />

const MAIN_TABS: ReadonlyArray<{ id: MainTab; label: string; icon: ReactNode; ownerOnly?: boolean }> = [
  { id: 'PEOPLE', label: 'สมาชิก', icon: icon(Users) },
  { id: 'MANAGE', label: 'ยืนยัน & จัดการ', icon: icon(UserCheck) },
  { id: 'MESSAGES', label: 'แก้ไขข้อความ', icon: icon(MessageSquare), ownerOnly: true },
  { id: 'SETTINGS', label: 'ตั้งค่า LINE', icon: icon(Settings2), ownerOnly: true },
]

/** ยืนยัน & จัดการ: the request lists, one filter over the same 10-row table. */
type ConfirmView = Exclude<LinePeopleView, 'CUSTOMERS' | 'STAFF' | 'DRIVERS'>
const CONFIRM_VIEWS: readonly ConfirmView[] = ['PENDING', 'NEEDINFO', 'UNREG', 'GENERAL', 'REJECTED', 'UNLINKED', 'BLOCKED', 'ALL']

/** สมาชิก (owner 2026-11-28): one table, ลูกค้า or พนักงาน picked from the tab's own dropdown. */
type MemberGroup = 'CUSTOMERS' | 'TEAM'
const MEMBER_GROUPS: ReadonlyArray<{ value: MemberGroup; label: string }> = [
  { value: 'CUSTOMERS', label: 'สมาชิก · ลูกค้า' },
  { value: 'TEAM', label: 'สมาชิก · พนักงาน' },
]

/** The buttons on the right of สมาชิก: shown for the group picked; each opens its list in a window. Customer reminders
 *  are the topic buttons under แจ้งเตือนลูกค้า (LINE_REMINDER_RULES), sent to the customer picked in the table. */
type SendAction = 'SLIPS' | 'TASKS' | 'DRIVERS'
const SEND_GROUPS: ReadonlyArray<{ group: MemberGroup; actions: ReadonlyArray<{ id: SendAction; label: string; icon: ReactNode; variant: 'share' | 'info'; ownerOnly?: boolean }> }> = [
  {
    group: 'CUSTOMERS',
    actions: [
      { id: 'SLIPS', label: 'สลิปรอตรวจ', icon: icon(ReceiptText), variant: 'info' },
    ],
  },
  {
    group: 'TEAM',
    actions: [
      { id: 'TASKS', label: 'สั่งงานด่วน', icon: icon(ClipboardList), variant: 'share' },
      { id: 'DRIVERS', label: 'คนขับรถ', icon: icon(Truck), variant: 'info' },
    ],
  },
]
const SEND_ACTIONS = SEND_GROUPS.flatMap((g) => g.actions)

/** แก้ไขข้อความ: whose messages first; the shop's own templates and the bill card after them. */
type MessagePick = LineTemplateCategory | 'OWN' | 'CARD'
const MESSAGE_PICKS: ReadonlyArray<{ id: MessagePick; label: string; Icon: IconType }> = [
  { id: 'CUSTOMER', label: 'ลูกค้า', Icon: Users },
  { id: 'STAFF', label: 'พนักงาน', Icon: UserCog },
  { id: 'OWNER', label: 'เจ้าของ', Icon: UserCheck },
  { id: 'OWN', label: 'แม่แบบของร้าน', Icon: MessageSquare },
  { id: 'CARD', label: 'การ์ดบิล', Icon: ReceiptText },
]
const isCategory = (p: MessagePick | null): p is LineTemplateCategory => p === 'CUSTOMER' || p === 'STAFF' || p === 'OWNER'

/** ตั้งค่า LINE: the second row of tabs; การแจ้งเตือน and ประวัติ have a small choice of their own after it. */
type SettingsPage = 'CONNECTION' | 'FRIEND' | 'REGISTER' | 'CATALOG' | 'MENU' | 'NOTICES' | 'SLIPCHECK' | 'STAFF' | 'HISTORY'
type NoticePage = 'SCHEDULE' | 'NOTIFY' | 'OWNER_ALERTS'
type HistoryPage = 'HISTORY' | 'AUDIT' | 'CODES'
const SETTINGS_PAGES: ReadonlyArray<{ id: SettingsPage; label: string }> = [
  { id: 'CONNECTION', label: 'การเชื่อมต่อ' },
  { id: 'FRIEND', label: 'การเพิ่มเพื่อน' },
  { id: 'REGISTER', label: 'การลงทะเบียน' },
  { id: 'CATALOG', label: 'รายการสินค้า' },
  { id: 'MENU', label: 'เมนู LINE' },
  { id: 'NOTICES', label: 'การแจ้งเตือน' },
  { id: 'SLIPCHECK', label: 'ตรวจสลิป' },
  { id: 'STAFF', label: 'พนักงานที่ผูก LINE' },
  { id: 'HISTORY', label: 'ประวัติ' },
]
const NOTICE_PAGES: ReadonlyArray<{ id: NoticePage; label: string }> = [
  { id: 'SCHEDULE', label: 'ลูกค้า' },
  { id: 'NOTIFY', label: 'พนักงาน' },
  { id: 'OWNER_ALERTS', label: 'เจ้าของ' },
]
const HISTORY_PAGES: ReadonlyArray<{ id: HistoryPage; label: string }> = [
  { id: 'HISTORY', label: 'การส่ง' },
  { id: 'AUDIT', label: 'การตรวจสอบ' },
  { id: 'CODES', label: 'รหัสเชิญ' },
]
/** The settings pages kept in the LINE settings draft (LineSettingsWorkspace). */
const DRAFT_SETTINGS: ReadonlySet<SettingsPage> = new Set<SettingsPage>(['FRIEND', 'REGISTER', 'CATALOG', 'SLIPCHECK'])

/** Old links /line?tab=settings&view=… (chat menu buttons, the bell, older pages) to where that page is now. */
type Place =
  | { tab: 'PEOPLE'; send?: SendAction }
  | { tab: 'MANAGE'; confirm?: ConfirmView }
  | { tab: 'MESSAGES'; pick: MessagePick }
  | { tab: 'SETTINGS'; page: SettingsPage; notice?: NoticePage; history?: HistoryPage }
function placeOf(view: string): Place {
  if ((CONFIRM_VIEWS as readonly string[]).includes(view)) return { tab: 'MANAGE', confirm: view as ConfirmView }
  if (view === 'CUSTOMERS' || view === 'LINKED' || view === 'OVERVIEW') return { tab: 'PEOPLE' }
  if (view === 'SLIPS' || view === 'TASKS' || view === 'DRIVERS') return { tab: 'PEOPLE', send: view }
  if (view === 'MANUAL') return { tab: 'PEOPLE' }
  if (view === 'MSG_STAFF') return { tab: 'MESSAGES', pick: 'STAFF' }
  if (view === 'MSG_OWNER') return { tab: 'MESSAGES', pick: 'OWNER' }
  if (view === 'OWN' || view === 'CARD') return { tab: 'MESSAGES', pick: view }
  if (view.startsWith('MSG_') || view === 'TEMPLATES') return { tab: 'MESSAGES', pick: 'CUSTOMER' }
  if (view === 'SCHEDULE' || view === 'NOTIFY' || view === 'OWNER_ALERTS') return { tab: 'SETTINGS', page: 'NOTICES', notice: view }
  if (view === 'HISTORY' || view === 'AUDIT' || view === 'CODES') return { tab: 'SETTINGS', page: 'HISTORY', history: view }
  if (SETTINGS_PAGES.some((p) => p.id === view)) return { tab: 'SETTINGS', page: view as SettingsPage }
  return { tab: 'SETTINGS', page: 'CONNECTION' }
}

export function LinePeoplePage() {
  const { showToast } = useToast()
  const { user } = useAuth()
  // แก้ไขข้อความ and ตั้งค่า LINE are the OWNER's; staff see ลูกค้าในระบบ and ยืนยัน & จัดการ
  const isOwner = user?.role === 'OWNER'
  const [mainTab, setMainTab] = useState<MainTab>('PEOPLE')
  const tab: MainTab = MAIN_TABS.find((t) => t.id === mainTab)?.ownerOnly && !isOwner ? 'PEOPLE' : mainTab
  const [confirmView, setConfirmView] = useState<ConfirmView>('PENDING')
  const [memberGroup, setMemberGroup] = useState<MemberGroup>('CUSTOMERS')
  const [picked, setPicked] = useState<LinePerson | null>(null)
  const [remind, setRemind] = useState<MemberRemindRequest | null>(null)
  useEffect(() => setPicked(null), [memberGroup])
  const { settings, saveSection } = useSystemSettings()
  const [alertSaving, setAlertSaving] = useState(false)
  const alertOn = (key: AutoAlertKey) => (settings.line.other[key] as { enabled?: boolean } | undefined)?.enabled !== false
  // saved at once, no บันทึก button
  const setAlert = async (a: (typeof AUTO_ALERTS)[number], on: boolean) => {
    setAlertSaving(true)
    try {
      await saveSection('line', { ...settings, line: { ...settings.line, other: { ...settings.line.other, [a.key]: { enabled: on } } } })
      showToast(on ? 'เปิดแจ้งเตือนอัตโนมัติแล้ว' : 'ปิดแจ้งเตือนอัตโนมัติแล้ว', a.label, 'SUCCESS')
    } catch (err: unknown) {
      showToast('บันทึกไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setAlertSaving(false)
    }
  }
  const [sendOpen, setSendOpen] = useState<SendAction | null>(null)
  const [pick, setPick] = useState<MessagePick | null>(null)
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('CONNECTION')
  const [noticePage, setNoticePage] = useState<NoticePage>('SCHEDULE')
  const [historyPage, setHistoryPage] = useState<HistoryPage>('HISTORY')
  const [qrOpen, setQrOpen] = useState(false)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)
  const createCustomer = useCreateCustomer()
  const [counts, setCounts] = useState<LinePeopleCounts | null>(null)
  const [oa, setOa] = useState<{ lineId: string | null; addFriendUrl: string | null; qr: string | null } | null>(null)

  // The settings draft page on screen (null = none). The draft stays mounted while hidden, on the page last shown,
  // so an unsaved change survives a tab switch.
  const activeDraft: LineSettingsView | null =
    tab === 'MESSAGES'
      ? isCategory(pick)
        ? 'TEMPLATES'
        : null
      : tab === 'SETTINGS'
        ? settingsPage === 'NOTICES'
          ? noticePage
          : DRAFT_SETTINGS.has(settingsPage)
            ? (settingsPage as LineSettingsView)
            : null
        : null
  const [lastDraft, setLastDraft] = useState<LineSettingsView>('TEMPLATES')
  const [lastCategory, setLastCategory] = useState<LineTemplateCategory>('CUSTOMER')
  useEffect(() => {
    if (activeDraft) setLastDraft(activeDraft)
  }, [activeDraft])
  useEffect(() => {
    if (isCategory(pick)) setLastCategory(pick)
  }, [pick])

  const loadCounts = useCallback(async () => {
    const r = await getLinePeopleCounts()
    if (r.success && r.data) setCounts(r.data)
  }, [])
  // no รีเฟรช button: the numbers update by themselves (owner 2026-11-17); one small answer, not the lists
  useAutoRefresh(loadCounts, 60_000)

  useEffect(() => {
    getLineOaInfo()
      .then(async (r) => {
        const url = r.success ? (r.data?.addFriendUrl ?? null) : null
        const qr = url ? await qrDataUrl(url, { margin: 1, width: 200 }).catch(() => null) : null
        setOa({ lineId: r.data?.lineId ?? null, addFriendUrl: url, qr })
      })
      .catch(() => setOa({ lineId: null, addFriendUrl: null, qr: null }))
  }, [])

  // Links /line?tab=settings[&view=…] (chat menu buttons, older pages) open the page where that view is now
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('tab') !== 'settings') return
    const place = placeOf(q.get('view') ?? '')
    setMainTab(place.tab)
    if (place.tab === 'PEOPLE' && place.send) {
      const send = place.send
      setMemberGroup(SEND_GROUPS.find((g) => g.actions.some((a) => a.id === send))?.group ?? 'CUSTOMERS')
      setSendOpen(send)
    } else if (place.tab === 'MANAGE') {
      if (place.confirm) setConfirmView(place.confirm)
    } else if (place.tab === 'MESSAGES') {
      setPick(place.pick)
    } else if (place.tab === 'SETTINGS') {
      setSettingsPage(place.page)
      if (place.notice) setNoticePage(place.notice)
      if (place.history) setHistoryPage(place.history)
    }
  }, [])

  const copy = async (text: string, title: string, body: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(title, body, 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  const pending = counts?.pending ?? 0
  const needInfo = counts?.needinfo ?? 0
  const countBadge = (n: number) => (
    <span className="min-w-5 h-5 px-1.5 rounded-full grid place-items-center text-[10px] font-bold tabular-nums bg-amber-500 text-slate-900">{n}</span>
  )
  const tabClass = (on: boolean) => `${TAB_BUTTON_BASE_CLASSES} ${on ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`
  function tabRow<T extends string>(label: string, items: ReadonlyArray<{ id: T; label: string; icon?: ReactNode }>, value: T | null, onPick: (id: T) => void) {
    return (
      <div role="tablist" aria-label={label} className={TAB_CONTAINER_CLASSES}>
        {items.map((it) => (
          <button key={it.id} type="button" role="tab" aria-selected={value === it.id} onClick={() => onPick(it.id)} className={tabClass(value === it.id)}>
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    )
  }
  const send = SEND_ACTIONS.find((a) => a.id === sendOpen && (isOwner || !a.ownerOnly)) ?? null
  const subRow =
    tab === 'SETTINGS' ? (
      <>
        {tabRow('ตั้งค่า LINE', SETTINGS_PAGES, settingsPage, setSettingsPage)}
        {settingsPage === 'NOTICES' && tabRow('การแจ้งเตือน', NOTICE_PAGES, noticePage, setNoticePage)}
        {settingsPage === 'HISTORY' && tabRow('ประวัติ', HISTORY_PAGES, historyPage, setHistoryPage)}
      </>
    ) : tab === 'MESSAGES' && pick ? (
      tabRow('แก้ไขข้อความของ', MESSAGE_PICKS.map((p) => ({ id: p.id, label: p.label, icon: icon(p.Icon) })), pick, setPick)
    ) : null

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden gap-2 p-2 bg-slate-100 dark:bg-black text-xs">
      <div className="settings-ref flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
        {/* Summary cards inside the white box (owner 2026-11-17) */}
        <div className="card-lift-row grid grid-cols-4 gap-1.5 sm:gap-2 shrink-0 p-2">
          <StatCard tone="amber" label="รอร้านตรวจสอบ" value={<><CountUp value={pending} /> คน</>} icon={<UserPlus className="w-3.5 h-3.5" />} />
          <StatCard tone="emerald" label="ลูกค้าที่ผูก LINE" value={<><CountUp value={counts?.customers ?? 0} /> คน</>} icon={<Users className="w-3.5 h-3.5" />} />
          <StatCard tone="red" label="บล็อก / ลบ LINE ร้าน" value={<><CountUp value={counts?.blocked ?? 0} /> คน</>} icon={<UserX className="w-3.5 h-3.5" />} />
          <div className="min-w-0 bg-blue-50/60 dark:bg-blue-950/40 p-2 sm:p-2.5 rounded-xl border border-blue-200 dark:border-blue-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[10px] sm:text-[11px] text-blue-700 dark:text-blue-300 font-semibold">LINE ID ของร้าน</span>
              <h3 className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400 mt-0.5 truncate">{oa?.lineId || 'ยังไม่ได้ตั้ง'}</h3>
            </div>
            <ActionButton variant="info" icon={<QrCode />} className="shrink-0" onClick={() => setQrOpen(true)}>
              QR เพิ่มเพื่อน
            </ActionButton>
          </div>
        </div>

        {/* The four tabs in one row (owner 2026-11-26); ตั้งค่า LINE and แก้ไขข้อความ add their own row under it */}
        <div className="shrink-0 px-2 pb-2 flex flex-col gap-1.5 min-w-0 border-b border-slate-200 dark:border-slate-700">
          <div role="tablist" aria-label="เมนู LINE" className={`${TAB_CONTAINER_CLASSES} max-w-full`}>
            {MAIN_TABS.filter((t) => isOwner || !t.ownerOnly).map((t) =>
              t.id === 'PEOPLE' && tab === 'PEOPLE' ? (
                <div key={t.id} role="tab" aria-selected data-line-tab={t.id} className="w-40 shrink-0">
                  <CustomSelect
                    value={memberGroup}
                    ariaLabel="สมาชิก"
                    buttonClassName={TAB_BUTTON_BASE_CLASSES}
                    onChange={(v) => setMemberGroup(v as MemberGroup)}
                    options={MEMBER_GROUPS.map((g) => ({ value: g.value, label: g.label }))}
                  />
                </div>
              ) : (
              <button key={t.id} type="button" role="tab" data-line-tab={t.id} aria-selected={tab === t.id} onClick={() => setMainTab(t.id)} className={tabClass(tab === t.id)}>
                {t.icon}
                {t.label}
                {t.id === 'MANAGE' && pending + needInfo > 0 && countBadge(pending + needInfo)}
              </button>
              ),
            )}
          </div>
          {subRow && <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">{subRow}</div>}
        </div>

        <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
          {/* สมาชิก: one table of the group picked in the tab, its send buttons on the right */}
          {tab === 'PEOPLE' && (
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
              <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-y-auto">
                <LinePeopleList
                  key={memberGroup}
                  view={memberGroup === 'CUSTOMERS' ? 'MEMBERS' : 'TEAM'}
                  tabs={null}
                  searchable={false}
                  pickedId={memberGroup === 'CUSTOMERS' ? (picked?.id ?? null) : undefined}
                  onPick={memberGroup === 'CUSTOMERS' ? setPicked : undefined}
                  isOwner={isOwner}
                  onChanged={() => void loadCounts()}
                />
              </div>
              <aside
                aria-label="ส่งกำหนดและแจ้งเตือน"
                className="shrink-0 lg:w-48 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-2 flex flex-row flex-wrap lg:flex-col lg:flex-nowrap gap-1.5 lg:overflow-y-auto"
              >
                {isOwner && (
                  <div className="flex flex-col gap-1 lg:w-full">
                    <span className="px-1 text-[11px] font-bold text-slate-700 dark:text-slate-300">แจ้งเตือนอัตโนมัติ</span>
                    {AUTO_ALERTS.filter((a) => a.group === memberGroup).map((a) => (
                      <div key={a.key} className="flex items-center justify-between gap-2 px-1 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        <span>{a.label}</span>
                        <SettingsSwitch label={`แจ้งเตือนอัตโนมัติ ${a.label}`} checked={alertOn(a.key)} disabled={alertSaving} onChange={(on) => void setAlert(a, on)} />
                      </div>
                    ))}
                  </div>
                )}
                {memberGroup === 'CUSTOMERS' && isOwner && (
                  <div className="flex flex-row flex-wrap lg:flex-col gap-1.5 lg:w-full">
                    <span className="px-1 text-[11px] font-bold text-slate-700 dark:text-slate-300 lg:w-full">แจ้งเตือนลูกค้า</span>
                    {LINE_REMINDER_RULES.map((r) => (
                      <ActionButton
                        key={r.key}
                        variant="share"
                        icon={icon(BellRing)}
                        className="lg:w-full justify-start"
                        onClick={() =>
                          picked
                            ? setRemind({ contact: picked, rule: { key: r.key, label: r.label } })
                            : showToast('กรุณาเลือกลูกค้าก่อน', 'ดับเบิลคลิกแถวลูกค้าในตาราง', 'INFO')
                        }
                      >
                        {r.label}
                      </ActionButton>
                    ))}
                  </div>
                )}
                {SEND_GROUPS.filter((g) => g.group === memberGroup)
                  .flatMap((g) => g.actions)
                  .filter((a) => isOwner || !a.ownerOnly)
                  .map((a) => (
                    <ActionButton key={a.id} variant={a.variant} icon={a.icon} className="lg:w-full justify-start" onClick={() => setSendOpen(a.id)}>
                      {a.label}
                    </ActionButton>
                  ))}
              </aside>
            </div>
          )}

          {/* ยืนยัน & จัดการ: requests and the link maker */}
          {tab === 'MANAGE' && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-y-auto">
                <div className="flex-1 min-h-[420px] flex flex-col">
                  <LinePeopleList
                    view={confirmView}
                    isOwner={isOwner}
                    onChanged={() => void loadCounts()}
                    tabs={
                      <div className="w-44 shrink-0">
                        <CustomSelect
                          value={confirmView}
                          ariaLabel="รายการที่ต้องยืนยัน"
                          onChange={(v) => setConfirmView(v as ConfirmView)}
                          options={CONFIRM_VIEWS.map((v) => ({ value: v, label: PEOPLE_VIEW_LABEL[v] }))}
                        />
                      </div>
                    }
                    actions={
                      isOwner ? (
                        <ActionButton variant="primary" icon={<UserPlus />} onClick={() => setNewCustomerOpen(true)}>
                          เพิ่มลูกค้า
                        </ActionButton>
                      ) : undefined
                    }
                  />
                </div>
                {isOwner && <LineInviteArea />}
              </div>
            </div>
          )}

          {/* แก้ไขข้อความ: choose whose messages before anything can be edited */}
          {tab === 'MESSAGES' && !pick && (
            <div className="flex-1 min-h-0 grid place-items-center p-4 overflow-y-auto">
              <div role="tablist" aria-label="แก้ไขข้อความของ" className="grid grid-cols-3 sm:grid-cols-5 gap-3 w-full max-w-3xl">
                {MESSAGE_PICKS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={false}
                    onClick={() => setPick(p.id)}
                    className="h-24 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 flex flex-col items-center justify-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100 cursor-pointer transition-colors"
                  >
                    <p.Icon className="w-6 h-6" />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'SETTINGS' && settingsPage === 'CONNECTION' && <LineConnectionPanel />}
          {tab === 'SETTINGS' && settingsPage === 'MENU' && <LineRichMenuSettings tabs={null} />}
          {tab === 'SETTINGS' && settingsPage === 'STAFF' && <LineMembersPanel tabs={null} />}
          {tab === 'SETTINGS' && settingsPage === 'HISTORY' && historyPage === 'HISTORY' && <LineDeliveryLogPanel tabs={null} />}
          {tab === 'SETTINGS' && settingsPage === 'HISTORY' && historyPage === 'AUDIT' && <LineAuditPanel tabs={null} />}
          {tab === 'SETTINGS' && settingsPage === 'HISTORY' && historyPage === 'CODES' && <LineCodesPanel tabs={null} />}

          {/* Kept mounted while hidden, so an unsaved setting, card or message survives a page switch */}
          {isOwner && (
            <>
              <LineSettingsWorkspace view={activeDraft ?? lastDraft} templateCategory={isCategory(pick) ? pick : lastCategory} hidden={activeDraft === null} />
              <div hidden={!(tab === 'MESSAGES' && pick === 'OWN')} className={tab === 'MESSAGES' && pick === 'OWN' ? 'flex-1 min-h-0 flex flex-col' : undefined}>
                <LineMessageComposer />
              </div>
              <div hidden={!(tab === 'MESSAGES' && pick === 'CARD')} className={tab === 'MESSAGES' && pick === 'CARD' ? 'flex-1 min-h-0 flex flex-col' : undefined}>
                <LineBillCardDesigner />
              </div>
            </>
          )}
        </div>
      </div>

      {/* The send buttons of ยืนยัน & จัดการ: each list in its own window */}
      <LineMemberRemind request={remind} onDone={() => setRemind(null)} />
      <AppModal isOpen={Boolean(send)} onClose={() => setSendOpen(null)} size="full">
        <AppModalHeader title={send?.label ?? ''} icon={send?.icon} onClose={() => setSendOpen(null)} />
        <AppModalBody noPadding className="h-[75vh] flex flex-col">
          {send?.id === 'SLIPS' && <LineSlipsPanel tabs={null} />}
          {send?.id === 'TASKS' && <LineTasksPanel tabs={null} />}
          {send?.id === 'DRIVERS' && <DeliveryDriversPanel tabs={null} />}
        </AppModalBody>
      </AppModal>

      {/* QR to add the shop LINE as a friend (adding a friend links nobody) */}
      <NewCustomerModal
        isOpen={newCustomerOpen}
        onClose={() => setNewCustomerOpen(false)}
        onSave={async (customer: Customer) => {
          try {
            await createCustomer(customer)
            setNewCustomerOpen(false)
            showToast('เพิ่มลูกค้าแล้ว', `บันทึก ${customer.customerName} เรียบร้อย`, 'SUCCESS')
          } catch (error) {
            showToast('เพิ่มลูกค้าไม่สำเร็จ', error instanceof Error ? error.message : 'กรุณาลองใหม่', 'ERROR')
            return false
          }
        }}
      />
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
              <Link href="/settings?view=system&tab=business" className="underline font-bold">
                ตั้งค่า › ข้อมูลกิจการ
              </Link>
            </p>
          )}
        </AppModalBody>
        {oa?.addFriendUrl && (
          <AppModalFooter>
            <ActionButton variant="share" icon={<Copy />} onClick={() => void copy(oa.addFriendUrl as string, 'คัดลอกลิงก์แล้ว', 'ลิงก์นี้ใช้เพิ่มเพื่อนอย่างเดียว ยังไม่ผูกกับใคร')}>
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
function StatCard({ tone, label, value, icon: cardIcon }: { tone: keyof typeof STAT_TONE; label: string; value: ReactNode; icon: ReactNode }) {
  const t = STAT_TONE[tone]
  return (
    <div className={`p-2 sm:p-2.5 rounded-xl border flex items-center justify-between ${t.box}`}>
      <div>
        <span className={`text-[10px] sm:text-[11px] font-semibold ${t.label}`}>{label}</span>
        <h3 className={`text-base sm:text-lg font-black mt-0.5 ${t.value}`}>{value}</h3>
      </div>
      <div className={`p-1.5 rounded-lg ${t.icon}`}>{cardIcon}</div>
    </div>
  )
}
