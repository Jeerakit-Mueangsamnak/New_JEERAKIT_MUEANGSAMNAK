'use client'
import {
  COMMAND_BUTTON_SIZE_CLASSES,
  TAB_BAR_SURFACE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'

import {
  SETTINGS_HELPER,
  SETTINGS_INPUT,
  SETTINGS_INPUT_MONO,
  SETTINGS_LABEL,
  SETTINGS_SECTION,
  SETTINGS_SECTION_TITLE,
} from '@/features/settings/components/settings-ui'
import React, { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  Building,
  Percent,
  CreditCard,
  CalendarDays,
  Package,
  FileText,
  ShieldCheck,
  Save,
  RotateCcw,
  Upload,
  Trash2,
  Image as ImageIcon,
  AlertTriangle,
  Lock,
  UserRound, User, Bell, Monitor, ChevronRight, Settings as SettingsIcon, LockKeyhole,
  MessageCircle, Users,
} from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { NumericInput } from '@/components/common/NumericInput'
import { DocumentNumberingPanel } from '@/features/settings/components/DocumentNumberingPanel'
import {
  AUTO_LOCK_CHOICES_SECONDS,
  type SettingsSection,
  type SystemConfig,
} from '@/features/settings/services/settings-storage'
import {
  applySectionSaved,
  applyServerUpdate,
  initSectionDrafts,
  isSectionDirty,
  resetSection,
  SETTINGS_SECTIONS,
  type SectionDrafts,
} from '@/features/settings/utils/section-drafts'
import { useLeaveGuard } from '@/features/settings/hooks/useLeaveGuard'
import { autoLockLabel, validateSection } from '@/features/settings/utils/settings-validation'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { CustomSelect } from '@/components/common/CustomSelect'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { MyAccountPanel, type MyAccountTab } from '@/features/settings/components/MyAccountPanel'
import { LinePeoplePage } from '@/features/settings/components/LinePeoplePage'
import OwnerPermissionsPage from '@/app/owner-permissions/page'

const TABS: Array<{ id: SettingsSection; label: string; description?: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'business', label: 'ข้อมูลกิจการ', icon: Building },
  { id: 'documentNumbering', label: 'เอกสารและเทมเพลต', icon: FileText },
  { id: 'taxDiscount', label: 'ภาษีและส่วนลด', icon: Percent },
  { id: 'payment', label: 'การชำระเงิน', icon: CreditCard },
  { id: 'salesRental', label: 'การขายและการเช่า', icon: CalendarDays },
  { id: 'product', label: 'สินค้าและสต็อก', icon: Package },
  { id: 'shopSecurity', label: 'ความปลอดภัยร้าน', icon: ShieldCheck },
]

const PERSONAL_TABS: Array<{ id: MyAccountTab; label: string; description?: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'PROFILE', label: 'โปรไฟล์ของฉัน', icon: User },
  { id: 'SECURITY', label: 'บัญชีและความปลอดภัย', icon: LockKeyhole },
  { id: 'NOTIFICATIONS', label: 'การแจ้งเตือนส่วนตัว', icon: Bell },
  { id: 'APPEARANCE', label: 'การแสดงผล', icon: Monitor },
]

type SystemView = SettingsSection | 'line' | 'members'
type SettingsMenuItem = {
  id: SystemView | MyAccountTab
  label: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
}
type SettingsMenuGroup = { id: string; label: string; items: SettingsMenuItem[] }

const LINE_SETTINGS_ITEM = {
  id: 'line',
  label: 'คนใน LINE',
  description: 'รายชื่อ การเชื่อมต่อ และการตั้งค่า LINE',
  icon: MessageCircle,
} as const

const MEMBER_SETTINGS_ITEM = {
  id: 'members',
  label: 'สิทธิ์และประวัติ',
  description: 'จัดการสมาชิกและตรวจสอบรายการ',
  icon: Users,
} as const

const PERSONAL_MENU_GROUPS: SettingsMenuGroup[] = [
  { id: 'account', label: 'บัญชีของฉัน', items: PERSONAL_TABS.filter((item) => item.id === 'PROFILE' || item.id === 'SECURITY') },
  { id: 'experience', label: 'ประสบการณ์ใช้งาน', items: PERSONAL_TABS.filter((item) => item.id === 'NOTIFICATIONS' || item.id === 'APPEARANCE') },
]

