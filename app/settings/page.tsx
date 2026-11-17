'use client'
import {
  COMMAND_BUTTON_SIZE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
  TAB_CONTAINER_CLASSES,
  TAB_BAR_SURFACE_CLASSES,
  TABLE_TOOLBAR_CLASSES,
} from '@/components/common/ActionButton'

import {
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_SECTION_FLAT,
  SETTINGS_SECTION_TITLE,
} from '@/features/settings/components/settings-ui'
import React, { Suspense, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  FileText,
  DatabaseBackup,
  Upload,
  Plus,
  Trash2,
  Image as ImageIcon,
  AlertTriangle,
  User, Bell, SlidersHorizontal,
  Users, Store, ReceiptText, Boxes, Wallet,
} from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { NumericInput } from '@/components/common/NumericInput'
import { DocumentNumberingPanel } from '@/features/settings/components/DocumentNumberingPanel'
import {
  activePaymentAccount,
  activeShopProfile,
  newPaymentAccount,
  newShopProfile,
  withActivePaymentAccount,
  withActiveShopProfile,
  type PaymentAccount,
  type ShopProfile,
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
import { validateSection } from '@/features/settings/utils/settings-validation'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { CustomSelect } from '@/components/common/CustomSelect'
import { formatPromptPayNumber, promptPayDigits, PROMPTPAY_TYPES } from '@/lib/promptpay'
import { THAI_BANKS } from '@/features/settings/utils/thai-banks'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { MyAccountPanel, type MyAccountTab } from '@/features/settings/components/MyAccountPanel'
import OwnerPermissionsPage from '@/app/owner-permissions/page'
import {
  REF_BUTTON_QUIET,
  CardSaveButtons,
  SettingsCard,
} from '@/features/settings/components/SettingsCards'
import { NotificationSettingsPanel } from '@/features/settings/components/NotificationSettingsPanel'
import { FormNotesCard } from '@/features/settings/components/FormNotesCard'
import { BackupPanel } from '@/features/settings/components/BackupPanel'
import { CustomerDocumentsWorkspace } from '@/features/documents/components/CustomerDocumentsWorkspace'
import { TemplateLibraryPanel } from '@/features/documents/components/TemplateLibraryPanel'

const PERSONAL_TABS: Array<{ id: MyAccountTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'PROFILE', label: 'โปรไฟล์ของฉัน', icon: User },
  { id: 'SETTINGS', label: 'การตั้งค่า', icon: SlidersHorizontal },
]

/**
 * ตั้งค่าระบบ = 8 categories in the menu bar on top (owner 2026-11-12; moved from the left bar to the top 2026-11-13). Each holds the
 * settings sections it saves (a card per section, each with its own save button).
 */
type SystemView = 'shop' | 'taxDocs' | 'members' | 'backup' | 'notices'
const SYSTEM_NAV: Array<{ id: SystemView; label: string; icon: React.ComponentType<{ className?: string }>; sections?: SettingsSection[] }> = [
  // สต็อกตอนเปิดบิล และการจอง moved into บัญชีการเงิน (owner 2026-11-14); the การขายและให้เช่า category is gone
  { id: 'shop', label: 'ข้อมูลร้าน', icon: Store, sections: ['business', 'payment', 'taxDiscount', 'salesRental'] },
  // เทมเพลต (owner 2026-11-14): document numbers / bill foot + the old จัดการเอกสาร menu, one row of 4 tabs, OWNER only
  { id: 'taxDocs', label: 'เทมเพลต', icon: FileText, sections: ['documentNumbering', 'documentNotes'] },
  { id: 'members', label: 'ผู้ใช้และสิทธิ์', icon: Users },
  // สำรองข้อมูล (owner 2026-11-15): pick dates + data, one JSON file; OWNER only
  { id: 'backup', label: 'สำรองข้อมูล', icon: DatabaseBackup },
  // Notices (owner 2026-11-15): LINE ones live in the LINE menu; this = the whole shop's in-app notices (which ones, how many
  // days ahead), the same for every member (personal notice settings removed, owner 2026-11-17)
  { id: 'notices', label: 'การแจ้งเตือนของร้าน', icon: Bell, sections: ['notifications'] },
]
type DocTab = 'setup' | 'create' | 'library' | 'add'
const DOC_TABS: Array<[DocTab, string]> = [
  ['setup', 'เลขที่เอกสาร / ท้ายบิล'],
  ['create', 'สร้างเอกสาร'],
  ['library', 'คลังแบบฟอร์ม'],
  ['add', 'เพิ่มแบบฟอร์ม'],
]
/** ?tab= of a link (a category or an old section id) → the category to open. */
function viewForTab(tab: string): SystemView | null {
  if (SYSTEM_NAV.some((item) => item.id === tab)) return tab as SystemView
  const holder = SYSTEM_NAV.find((item) => item.sections?.includes(tab as SettingsSection))
  return holder?.id ?? null
}

