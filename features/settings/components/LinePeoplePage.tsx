'use client'

/**
 * เมนู LINE (/line), owner 2026-11-21: three pages, each with its own menu on the left and the work on the right.
 *   เพิ่มเพื่อนและจัดการบัญชี LINE — who is in LINE: overview, every list of people, staff, drivers, link codes, audit
 *   แก้ไขข้อความ                  — every text the system sends (4 groups) + the shop's own templates + bill cards (OWNER)
 *   ตั้งค่า                       — connection, new friends, registration, staff / customer notices, history (OWNER)
 * Summary cards on top. Lists come from the database a page at a time (never the whole table) and refresh by themselves
 * when the screen comes back into view (useAutoRefresh, no button; no realtime: line_contacts carries the LINE user id,
 * which never reaches a browser).
 */
import { CountUp } from '@/components/common/CountUp'
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { qrDataUrl } from '@/lib/qr-code'
import {
  BellRing,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Copy,
  FileText,
  HelpCircle,
  History,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  Link2Off,
  MessageSquare,
  Package,
  QrCode,
  ReceiptText,
  Send,
  Settings2,
  Truck,
  User,
  UserCog,
  UserPlus,
  Users,
  UserX,
  Ban,
} from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import {
  ActionButton,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
  COMMAND_BUTTON_SIZE_CLASSES,
} from '@/components/common/ActionButton'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useToast } from '@/components/common/Toast'
import { getLineOaInfo, getLinePeopleCounts, type LinePeopleCounts, type LinePeopleView } from '@/app/actions/line'
import type { LineTemplateCategory } from '@/lib/line/config'
import { DeliveryDriversPanel } from '@/features/settings/components/DeliveryDriversPanel'
import { LineConnectionPanel, type LineSettingsView } from '@/features/settings/components/LineSettingsPanel'
import { LineSettingsWorkspace } from '@/features/settings/components/LineSettingsWorkspace'
import { LineBillCardDesigner } from '@/features/settings/components/LineBillCardDesigner'
import { LineMessageComposer } from '@/features/settings/components/LineMessageComposer'
import { LineMembersPanel } from '@/features/settings/components/LineMembersPanel'
import { LineRemindersPanel } from '@/features/settings/components/LineRemindersPanel'
import { LineDeliveryLogPanel } from '@/features/settings/components/LineDeliveryLogPanel'
import { LinePeopleList } from '@/features/settings/components/line/LinePeopleList'
import { LineOverviewPanel } from '@/features/settings/components/line/LineOverviewPanel'
import { NewCustomerModal } from '@/features/customers/components/NewCustomerModal'
import { useCreateCustomer } from '@/features/customers/hooks/useCreateCustomer'
import type { Customer } from '@/lib/types/rental-pos'
import { LineCodesPanel } from '@/features/settings/components/line/LineCodesPanel'
import { LineSlipsPanel } from '@/features/settings/components/line/LineSlipsPanel'
import { LineTasksPanel } from '@/features/settings/components/line/LineTasksPanel'
import { LineAuditPanel } from '@/features/settings/components/line/LineAuditPanel'
import { LineRichMenuSettings } from '@/features/settings/components/line/LineRichMenuSettings'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { SETTINGS_HELPER } from '@/features/settings/components/settings-ui'

type LineGroup = 'FRIENDS' | 'MESSAGES' | 'SETTINGS'
type LineView =
  | 'OVERVIEW' | 'ALL' | 'UNREG' | 'PENDING' | 'NEEDINFO' | 'CUSTOMERS' | 'STAFF' | 'DRIVERS' | 'GENERAL' | 'REJECTED' | 'UNLINKED' | 'BLOCKED' | 'CODES' | 'AUDIT'
  | 'SLIPS' | 'TASKS'
  | 'MSG_FRIEND' | 'MSG_CATALOG' | 'MSG_CUSTOMER' | 'MSG_STAFF' | 'OWN' | 'CARD'
  | 'CONNECTION' | 'FRIEND' | 'REGISTER' | 'CATALOG' | 'MENU' | 'NOTIFY' | 'SCHEDULE' | 'MANUAL' | 'HISTORY'

const icon = (Node: typeof Users) => <Node className="w-3.5 h-3.5" />