const SYSTEM_MENU_GROUPS: SettingsMenuGroup[] = [
  { id: 'business', label: 'ข้อมูลกิจการและเอกสาร', items: TABS.filter((item) => item.id === 'business' || item.id === 'documentNumbering') },
  { id: 'operations', label: 'การทำงานและสินค้า', items: TABS.filter((item) => item.id === 'taxDiscount' || item.id === 'payment' || item.id === 'salesRental' || item.id === 'product') },
  { id: 'security', label: 'ความปลอดภัย', items: TABS.filter((item) => item.id === 'shopSecurity') },
  { id: 'line', label: 'การเชื่อมต่อ', items: [LINE_SETTINGS_ITEM] },
  { id: 'members', label: 'ผู้ใช้งานและประวัติ', items: [MEMBER_SETTINGS_ITEM] },
]

const MAX_IMAGE_BYTES = 500 * 1024

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 text-blue-600 dark:text-blue-400 rounded" />
      <span>
        <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">{label}</span>
      </span>
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  required,
  mono,
  placeholder,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  mono?: boolean
  placeholder?: string
  maxLength?: number
}) {
  return (
    <div>
      <label className={SETTINGS_LABEL}>
        {label} {required && <span className="text-red-700 dark:text-red-400">*</span>}
      </label>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? SETTINGS_INPUT_MONO : SETTINGS_INPUT}
      />
    </div>
  )
}

/** Picks an image into the section draft (saved with the section, never on its own). */
function ImageField({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      showToast('ไฟล์ใหญ่เกินไป', 'รูปต้องมีขนาดไม่เกิน 500 KB', 'ERROR')
      return
    }
    onChange(await readFileAsDataUrl(file))
  }
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
      <div className="w-28 h-20 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="w-full h-full object-contain p-1" />
        ) : (
          <ImageIcon className="w-7 h-7 text-slate-300" />
        )}
      </div>
      <div className="space-y-1.5">
        <span className={SETTINGS_LABEL}>{label}</span>
        <div className="flex flex-wrap gap-2">
          <input ref={ref} type="file" accept="image/png, image/jpeg, image/webp" className="hidden" onChange={pick} />
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-blue-600 hover:bg-blue-700 text-white flex items-center`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{value ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}</span>
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 flex items-center`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>ลบรูป</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type SetDraft = Dispatch<SetStateAction<SystemConfig>>

function BusinessSection({ cfg, set }: { cfg: SystemConfig; set: SetDraft }) {
  const b = cfg.business
  const setB = (patch: Partial<SystemConfig['business']>) => set((p) => ({ ...p, business: { ...p.business, ...patch } }))
  return (
    <>
      <div className={SETTINGS_SECTION}>
        <ImageField
          label="โลโก้กิจการ (พิมพ์บนเอกสาร)"
          value={b.logoDataUrl}
          onChange={(v) => setB({ logoDataUrl: v })}
        />
      </div>
      <div className={SETTINGS_SECTION}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField label="ชื่อกิจการ / ร้านค้า" required value={b.businessName} onChange={(v) => setB({ businessName: v })} />
          <TextField label="เลขประจำตัวผู้เสียภาษี" mono maxLength={13} value={b.taxId} onChange={(v) => setB({ taxId: v.replace(/\D/g, '') })} />
          <TextField label="เบอร์โทรศัพท์" value={b.phone} onChange={(v) => setB({ phone: v })} />
          <TextField label="อีเมล" value={b.email} onChange={(v) => setB({ email: v })} />
          <TextField label="LINE ID" value={b.lineId} onChange={(v) => setB({ lineId: v })} />
          <TextField label="ผู้มีอำนาจลงนาม" value={b.authorizedPerson} onChange={(v) => setB({ authorizedPerson: v })} />
          <div className="sm:col-span-2">
            <label className={SETTINGS_LABEL}>ที่อยู่</label>
            <textarea
              value={b.address}
              rows={2}
              onChange={(e) => setB({ address: e.target.value })}
              className={`${SETTINGS_INPUT} h-auto py-2`}
            />
          </div>
          <div>
            <label className={SETTINGS_LABEL}>เขตเวลาของร้าน</label>
            <input value={cfg.timezone} readOnly disabled className={SETTINGS_INPUT_MONO} />
          </div>
        </div>
      </div>
    </>
  )
}