const MAX_IMAGE_BYTES = 500 * 1024

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

function SwitchKnob({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={`w-10 h-6 rounded-full p-0.5 flex shrink-0 transition ${checked ? 'bg-[var(--ref-accent)] justify-end' : 'bg-slate-300 dark:bg-slate-600 justify-start'}`}>
      <span className="w-5 h-5 rounded-full bg-white shadow" />
    </span>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ref-line)] bg-[var(--ref-field)] px-4 py-3 cursor-pointer">
      <span className="text-xs font-bold text-slate-900 dark:text-slate-200">{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <SwitchKnob checked={checked} />
    </label>
  )
}

/** One box, one line: name · percent field · switch (owner 2026-11-12). The field takes a value only while the switch is on. */
function PercentSwitch({ label, checked, onChange, value, onValue }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  value: number | null
  onValue: (v: number | null) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--ref-line)] bg-[var(--ref-field)] px-4 py-2">
      <span className="text-xs font-bold text-slate-900 dark:text-slate-200 shrink-0">{label}</span>
      <NumericInput
        value={value ?? ''}
        onChange={(v) => onValue(v === '' ? null : v)}
        min={0}
        max={100}
        allowDecimals
        disabled={!checked}
        aria-label={label}
        className={`${SETTINGS_INPUT} !w-24`}
      />
      <label className="ml-auto cursor-pointer">
        <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
        <SwitchKnob checked={checked} />
      </label>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  required,
  placeholder,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
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
        className={SETTINGS_INPUT}
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
    // Fills its grid column (owner 2026-11-13: QR as wide as column 1, the data in columns 2–3)
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 w-full min-h-[160px] rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center overflow-hidden">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={label} className="w-full h-full max-h-[240px] object-contain p-1" />
          ) : (
            <ImageIcon className="w-7 h-7 text-slate-300" />
          )}
        </div>
      </div>
      <div>
        <div className="flex flex-wrap gap-2">
          <input ref={ref} type="file" accept="image/png, image/jpeg, image/webp" className="hidden" onChange={pick} />
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className={REF_BUTTON_QUIET}
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

/**
 * Several sets of shop details, managed like บัญชีการเงิน (owner 2026-11-14): the dropdown shows and picks a set; the
 * one showing when the save button (bottom right) is pressed becomes the set in use. เพิ่ม clears the fields for a new
 * set and waits for that save.
 */