const LINE_GROUPS: ReadonlyArray<{
  id: LineGroup
  label: string
  icon: ReactNode
  ownerOnly?: boolean
  /** `divider`: a line above the page in the left menu (between kinds of pages) */
  views: ReadonlyArray<{ id: LineView; label: string; ownerOnly?: boolean; icon: ReactNode; divider?: boolean }>
}> = [
  {
    id: 'FRIENDS',
    label: 'ลูกค้า',
    icon: icon(UserPlus),
    views: [
      { id: 'PENDING', label: 'รอยืนยัน', icon: icon(ClipboardList) },
      { id: 'SLIPS', label: 'สลิปรอตรวจ', icon: icon(ReceiptText) },
      { id: 'OVERVIEW', label: 'ภาพรวม', icon: icon(LayoutDashboard) },
      { id: 'ALL', label: 'เพื่อนทั้งหมด', icon: icon(Users) },
      { id: 'UNREG', label: 'ยังไม่ลงทะเบียน', icon: icon(User) },
      { id: 'NEEDINFO', label: 'รอข้อมูลเพิ่มเติม', icon: icon(HelpCircle) },
      { id: 'CUSTOMERS', label: 'ลูกค้า', icon: icon(Users), divider: true },
      { id: 'STAFF', label: 'พนักงาน', ownerOnly: true, icon: icon(UserCog) },
      { id: 'TASKS', label: 'สั่งงานพนักงาน', icon: icon(Send) },
      { id: 'DRIVERS', label: 'คนขับรถ', icon: icon(Truck) },
      { id: 'GENERAL', label: 'บุคคลทั่วไป', icon: icon(User) },
      { id: 'REJECTED', label: 'ถูกปฏิเสธ', icon: icon(Ban), divider: true },
      { id: 'UNLINKED', label: 'ยกเลิกผูกบัญชี', icon: icon(Link2Off) },
      { id: 'BLOCKED', label: 'บล็อก LINE OA', icon: icon(UserX) },
      { id: 'CODES', label: 'จัดการรหัสเชิญ', ownerOnly: true, icon: icon(KeyRound), divider: true },
      { id: 'AUDIT', label: 'ประวัติการตรวจสอบ', ownerOnly: true, icon: icon(History) },
    ],
  },
  {
    id: 'MESSAGES',
    label: 'แก้ไขข้อความ',
    icon: icon(MessageSquare),
    ownerOnly: true,
    views: [
      { id: 'MSG_FRIEND', label: 'เพิ่มเพื่อนและลงทะเบียน', icon: icon(UserPlus) },
      { id: 'MSG_CATALOG', label: 'สินค้าและการติดต่อ', icon: icon(Package) },
      { id: 'MSG_CUSTOMER', label: 'ลูกค้าและเอกสาร', icon: icon(ReceiptText) },
      { id: 'MSG_STAFF', label: 'พนักงานและคนขับ', icon: icon(Truck) },
      { id: 'OWN', label: 'แม่แบบของร้าน', icon: icon(FileText), divider: true },
      { id: 'CARD', label: 'การ์ดบิล', icon: icon(ReceiptText) },
    ],
  },
  {
    id: 'SETTINGS',
    label: 'ตั้งค่า',
    icon: icon(Settings2),
    ownerOnly: true,
    views: [
      { id: 'CONNECTION', label: 'การเชื่อมต่อ', icon: icon(Link2) },
      { id: 'FRIEND', label: 'การเพิ่มเพื่อน', icon: icon(UserPlus) },
      { id: 'REGISTER', label: 'การลงทะเบียน', icon: icon(ClipboardCheck) },
      { id: 'CATALOG', label: 'รายการสินค้า', icon: icon(Package) },
      { id: 'MENU', label: 'เมนู LINE', icon: icon(LayoutGrid) },
      { id: 'NOTIFY', label: 'แจ้งพนักงาน', icon: icon(BellRing), divider: true },
      { id: 'SCHEDULE', label: 'เตือนลูกค้า', icon: icon(CalendarClock) },
      { id: 'MANUAL', label: 'ส่งเตือนเอง', icon: icon(Send) },
      { id: 'HISTORY', label: 'ประวัติการส่ง', icon: icon(History) },
    ],
  },
]

const groupOf = (v: LineView) => LINE_GROUPS.find((g) => g.views.some((x) => x.id === v)) ?? LINE_GROUPS[0]
const isOwnerView = (v: LineView) => Boolean(groupOf(v).ownerOnly || groupOf(v).views.find((x) => x.id === v)?.ownerOnly)
const ALL_VIEWS = LINE_GROUPS.flatMap((g) => g.views.map((v) => v.id))