function TaxDiscountSection({ cfg, set }: { cfg: SystemConfig; set: SetDraft }) {
  const t = cfg.taxDiscount
  const setT = (patch: Partial<SystemConfig['taxDiscount']>) => set((p) => ({ ...p, taxDiscount: { ...p.taxDiscount, ...patch } }))
  return (
    <>
      <div className={SETTINGS_SECTION}>
        <h4 className={SETTINGS_SECTION_TITLE}>
          <Percent className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>ภาษีมูลค่าเพิ่ม (VAT)</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
          <div>
            <label className={SETTINGS_LABEL}>อัตรา VAT (%)</label>
            <NumericInput
              value={t.vatRate ?? ''}
              onChange={(v) => setT({ vatRate: v === '' ? null : v })}
              min={0}
              max={100}
              allowDecimals
              placeholder="ยังไม่ได้ตั้ง"
              className={SETTINGS_INPUT_MONO}
            />
          </div>
        </div>
      </div>
      <div className={SETTINGS_SECTION}>
        <h4 className={SETTINGS_SECTION_TITLE}>
          <Percent className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
          <span>เพดานส่วนลด</span>
        </h4>
        <Toggle
          checked={t.discountLimitEnabled}
          onChange={(v) => setT({ discountLimitEnabled: v, discountLimitPercent: v ? t.discountLimitPercent : null })}
          label="จำกัดส่วนลดสูงสุด"
        />
        {t.discountLimitEnabled && (
          <div className="max-w-[200px]">
            <label className={SETTINGS_LABEL}>ส่วนลดสูงสุด (%)</label>
            <NumericInput
              value={t.discountLimitPercent ?? ''}
              onChange={(v) => setT({ discountLimitPercent: v === '' ? null : v })}
              min={0}
              max={100}
              allowDecimals
              className={SETTINGS_INPUT_MONO}
            />
          </div>
        )}
      </div>
    </>
  )
}

function PaymentSection({ cfg, set }: { cfg: SystemConfig; set: SetDraft }) {
  const b = cfg.business
  const setB = (patch: Partial<SystemConfig['business']>) => set((p) => ({ ...p, business: { ...p.business, ...patch } }))
  return (
    <>
      <div className={SETTINGS_SECTION}>
        <h4 className={SETTINGS_SECTION_TITLE}>
          <CreditCard className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>บัญชีรับเงิน (แสดงบนบิล/ใบเสร็จ)</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextField label="ธนาคาร" value={b.bankName} onChange={(v) => setB({ bankName: v })} />
          <TextField label="ชื่อบัญชี" value={b.bankAccountName} onChange={(v) => setB({ bankAccountName: v })} />
          <TextField label="เลขที่บัญชี" mono value={b.bankAccountNumber} onChange={(v) => setB({ bankAccountNumber: v })} />
          <div>
            <label className={SETTINGS_LABEL}>ประเภท PromptPay</label>
            <CustomSelect
              ariaLabel="ประเภท PromptPay"
              value={b.promptPayType || ''}
              onChange={(value) => setB({ promptPayType: String(value) })}
              options={[
                { value: '', label: 'ไม่ระบุ' },
                { value: 'PHONE', label: 'เบอร์โทรศัพท์' },
                { value: 'TAX_ID', label: 'เลขผู้เสียภาษี / บัตรประชาชน' },
              ]}
            />
          </div>
          <TextField
            label="หมายเลข PromptPay"
            mono
            maxLength={b.promptPayType === 'PHONE' ? 10 : 13}
            value={b.promptPayValue}
            onChange={(v) => setB({ promptPayValue: v.replace(/\D/g, '') })}
          />
        </div>
      </div>
      <div className={SETTINGS_SECTION}>
        <ImageField label="รูป QR รับเงิน" value={b.bankQrDataUrl} onChange={(v) => setB({ bankQrDataUrl: v })}  />
      </div>
      <div className={SETTINGS_SECTION}>
        <Toggle
          checked={cfg.payment.allowOverpayment}
          onChange={(v) => set((p) => ({ ...p, payment: { allowOverpayment: v } }))}
          label="รับเงินเกินยอดค้างได้"
        />
      </div>
    </>
  )
}