function BusinessSection({ cfg, saved, set }: { cfg: SystemConfig; saved: SystemConfig; set: SetDraft }) {
  const profiles = cfg.business.shopProfiles?.length ? cfg.business.shopProfiles : [activeShopProfile(cfg.business)]
  const b = activeShopProfile(cfg.business)
  const savedIds = new Set((saved.business.shopProfiles ?? []).map((p) => p.id))
  const adding = !savedIds.has(b.id)
  const setProfiles = (list: ShopProfile[], active: string) =>
    set((p) => ({ ...p, business: withActiveShopProfile({ ...p.business, shopProfiles: list, activeShopProfileId: active }) }))
  const setB = (patch: Partial<ShopProfile>) => setProfiles(profiles.map((p) => (p.id === b.id ? { ...p, ...patch } : p)), b.id)
  const addProfile = () => {
    const p = newShopProfile()
    setProfiles([...profiles, p], p.id)
  }
  const removeProfile = () => {
    const rest = profiles.filter((p) => p.id !== b.id)
    setProfiles(rest, rest[0].id)
  }
  return (
    // Logo = column 1, as wide as the QR on บัญชีการเงิน; the data in columns 2–3 (owner 2026-11-14)
    <div className="py-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
      <LogoField name={b.businessName} value={b.logoDataUrl} onChange={(v) => setB({ logoDataUrl: v })} />
      <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2 content-start">
        {/* First line: the shop's sets of details + เพิ่ม (same as บัญชีการเงิน) */}
        <div className="sm:col-span-2 flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label className={SETTINGS_LABEL}>ข้อมูลร้าน</label>
            <CustomSelect
              ariaLabel="ข้อมูลร้าน"
              disabled={adding}
              value={b.id}
              onChange={(value) => setProfiles(profiles, String(value))}
              options={profiles.map((p, i) => ({
                value: p.id,
                label: p.businessName.trim() || (savedIds.has(p.id) ? `ร้าน ${i + 1}` : 'ร้านใหม่'),
              }))}
            />
          </div>
          <button type="button" onClick={addProfile} disabled={adding} className={`${REF_BUTTON_QUIET} shrink-0`}>
            <Plus className="w-3.5 h-3.5" />
            <span>{adding ? 'รอบันทึก' : 'เพิ่ม'}</span>
          </button>
          {profiles.length > 1 && (
            <button
              type="button"
              onClick={removeProfile}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} px-3 shrink-0 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 flex items-center`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>ลบข้อมูลนี้</span>
            </button>
          )}
        </div>
        <div className="sm:col-span-2">
          <TextField label="ชื่อร้าน" required value={b.businessName} onChange={(v) => setB({ businessName: v })} />
        </div>
        <TextField label="เลขประจำตัวผู้เสียภาษี" maxLength={13} placeholder="0-0000-00000-00-0" value={b.taxId} onChange={(v) => setB({ taxId: v.replace(/\D/g, '') })} />
        <TextField label="เบอร์โทรร้าน" placeholder="055-000-000" value={b.phone} onChange={(v) => setB({ phone: v })} />
        <TextField label="อีเมลร้าน" placeholder="shop@example.com" value={b.email} onChange={(v) => setB({ email: v })} />
        <div>
          <label className={SETTINGS_LABEL}>เขตเวลา</label>
          <input value={cfg.timezone} readOnly disabled className={SETTINGS_INPUT} />
        </div>
        <TextField label="LINE ID" value={b.lineId} onChange={(v) => setB({ lineId: v })} />
        <TextField label="ผู้มีอำนาจลงนาม" value={b.authorizedPerson} onChange={(v) => setB({ authorizedPerson: v })} />
        <div className="sm:col-span-2">
          <label className={SETTINGS_LABEL}>ที่อยู่ร้าน</label>
          <textarea
            value={b.address}
            rows={3}
            placeholder="เลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"
            onChange={(e) => setB({ address: e.target.value })}
            className={`${SETTINGS_INPUT} h-auto py-2`}
          />
        </div>
      </div>
    </div>
  )
}

/** The logo box of ข้อมูลร้าน: the logo (or the shop's first letter) with the upload / remove buttons under it. */
function LogoField({ name, value, onChange }: { name: string; value?: string; onChange: (v: string) => void }) {
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
    // Fills its grid column as high as the fields beside it (like the QR box)
    <div className="flex flex-col gap-2.5 min-w-0">
      <div className="flex-1 w-full min-h-[160px] rounded-2xl border-2 border-dashed border-[var(--ref-line)] bg-[var(--ref-field)] flex flex-col items-center justify-center overflow-hidden">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="โลโก้ร้าน" className="w-full h-full max-h-[240px] object-contain p-2" />
        ) : (
          <>
            <span className="font-['Noto_Serif_Thai',serif] text-4xl text-slate-300">{(name || '?').trim().charAt(0)}</span>
            <span className="mt-6 text-[11px] text-slate-500 dark:text-slate-400">ยังไม่มีโลโก้</span>
          </>
        )}
      </div>
      {/* Same buttons as the QR box on บัญชีการเงิน (owner 2026-11-14) */}
      <div className="flex flex-wrap gap-2">
        <input ref={ref} type="file" accept="image/png, image/jpeg, image/webp" className="hidden" onChange={pick} />
        <button type="button" onClick={() => ref.current?.click()} className={REF_BUTTON_QUIET}>
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
  )
}

function TaxDiscountSection({ cfg, set }: { cfg: SystemConfig; set: SetDraft }) {
  const t = cfg.taxDiscount
  const setT = (patch: Partial<SystemConfig['taxDiscount']>) => set((p) => ({ ...p, taxDiscount: { ...p.taxDiscount, ...patch } }))
  return (
    <div className="space-y-2">
      <PercentSwitch
        label="อัตราภาษี (%)"
        checked={t.vatEnabled}
        onChange={(v) => setT({ vatEnabled: v, vatRate: v ? t.vatRate : null })}
        value={t.vatRate}
        onValue={(v) => setT({ vatRate: v })}
      />
      <PercentSwitch
        label="ส่วนลดสูงสุด (%)"
        checked={t.discountLimitEnabled}
        onChange={(v) => setT({ discountLimitEnabled: v, discountLimitPercent: v ? t.discountLimitPercent : null })}
        value={t.discountLimitPercent}
        onValue={(v) => setT({ discountLimitPercent: v })}
      />
    </div>
  )
}

/**
 * Several receiving accounts (owner 2026-11-13): the dropdown shows and picks the account; the one showing when the
 * save button (bottom right) is pressed becomes the account in use — payment windows, printed forms and each
 * transfer / QR payment's record take it. เพิ่ม clears the fields for a new account and waits for that save.
 */
function PaymentSection({ cfg, saved, set }: { cfg: SystemConfig; saved: SystemConfig; set: SetDraft }) {
  const accounts = cfg.business.paymentAccounts?.length ? cfg.business.paymentAccounts : [activePaymentAccount(cfg.business)]
  const b = activePaymentAccount(cfg.business)
  const savedIds = new Set((saved.business.paymentAccounts ?? []).map((a) => a.id))
  const adding = !savedIds.has(b.id)
  const setAccounts = (list: PaymentAccount[], active: string) =>
    set((p) => ({ ...p, business: withActivePaymentAccount({ ...p.business, paymentAccounts: list, activePaymentAccountId: active }) }))
  const setB = (patch: Partial<PaymentAccount>) => setAccounts(accounts.map((a) => (a.id === b.id ? { ...a, ...patch } : a)), b.id)
  const addAccount = () => {
    const acc = newPaymentAccount()
    setAccounts([...accounts, acc], acc.id)
  }
  const removeAccount = () => {
    const rest = accounts.filter((a) => a.id !== b.id)
    setAccounts(rest, rest[0].id)
  }
  return (
    <>
      <div className={SETTINGS_SECTION_FLAT}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <ImageField label="รูป QR รับเงิน" value={b.bankQrDataUrl} onChange={(v) => setB({ bankQrDataUrl: v })} />
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2 content-start">
          {/* First line: the shop's accounts + เพิ่ม (owner 2026-11-13) */}
          <div className="sm:col-span-2 flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <label className={SETTINGS_LABEL}>บัญชี</label>
              <CustomSelect
                ariaLabel="บัญชี"
                disabled={adding}
                value={b.id}
                onChange={(value) => setAccounts(accounts, String(value))}
                options={accounts.map((a, i) => ({
                  value: a.id,
                  label: [a.bankName, a.bankAccountNumber].filter(Boolean).join(' · ') || (savedIds.has(a.id) ? `บัญชี ${i + 1}` : 'บัญชีใหม่'),
                }))}
              />
            </div>
            <button type="button" onClick={addAccount} disabled={adding} className={`${REF_BUTTON_QUIET} shrink-0`}>
              <Plus className="w-3.5 h-3.5" />
              <span>{adding ? 'รอบันทึก' : 'เพิ่ม'}</span>
            </button>
            {accounts.length > 1 && (
              <button
                type="button"
                onClick={removeAccount}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} px-3 shrink-0 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 flex items-center`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>ลบบัญชีนี้</span>
              </button>
            )}
          </div>
          {/* ชื่อบัญชี on its own row, then ธนาคาร | เลขที่บัญชี, then PromptPay (owner 2026-11-14) */}
          <div className="sm:col-span-2">
            <TextField label="ชื่อบัญชี" value={b.bankAccountName} onChange={(v) => setB({ bankAccountName: v })} />
          </div>
          {/* A list of Thai banks, or type the shop's own (owner 2026-11-11) */}
          <div>
            <label className={SETTINGS_LABEL}>ธนาคาร</label>
            <CustomSelect
              ariaLabel="ธนาคาร"
              searchable
              allowCustom
              placeholder="-- เลือกหรือพิมพ์ชื่อธนาคาร --"
              value={b.bankName || ''}
              onChange={(value) => setB({ bankName: String(value).trim() })}
              options={THAI_BANKS.map((name) => ({ value: name, label: name }))}
            />
          </div>
          <TextField label="เลขที่บัญชี" value={b.bankAccountNumber} onChange={(v) => setB({ bankAccountNumber: v })} />
          <div>
            <label className={SETTINGS_LABEL}>ประเภท PromptPay</label>
            <CustomSelect
              ariaLabel="ประเภท PromptPay"
              value={b.promptPayType || ''}
              // A shorter kind keeps only as many digits as it has
              onChange={(value) => setB({ promptPayType: String(value), promptPayValue: (b.promptPayValue || '').slice(0, promptPayDigits(String(value))) })}
              options={[{ value: '', label: 'ไม่ระบุ' }, ...PROMPTPAY_TYPES.map((t) => ({ value: t.value, label: t.label }))]}
            />
          </div>
          {/* Shown with dashes (081-234-5678 / 1-2345-67890-12-3); only the digits are saved */}
          <TextField
            label="หมายเลข PromptPay"
            value={formatPromptPayNumber(b.promptPayValue, b.promptPayType || null)}
            onChange={(v) => setB({ promptPayValue: v.replace(/\D/g, '').slice(0, promptPayDigits(b.promptPayType || null)) })}
          />
          </div>
        </div>
      </div>
    </>
  )
}