/** Lists of people that are one LinePeopleList with a different view (staff and drivers have their own panels). */
const PEOPLE_LIST_VIEWS: readonly LineView[] = ['ALL', 'UNREG', 'PENDING', 'NEEDINFO', 'CUSTOMERS', 'GENERAL', 'REJECTED', 'UNLINKED', 'BLOCKED']
const MSG_CATEGORY: Partial<Record<LineView, LineTemplateCategory>> = { MSG_FRIEND: 'FRIEND', MSG_CATALOG: 'CATALOG', MSG_CUSTOMER: 'CUSTOMER', MSG_STAFF: 'STAFF' }
/** The pages kept in the settings draft (LineSettingsWorkspace): the four message groups share the TEMPLATES draft. */
const draftViewOf = (v: LineView): LineSettingsView | null =>
  MSG_CATEGORY[v] ? 'TEMPLATES' : v === 'NOTIFY' || v === 'SCHEDULE' || v === 'FRIEND' || v === 'REGISTER' || v === 'CATALOG' ? v : null

/** Old links /line?tab=settings&view=… (and TEMPLATES, which is now the four message groups) */
const LEGACY_VIEW: Record<string, LineView> = { TEMPLATES: 'MSG_FRIEND', LINKED: 'CUSTOMERS' }