function SalesRentalSection({ cfg, set }: { cfg: SystemConfig; set: SetDraft }) {
  const s = cfg.salesRental
  const setS = (patch: Partial<SystemConfig['salesRental']>) => set((p) => ({ ...p, salesRental: { ...p.salesRental, ...patch } }))
  return (
    <div className={SETTINGS_SECTION}>
      <Toggle
        checked={s.allowBackorder}
        onChange={(v) => setS({ allowBackorder: v })}
        label="ยืนยันบิลได้แม้สต็อกไม่พอ (ค้างส่ง)"
      />
      <Toggle
        checked={s.reservationAutoRelease}
        onChange={(v) => setS({ reservationAutoRelease: v })}
        label="ปล่อยของที่จองไว้อัตโนมัติเมื่อหมดอายุ"
      />
    </div>
  )
}

function ProductSection({ cfg, set }: { cfg: SystemConfig; set: SetDraft }) {
  return (
    <div className={SETTINGS_SECTION}>
      <div className="max-w-xs">
        <label className={SETTINGS_LABEL}>จุดสั่งซื้อเริ่มต้นของสินค้าใหม่</label>
        <NumericInput
          value={cfg.product.defaultReorderPoint}
          onChange={(v) => set((p) => ({ ...p, product: { defaultReorderPoint: v === '' ? 0 : v } }))}
          min={0}
          defaultValueOnBlur={0}
          className={SETTINGS_INPUT_MONO}
        />
      </div>
    </div>
  )
}