function SalesRentalSection({ cfg, set }: { cfg: SystemConfig; set: SetDraft }) {
  const s = cfg.salesRental
  const setS = (patch: Partial<SystemConfig['salesRental']>) => set((p) => ({ ...p, salesRental: { ...p.salesRental, ...patch } }))
  return (
    <div className="space-y-2">
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

/**
 * view= comes from the sidebar (ตั้งค่า › ตั้งค่าส่วนตัว / ตั้งค่าระบบ), read inside Suspense as Next requires. */
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageContent />
    </Suspense>
  )
}

function SettingsPageContent() {
  const { showToast } = useToast()
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const { settings, saveSection } = useSystemSettings()
  const [drafts, setDrafts] = useState<SectionDrafts>(() => initSectionDrafts(settings))
  const [systemView, setSystemView] = useState<SystemView>('shop')
  // ตั้งค่าส่วนตัว / ตั้งค่าระบบ = sub menus of ตั้งค่า in the sidebar (owner 2026-11-13, like แดชบอร์ด); a ?tab= link opens ตั้งค่าระบบ
  const searchParams = useSearchParams()
  const viewParam = searchParams?.get('view') ?? null
  const tabParam = searchParams?.get('tab') ?? null
  // ตั้งค่าระบบ is the OWNER's only: anyone else stays on ตั้งค่าส่วนตัว
  const mainTab: 'personal' | 'system' =
    isOwner && (viewParam === 'system' || (!viewParam && tabParam && viewForTab(tabParam))) ? 'system' : 'personal'
  const [personalTab, setPersonalTab] = useState<MyAccountTab>('PROFILE')
  // ข้อมูลร้าน category: one card at a time under a tab bar (owner 2026-11-13)
  const [shopTab, setShopTab] = useState<'business' | 'payment'>('business')
  // เทมเพลต category: 4 tabs; the document workspaces load on first open and then stay mounted (work in progress kept)
  const [docTab, setDocTab] = useState<DocTab>('setup')
  const [docsOpened, setDocsOpened] = useState(false)
  const openDocTab = (id: DocTab) => { setDocTab(id); if (id !== 'setup') setDocsOpened(true) }
  const [savingSection, setSavingSection] = useState<SettingsSection | null>(null)

  // ?tab= from links (old section ids still work): opens the category that holds it.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab')
    const view = wanted ? viewForTab(wanted) : null
    if (!view || !isOwner) return
    setSystemView(view)
    if (wanted === 'payment' || wanted === 'taxDiscount' || wanted === 'salesRental') setShopTab('payment')
  }, [isOwner])

  useEffect(() => { setDrafts((d) => applyServerUpdate(d, settings)) }, [settings])

  // Unsaved edits in any section: ask before the page is left (they would be lost).
  useLeaveGuard(SETTINGS_SECTIONS.some((s) => isSectionDirty(drafts[s], s)))

  /** What one card needs to edit and save its own settings section. */
  const card = (id: SettingsSection, saveLabel: string) => {
    const set: SetDraft = (action) => setDrafts((d) => {
      const prev = d[id].draft
      const next = typeof action === 'function' ? action(prev) : action
      return { ...d, [id]: { ...d[id], draft: next } }
    })
    const save = async (): Promise<boolean> => {
      const error = validateSection(id, drafts[id].draft)
      if (error) { showToast('บันทึกไม่สำเร็จ', error, 'ERROR'); return false }
      setSavingSection(id)
      try {
        const saved = await saveSection(id, drafts[id].draft)
        setDrafts((d) => applySectionSaved(d, id, saved))
        showToast('บันทึกแล้ว', `${saveLabel.replace(/^บันทึก/, '')} เรียบร้อย`, 'SUCCESS')
        return true
      } catch (err: unknown) {
        showToast('บันทึกไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด', 'ERROR')
        return false
      } finally { setSavingSection(null) }
    }
    const cancel = () => setDrafts((d) => resetSection(d, id, settings))
    const dirty = isSectionDirty(drafts[id], id)
    return {
      cfg: drafts[id].draft,
      saved: drafts[id].base,
      set,
      save,
      cancel,
      dirty,
      conflict: drafts[id].conflict ? (
        <div className="mx-4 mt-3 p-2.5 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-amber-800 dark:text-amber-200 flex flex-wrap items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0"/><span className="flex-1 min-w-0">ค่าของหัวข้อนี้ถูกเปลี่ยนจากที่อื่นระหว่างที่คุณแก้ไข · ค่าที่คุณกรอกยังอยู่</span><button type="button" onClick={cancel} className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-amber-400`}>โหลดค่าล่าสุด</button></div>
      ) : null,
      footer: <CardSaveButtons label={saveLabel} dirty={dirty} saving={savingSection === id} onSave={() => void save()} onCancel={cancel} />,
    }
  }

  const business = card('business', 'บันทึกข้อมูลร้าน')
  const payment = card('payment', 'บันทึกบัญชีรับเงิน')
  const tax = card('taxDiscount', 'บันทึกภาษี')
  const numbering = card('documentNumbering', 'บันทึกเลขเอกสาร')
  const notes = card('documentNotes', 'บันทึกหมายเหตุ')
  const sales = card('salesRental', 'บันทึกการขายและให้เช่า')
  const notices = card('notifications', 'บันทึกการแจ้งเตือน')

  const systemContent = () => {
    switch (systemView) {
      case 'shop':
        return (
          <div className="min-h-full flex flex-col gap-2">
            <div className={`-mx-2 -mt-2 flex ${TABLE_TOOLBAR_CLASSES}`}>
              <div className={TAB_CONTAINER_CLASSES} role="tablist" aria-label="ข้อมูลร้าน">
                {([['business', 'ข้อมูลร้าน'], ['payment', 'บัญชีการเงิน']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={shopTab === id}
                    onClick={() => setShopTab(id)}
                    className={`${TAB_BUTTON_BASE_CLASSES} ${shopTab === id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                  >
                    {label}
                    {(isSectionDirty(drafts[id], id) || (id === 'payment' && (isSectionDirty(drafts.taxDiscount, 'taxDiscount') || isSectionDirty(drafts.salesRental, 'salesRental')))) && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                  </button>
                ))}
              </div>
            </div>
            {shopTab === 'business' ? (
              <SettingsCard className="flex-1" footer={business.footer}>{business.conflict}<BusinessSection cfg={business.cfg} saved={business.saved} set={business.set} /></SettingsCard>
            ) : (
              // Accounts + VAT + stock-at-bill on one page with ONE pair of buttons (owner 2026-11-13/14): saves whichever part changed
              <SettingsCard
                className="flex-1"
                footer={
                  <CardSaveButtons
                    label="บันทึกบัญชีการเงิน"
                    dirty={payment.dirty || tax.dirty || sales.dirty}
                    saving={savingSection === 'payment' || savingSection === 'taxDiscount' || savingSection === 'salesRental'}
                    onSave={() => void (async () => {
                      if (payment.dirty && !(await payment.save())) return
                      if (tax.dirty && !(await tax.save())) return
                      if (sales.dirty) await sales.save()
                    })()}
                    onCancel={() => { payment.cancel(); tax.cancel(); sales.cancel() }}
                  />
                }
              >
                {payment.conflict}
                {tax.conflict}
                {sales.conflict}
                <PaymentSection cfg={payment.cfg} saved={payment.saved} set={payment.set} />
                {/* Switches in 3 columns, each a heading with its buttons under it, so the page does not scroll (owner 2026-11-14) */}
                <div className="py-2 grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                  <div className="min-w-0 space-y-2">
                    <h4 className={SETTINGS_SECTION_TITLE}>
                      <ReceiptText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>ภาษีมูลค่าเพิ่ม</span>
                    </h4>
                    <TaxDiscountSection cfg={tax.cfg} set={tax.set} />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <h4 className={SETTINGS_SECTION_TITLE}>
                      <Boxes className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>สต็อกตอนเปิดบิล และการจอง</span>
                    </h4>
                    <SalesRentalSection cfg={sales.cfg} set={sales.set} />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <h4 className={SETTINGS_SECTION_TITLE}>
                      <Wallet className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>การรับเงิน</span>
                    </h4>
                    <Toggle
                      checked={payment.cfg.payment.allowOverpayment}
                      onChange={(v) => payment.set((p) => ({ ...p, payment: { allowOverpayment: v } }))}
                      label="รับเงินเกินยอดค้างได้"
                    />
                  </div>
                </div>
              </SettingsCard>
            )}
          </div>
        )
      case 'backup':
        return <BackupPanel />
      case 'notices':
        return (
          <SettingsCard footer={notices.footer}>
            {notices.conflict}
            <div className="py-2">
              <NotificationSettingsPanel value={notices.cfg.notifications} onChange={(n) => notices.set((c) => ({ ...c, notifications: n }))} />
            </div>
          </SettingsCard>
        )
      default:
        return null
    }
  }

  return (
    <div className="settings-ref h-full min-h-0 flex flex-col gap-2 overflow-hidden bg-slate-100 dark:bg-black text-xs p-2">
      <div className="flex-1 min-h-0 min-w-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="h-full min-h-0 flex flex-col">
          {/* The categories: one row in the shared toolbar row (as the customers menu) */}
          <div className={TABLE_TOOLBAR_CLASSES}>
            <nav
              className={`${TAB_BAR_SURFACE_CLASSES} flex items-center w-full min-w-0`} aria-label={mainTab === 'personal' ? 'ตั้งค่าส่วนตัว' : 'ตั้งค่าระบบ'}>
              {mainTab === 'personal'
                ? PERSONAL_TABS.map((item) => (
                    <NavButton key={item.id} item={item} selected={personalTab === item.id} dirty={false} onClick={() => setPersonalTab(item.id)} />
                  ))
                : SYSTEM_NAV.map((item) => (
                    <NavButton
                      key={item.id}
                      item={item}
                      selected={systemView === item.id}
                      dirty={(item.sections ?? []).some((s) => isSectionDirty(drafts[s], s))}
                      onClick={() => setSystemView(item.id)}
                    />
                  ))}
            </nav>
          </div>

          <section className="flex-1 min-w-0 min-h-0 flex flex-col">
            {mainTab === 'personal' ? (
              <div className="flex-1 min-h-0"><MyAccountPanel key={personalTab} initialTab={personalTab} embedded /></div>
            ) : systemView === 'members' ? (
              <div className="flex-1 min-h-0 overflow-hidden"><OwnerPermissionsPage /></div>
            ) : systemView === 'taxDocs' ? (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className={`flex ${TABLE_TOOLBAR_CLASSES}`}>
                  <div className={TAB_CONTAINER_CLASSES} role="tablist" aria-label="เทมเพลต">
                    {DOC_TABS.map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={docTab === id}
                        onClick={() => openDocTab(id)}
                        className={`${TAB_BUTTON_BASE_CLASSES} ${docTab === id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                      >
                        {label}
                        {id === 'setup' && (numbering.dirty || notes.dirty) && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                      </button>
                    ))}
                  </div>
                </div>
                {docTab === 'setup' && (
                  // Left = documents, right = what prints at the foot of a bill (owner 2026-11-13); halves stack on narrow screens
                  // The page itself does not scroll on wide screens (owner 2026-11-14): the documents table fills its half
                  <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden p-2 grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-1 gap-4">
                    <SettingsCard
                      className="min-h-0"
                      bodyClassName="min-h-0 flex flex-col"
                      title="รูปแบบเลขที่เอกสาร"
                      action={<div className="flex flex-wrap justify-end gap-2">{numbering.footer}</div>}
                    >
                      {numbering.conflict}
                      <div className="flex-1 min-h-0 flex flex-col py-2"><DocumentNumberingPanel config={numbering.cfg} setConfig={numbering.set} /></div>
                    </SettingsCard>
                    <FormNotesCard cfg={notes.cfg} set={notes.set} footer={notes.footer} conflict={notes.conflict} />
                  </div>
                )}
                {docsOpened && (
                  <>
                    <div hidden={docTab !== 'create'} className={docTab === 'create' ? 'flex-1 min-h-0 flex flex-col p-2' : undefined}>
                      <CustomerDocumentsWorkspace business={settings.business} />
                    </div>
                    <div hidden={docTab !== 'library' && docTab !== 'add'} className={docTab === 'library' || docTab === 'add' ? 'flex-1 min-h-0 flex flex-col p-2' : undefined}>
                      <TemplateLibraryPanel
                        mode={docTab === 'add' ? 'ADD' : 'LIBRARY'}
                        onModeChange={(m) => openDocTab(m === 'ADD' ? 'add' : 'library')}
                        business={settings.business}
                      />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-4">
                {systemContent()}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function NavButton({
  item,
  selected,
  dirty,
  onClick,
}: {
  item: { id: string; label: string; icon: React.ComponentType<{ className?: string }> }
  selected: boolean
  dirty: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button type="button" onClick={onClick} aria-current={selected ? 'page' : undefined} title={item.label} className={`flex-auto min-w-0 ${TAB_BUTTON_BASE_CLASSES} ${selected ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}>
      {/* one row (owner 2026-11-13: the bar was too tall): icons only on wide screens, names cut with … if still too long */}
      <Icon className="w-3.5 h-3.5 shrink-0 hidden 2xl:block" />
      <span className="truncate min-w-0">{item.label}</span>
      {dirty && <span className="w-2 h-2 rounded-full bg-amber-400" />}
    </button>
  )
}