export function LinePeoplePage() {
  const { showToast } = useToast()
  const { user } = useAuth()
  // everything but the people pages is the OWNER's (staff see คนใน LINE only)
  const isOwner = user?.role === 'OWNER'
  const [tab, setTab] = useState<LineView>('PENDING')
  // staff never see the OWNER's pages, even from a ?tab=settings link
  const view: LineView = isOwnerView(tab) && !isOwner ? 'OVERVIEW' : tab
  const group = groupOf(view)
  // each group opens on the page last used in it
  const [lastView, setLastView] = useState<Record<LineGroup, LineView>>({ FRIENDS: 'PENDING', MESSAGES: 'MSG_FRIEND', SETTINGS: 'CONNECTION' })
  const [draftView, setDraftView] = useState<LineSettingsView>('TEMPLATES')
  const [category, setCategory] = useState<LineTemplateCategory>('FRIEND')
  const open = (v: LineView) => {
    setTab(v)
    setLastView((prev) => ({ ...prev, [groupOf(v).id]: v }))
    const d = draftViewOf(v)
    if (d) setDraftView(d)
    const c = MSG_CATEGORY[v]
    if (c) setCategory(c)
  }
  const [qrOpen, setQrOpen] = useState(false)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)
  const createCustomer = useCreateCustomer()
  const [counts, setCounts] = useState<LinePeopleCounts | null>(null)
  const [oa, setOa] = useState<{ lineId: string | null; addFriendUrl: string | null; qr: string | null } | null>(null)

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

  // Links: /line?tab=settings[&view=TEMPLATES] (old ตั้งค่า › LINE links land here)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('tab') !== 'settings') return
    const raw = q.get('view') ?? ''
    const v = (LEGACY_VIEW[raw] ?? raw) as LineView
    open(ALL_VIEWS.includes(v) ? v : 'CONNECTION')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the link once on arrival
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
  // Main LINE sections use a compact app-native sidebar; each section's pages stay in the workspace tab row.
  const tabBar = (
    <nav className="flex flex-row lg:flex-col items-stretch gap-1 min-w-0 max-w-full overflow-x-auto lg:overflow-x-visible no-scrollbar shrink-0" role="tablist" aria-label="เมนู LINE">
      {isOwner && (
        LINE_GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group.id === g.id} onClick={() => open(lastView[g.id])} className={`${tabClass(group.id === g.id)} justify-start whitespace-nowrap lg:whitespace-normal lg:w-full`}>
            {g.icon}
            {g.label}
            {g.id === 'FRIENDS' && pending + needInfo > 0 && countBadge(pending + needInfo)}
          </button>
        ))
      )}
    </nav>
  )
  /** Pages within the selected section use the same tab components as the rest of the app. */
  const sideBar = (
    <div className="shrink-0 p-2 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
      <nav className="flex min-w-max items-center gap-1" role="tablist" aria-label={group.label}>
        {group.views
          .filter((v) => isOwner || !v.ownerOnly)
          .map((v) => (
            <Fragment key={v.id}>
              {v.divider && <span aria-hidden="true" className="h-px mx-2 my-0.5 bg-slate-300 dark:bg-slate-600" />}
              <button
                type="button"
                role="tab"
                aria-selected={view === v.id}
                onClick={() => open(v.id)}
                className={`${TAB_BUTTON_BASE_CLASSES} ${view === v.id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
              >
                {v.icon}
                {v.label}
              </button>
            </Fragment>
          ))}
      </nav>
    </div>
  )
  const draft = draftViewOf(view)

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden gap-2 p-2 bg-slate-100 dark:bg-black text-xs">
      <div className="settings-ref flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
        {/* Summary cards inside the white box (owner 2026-11-17) */}
        <div className="card-lift-row grid grid-cols-2 lg:grid-cols-4 gap-1.5 sm:gap-2 shrink-0 p-2">
          <StatCard tone="amber" label="รอร้านตรวจสอบ" value={<><CountUp value={pending} /> คน</>} icon={<UserPlus className="w-3.5 h-3.5" />} />
          <StatCard tone="emerald" label="ลูกค้าที่ผูก LINE" value={<><CountUp value={counts?.customers ?? 0} /> คน</>} icon={<Users className="w-3.5 h-3.5" />} />
          <StatCard tone="red" label="บล็อก / ลบ LINE ร้าน" value={<><CountUp value={counts?.blocked ?? 0} /> คน</>} icon={<UserX className="w-3.5 h-3.5" />} />
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

        {/* The work area: the pages of the open group on the left, the page on the right. Pages with controls of their
            own (the lists, พนักงาน, คนขับรถ, ส่งเตือนเอง, ประวัติการส่ง ...) draw the toolbar row themselves with the
            group tabs first; the others get a plain row. */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col lg:flex-row overflow-hidden">
          <aside className="shrink-0 lg:w-52 lg:border-r border-b lg:border-b-0 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-2">
            {tabBar}
          </aside>
          <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
            {sideBar}
            {view === 'OVERVIEW' && <LineOverviewPanel tabs={null} counts={counts} onOpen={(v) => open(v as LineView)} oa={oa} isOwner={isOwner} />}
            {PEOPLE_LIST_VIEWS.includes(view) && (
              <LinePeopleList
                view={view as LinePeopleView}
                tabs={null}
                isOwner={isOwner}
                onChanged={() => void loadCounts()}
                actions={view === 'PENDING' && isOwner ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionButton variant="primary" icon={<UserPlus />} onClick={() => setNewCustomerOpen(true)}>เพิ่มลูกค้า</ActionButton>
                    <ActionButton variant="secondary" icon={<UserCog />} onClick={() => open('STAFF')}>พนักงานที่ผูก LINE</ActionButton>
                  </div>
                ) : undefined}
              />
            )}
            {view === 'STAFF' && <LineMembersPanel tabs={null} />}
            {view === 'SLIPS' && <LineSlipsPanel tabs={null} />}
            {view === 'TASKS' && <LineTasksPanel tabs={null} />}
            {view === 'DRIVERS' && <DeliveryDriversPanel tabs={null} />}
            {view === 'CODES' && <LineCodesPanel tabs={null} />}
            {view === 'AUDIT' && <LineAuditPanel tabs={null} />}
            {view === 'MENU' && <LineRichMenuSettings tabs={null} />}
            {view === 'MANUAL' && <LineRemindersPanel tabs={null} />}
            {view === 'HISTORY' && <LineDeliveryLogPanel tabs={null} />}
            {view === 'CONNECTION' && <LineConnectionPanel />}

            {/* Kept mounted while hidden, so an unsaved setting, card or message survives a page switch */}
            {isOwner && (
              <>
                <LineSettingsWorkspace view={draftView} templateCategory={category} hidden={draft === null} />
                <div hidden={view !== 'OWN'} className={view === 'OWN' ? 'flex-1 min-h-0 flex flex-col' : undefined}>
                  <LineMessageComposer />
                </div>
                <div hidden={view !== 'CARD'} className={view === 'CARD' ? 'flex-1 min-h-0 flex flex-col' : undefined}>
                  <LineBillCardDesigner />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

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