function ShopSecuritySection({ cfg, set }: { cfg: SystemConfig; set: SetDraft }) {
  const s = cfg.shopSecurity
  const toggle = (sec: number, on: boolean) =>
    set((p) => {
      const opts = on
        ? AUTO_LOCK_CHOICES_SECONDS.filter((x) => x === sec || p.shopSecurity.autoLockOptionsSeconds.includes(x))
        : p.shopSecurity.autoLockOptionsSeconds.filter((x) => x !== sec)
      return { ...p, shopSecurity: { ...p.shopSecurity, autoLockOptionsSeconds: [...opts] } }
    })
  return (
    <div className={SETTINGS_SECTION}>
      <h4 className={SETTINGS_SECTION_TITLE}>
        <Lock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        <span>ล็อกแอปอัตโนมัติ</span>
      </h4>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {AUTO_LOCK_CHOICES_SECONDS.map((sec) => (
          <label key={sec} className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={s.autoLockOptionsSeconds.includes(sec)} onChange={(e) => toggle(sec, e.target.checked)} className="w-4 h-4 rounded" />
            {autoLockLabel(sec)}
          </label>
        ))}
      </div>
      <div className="max-w-xs">
        <label className={SETTINGS_LABEL}>ค่าเริ่มต้น (ผู้ที่ยังไม่ได้เลือก)</label>
        <CustomSelect
          ariaLabel="ค่าเริ่มต้น (ผู้ที่ยังไม่ได้เลือก)"
          value={s.autoLockDefaultSeconds}
          onChange={(value) => set((p) => ({ ...p, shopSecurity: { ...p.shopSecurity, autoLockDefaultSeconds: Number(value) } }))}
          options={s.autoLockOptionsSeconds.map((sec) => ({ value: sec, label: autoLockLabel(sec) }))}
        />
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { showToast } = useToast()
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const { settings, saveSection } = useSystemSettings()
  const [drafts, setDrafts] = useState<SectionDrafts>(() => initSectionDrafts(settings))
  const [activeTab, setActiveTab] = useState<SettingsSection>('business')
  const [systemView, setSystemView] = useState<SystemView>('business')
  const [mainTab, setMainTab] = useState<'personal' | 'system'>('personal')
  const [personalTab, setPersonalTab] = useState<MyAccountTab>('PROFILE')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOwner) setMainTab('system')
  }, [isOwner])

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab')
    if (wanted === 'line') {
      setSystemView('line')
      setMainTab('system')
      return
    }
    if (wanted === 'members') {
      if (isOwner) {
        setSystemView('members')
        setMainTab('system')
      }
      return
    }
    const match = TABS.find((t) => t.id === wanted)
    if (match && isOwner) {
      setActiveTab(match.id)
      setSystemView(match.id)
      setMainTab('system')
    }
  }, [isOwner])

  useEffect(() => { setDrafts((d) => applyServerUpdate(d, settings)) }, [settings])

  const section = drafts[activeTab]
  const dirty = isSectionDirty(section, activeTab)
  // Unsaved edits in any section: ask before the page is left (they would be lost).
  useLeaveGuard(SETTINGS_SECTIONS.some((s) => isSectionDirty(drafts[s], s)))
  const setDraft: SetDraft = (action) => setDrafts((d) => {
    const prev = d[activeTab].draft
    const next = typeof action === 'function' ? action(prev) : action
    return { ...d, [activeTab]: { ...d[activeTab], draft: next } }
  })

  const handleSave = async () => {
    const error = validateSection(activeTab, section.draft)
    if (error) { showToast('บันทึกไม่สำเร็จ', error, 'ERROR'); return }
    setSaving(true)
    try {
      const saved = await saveSection(activeTab, section.draft)
      setDrafts((d) => applySectionSaved(d, activeTab, saved))
      showToast('บันทึกแล้ว', `บันทึก "${TABS.find((t) => t.id === activeTab)?.label}" เรียบร้อย`, 'SUCCESS')
    } catch (err: unknown) {
      showToast('บันทึกไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด', 'ERROR')
    } finally { setSaving(false) }
  }

  const handleCancel = () => setDrafts((d) => resetSection(d, activeTab, settings))
  const cfg = section.draft
  const menuGroups: SettingsMenuGroup[] = mainTab === 'personal'
    ? PERSONAL_MENU_GROUPS
    : isOwner
      ? SYSTEM_MENU_GROUPS
      : SYSTEM_MENU_GROUPS.filter((group) => group.id === 'line')
  const selectedItem: SettingsMenuItem | undefined = mainTab === 'personal'
    ? PERSONAL_TABS.find((t) => t.id === personalTab)
    : SYSTEM_MENU_GROUPS.flatMap((group) => group.items).find((item) => item.id === systemView)
  const selectSystemView = (view: SystemView) => {
    setSystemView(view)
    if (TABS.some((item) => item.id === view)) setActiveTab(view as SettingsSection)
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-2 overflow-hidden bg-slate-100 dark:bg-slate-950 text-xs p-2 sm:p-3">
      <header className="shrink-0 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm px-3 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center shrink-0">
            <SettingsIcon className="w-5 h-5 text-blue-700 dark:text-blue-400" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">ตั้งค่า</h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">จัดการบัญชีส่วนตัวและการตั้งค่าของร้านในที่เดียว</p>
          </div>
        </div>
        <div className={`${TAB_BAR_SURFACE_CLASSES} flex w-full sm:w-auto`} role="tablist" aria-label="ประเภทการตั้งค่า">
          <button type="button" role="tab" aria-selected={mainTab === 'personal'} onClick={() => setMainTab('personal')} className={`${TAB_BUTTON_BASE_CLASSES} flex-1 sm:flex-none ${mainTab === 'personal' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}><UserRound className="w-3.5 h-3.5"/>ตั้งค่าส่วนตัว</button>
          <button type="button" role="tab" aria-selected={mainTab === 'system'} onClick={() => { setMainTab('system'); if (!isOwner) selectSystemView('line') }} className={`${TAB_BUTTON_BASE_CLASSES} flex-1 sm:flex-none ${mainTab === 'system' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}><ShieldCheck className="w-3.5 h-3.5"/>ตั้งค่าระบบ</button>
        </div>
      </header>

      <div className="flex-1 min-h-0 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="h-full min-h-0 grid grid-cols-1 grid-rows-[minmax(150px,34%)_minmax(0,1fr)] lg:grid-rows-1 lg:grid-cols-[minmax(260px,25%)_minmax(0,1fr)]">
          <aside className="min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-700 bg-[#d6e4ff] dark:bg-slate-900/70">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700 dark:text-blue-400">{mainTab === 'personal' ? 'ตั้งค่าส่วนตัว' : 'ตั้งค่าระบบ'}</p>
              <p className="mt-0.5 text-xs font-bold text-slate-800 dark:text-slate-100">เลือกหมวดที่ต้องการ</p>
            </div>
            <nav className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-3 space-y-2" aria-label={mainTab === 'personal' ? 'ตั้งค่าส่วนตัว' : 'ตั้งค่าระบบ'}>
              {menuGroups.map((group) => (
                <section key={group.id}>
                  <h3 className="px-2 pb-1.5 text-[10px] font-extrabold text-slate-500 dark:text-slate-400">{group.label}</h3>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const Icon = item.icon
                      const selected = mainTab === 'personal' ? personalTab === item.id : systemView === item.id
                      const setting = TABS.find((tab) => tab.id === item.id)
                      const dirtyItem = Boolean(setting && isSectionDirty(drafts[setting.id], setting.id))
                      return <button key={item.id} type="button" onClick={() => mainTab === 'personal' ? setPersonalTab(item.id as MyAccountTab) : selectSystemView(item.id as SystemView)} aria-current={selected ? 'page' : undefined} className={`w-full min-h-12 rounded-xl px-2.5 py-2 flex items-center gap-2.5 text-left transition ${selected ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-800 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700'}`}>
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${selected ? 'bg-white/15' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}><Icon className={`w-4 h-4 ${selected ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}/></span>
                        <span className="min-w-0 flex-1"><span className="block font-bold text-xs leading-5">{item.label}</span>{item.description && <span className={`block text-[10px] leading-4 ${selected ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}>{item.description}</span>}</span>
                        {dirtyItem && <span className="w-2 h-2 rounded-full bg-amber-400"/>}<ChevronRight className={`w-4 h-4 shrink-0 ${selected ? 'text-white' : 'text-blue-600'}`}/>
                      </button>
                    })}
                  </div>
                </section>
              ))}
            </nav>
          </aside>

          <section className="min-w-0 min-h-0 flex flex-col bg-white dark:bg-slate-900">
            {mainTab === 'personal' ? <MyAccountPanel key={personalTab} initialTab={personalTab} embedded /> : systemView === 'line' ? (
              <div className="flex-1 min-h-0 overflow-hidden"><LinePeoplePage /></div>
            ) : systemView === 'members' ? (
              <div className="flex-1 min-h-0 overflow-hidden"><OwnerPermissionsPage /></div>
            ) : <>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5">
                <div className="mb-4"><h2 className="text-lg font-extrabold text-slate-900 dark:text-white">{selectedItem?.label}</h2>{selectedItem?.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{selectedItem.description}</p>}</div>
                {section.conflict && <div className="mb-3 p-2.5 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-amber-800 dark:text-amber-200 flex flex-wrap items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0"/><span className="flex-1 min-w-0">ค่าของหัวข้อนี้ถูกเปลี่ยนจากที่อื่นระหว่างที่คุณแก้ไข · ค่าที่คุณกรอกยังอยู่</span><button type="button" onClick={handleCancel} className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-amber-400`}>โหลดค่าล่าสุด</button></div>}
                {activeTab === 'business' && <BusinessSection cfg={cfg} set={setDraft} />}
                {activeTab === 'taxDiscount' && <TaxDiscountSection cfg={cfg} set={setDraft} />}
                {activeTab === 'payment' && <PaymentSection cfg={cfg} set={setDraft} />}
                {activeTab === 'salesRental' && <SalesRentalSection cfg={cfg} set={setDraft} />}
                {activeTab === 'product' && <ProductSection cfg={cfg} set={setDraft} />}
                {activeTab === 'documentNumbering' && <div className={SETTINGS_SECTION}><DocumentNumberingPanel config={cfg} setConfig={setDraft} /></div>}
                {activeTab === 'shopSecurity' && <ShopSecuritySection cfg={cfg} set={setDraft} />}
              </div>
              <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 shrink-0 bg-white dark:bg-slate-900">
                <div className="flex gap-2">
                  <button type="button" onClick={handleCancel} disabled={!dirty || saving} className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center disabled:opacity-50`}><RotateCcw className="w-4 h-4"/><span>คืนค่าที่บันทึกไว้</span></button>
                  <button type="button" onClick={() => void handleSave()} disabled={!dirty || saving} className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-blue-600 hover:bg-blue-700 text-white flex items-center disabled:opacity-50`}><Save className="w-4 h-4"/><span>{saving ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}</span></button>
                </div>
              </div>
            </>}
          </section>
        </div>
      </div>
    </div>
  )
}
