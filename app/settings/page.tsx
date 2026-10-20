'use client'

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
  MessageCircle,
} from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { NumericInput } from '@/components/common/NumericInput'
import {
  TAB_CONTAINER_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'
import { DocumentNumberingPanel } from '@/features/settings/components/DocumentNumberingPanel'
import { LineSettingsPanel } from '@/features/settings/components/LineSettingsPanel'
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
  type SectionDrafts,
} from '@/features/settings/utils/section-drafts'
import { autoLockLabel, validateSection } from '@/features/settings/utils/settings-validation'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { CustomSelect } from '@/components/common/CustomSelect'

const TABS: Array<{ id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'business', label: 'กิจการ', icon: Building },
  { id: 'taxDiscount', label: 'ภาษีและส่วนลด', icon: Percent },
  { id: 'payment', label: 'รับชำระเงิน', icon: CreditCard },
  { id: 'salesRental', label: 'ขาย / เช่า / จอง', icon: CalendarDays },
  { id: 'product', label: 'สินค้า / สต็อก', icon: Package },
  { id: 'documentNumbering', label: 'เอกสาร', icon: FileText },
  { id: 'shopSecurity', label: 'ความปลอดภัยร้าน', icon: ShieldCheck },
  { id: 'line', label: 'LINE', icon: MessageCircle },
]

const MAX_IMAGE_BYTES = 500 * 1024

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 text-blue-600 rounded" />
      <span>
        <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">{label}</span>
        {hint && <span className={SETTINGS_HELPER}>{hint}</span>}
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
        {label} {required && <span className="text-red-500">*</span>}
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
function ImageField({ label, value, onChange, hint }: { label: string; value?: string; onChange: (v: string) => void; hint: string }) {
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
            className="h-8 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{value ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}</span>
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="h-8 px-3 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 font-bold text-xs flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>ลบรูป</span>
            </button>
          )}
        </div>
        <p className={SETTINGS_HELPER}>{hint}</p>
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
          hint="PNG, JPG, WebP ไม่เกิน 500 KB · บันทึกพร้อมข้อมูลกิจการ"
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
            <p className={SETTINGS_HELPER}>ใช้กับวันที่บนเอกสารและเลขเอกสาร (ยังแก้ไม่ได้)</p>
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
          <Percent className="w-3.5 h-3.5 text-blue-600" />
          <span>ภาษีมูลค่าเพิ่ม (VAT)</span>
        </h4>
        <p className={SETTINGS_HELPER}>
          เปิด/ปิด VAT เลือกที่หน้า POS ทีละบิล · ที่นี่ตั้งเฉพาะอัตราและวิธีคิดราคา · บิลจะเก็บค่าที่ใช้ไว้ตอนบันทึก
        </p>
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
          <div>
            <label className={SETTINGS_LABEL}>วิธีคิดราคา</label>
            <CustomSelect
              ariaLabel="วิธีคิดราคา"
              value={t.vatMode ?? ''}
              onChange={(value) => setT({ vatMode: (String(value) || null) as SystemConfig['taxDiscount']['vatMode'] })}
              options={[
                { value: '', label: 'ยังไม่ได้ตั้ง' },
                { value: 'EXCLUSIVE', label: 'ราคาไม่รวม VAT (บวก VAT เพิ่ม)' },
                { value: 'INCLUSIVE', label: 'ราคารวม VAT แล้ว' },
              ]}
            />
          </div>
        </div>
        <p className={SETTINGS_HELPER}>ใบเสนอราคาเลือกเปิด/ปิด VAT ทีละใบที่หน้า POS เหมือนบิล และใช้อัตรา/วิธีคิดราคาจากที่นี่</p>
      </div>
      <div className={SETTINGS_SECTION}>
        <h4 className={SETTINGS_SECTION_TITLE}>
          <Percent className="w-3.5 h-3.5 text-amber-600" />
          <span>เพดานส่วนลด</span>
        </h4>
        <Toggle
          checked={t.discountLimitEnabled}
          onChange={(v) => setT({ discountLimitEnabled: v, discountLimitPercent: v ? t.discountLimitPercent : null })}
          label="จำกัดส่วนลดสูงสุด"
          hint="ส่วนลดที่เกินเพดานต้องยืนยันด้วย PIN และระบุเหตุผล"
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
          <CreditCard className="w-3.5 h-3.5 text-blue-600" />
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
        <ImageField label="รูป QR รับเงิน" value={b.bankQrDataUrl} onChange={(v) => setB({ bankQrDataUrl: v })} hint="แสดงบนบิลเมื่อมียอดค้างชำระ · ไม่เกิน 500 KB" />
      </div>
      <div className={SETTINGS_SECTION}>
        <Toggle
          checked={cfg.payment.allowOverpayment}
          onChange={(v) => set((p) => ({ ...p, payment: { allowOverpayment: v } }))}
          label="รับเงินเกินยอดค้างได้"
          hint="ปิด = ระบบไม่รับเงินเกินยอดค้างของบิล · ช่องทางชำระเงินทุกแบบที่ระบบรองรับเปิดใช้เสมอ"
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
        hint="ปิด = ยืนยันบิลไม่ได้ถ้าสินค้าพร้อมใช้ไม่พอ"
      />
      <Toggle
        checked={s.reservationAutoRelease}
        onChange={(v) => setS({ reservationAutoRelease: v })}
        label="ปล่อยของที่จองไว้อัตโนมัติเมื่อหมดอายุ"
        hint="ปิด = การจองที่หมดอายุยังกันของไว้จนกว่าจะปล่อยเอง"
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
      <p className={SETTINGS_HELPER}>
        ใช้เป็นค่าเริ่มต้นตอนเพิ่มสินค้าใหม่ · สต็อกต่ำดูจากจุดสั่งซื้อของสินค้าแต่ละตัว · หมวดหมู่และหน่วยนับจัดการที่หน้า สินค้า/สต็อก
      </p>
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
        <Lock className="w-3.5 h-3.5 text-blue-600" />
        <span>ล็อกแอปอัตโนมัติ</span>
      </h4>
      <p className={SETTINGS_HELPER}>เลือกเวลาที่ผู้ใช้เลือกได้ แต่ละคนตั้งเวลาของตัวเองที่ ตั้งค่าส่วนตัว &rsaquo; ความปลอดภัย</p>
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
  const { settings, saveSection } = useSystemSettings()
  const [drafts, setDrafts] = useState<SectionDrafts>(() => initSectionDrafts(settings))
  const [activeTab, setActiveTab] = useState<SettingsSection>('business')
  const [saving, setSaving] = useState(false)

  // Server value changed (load after sign-in, tab refocus, another device): clean sections follow it.
  useEffect(() => {
    setDrafts((d) => applyServerUpdate(d, settings))
  }, [settings])

  if (user?.role !== 'OWNER') {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center text-xs text-slate-600 dark:text-slate-300">
        <div className="space-y-2">
          <Lock className="w-8 h-8 mx-auto text-slate-400" />
          <p className="font-bold">ตั้งค่าระบบเปิดได้เฉพาะเจ้าของร้าน</p>
          <p className={SETTINGS_HELPER}>ข้อมูลส่วนตัว รหัสผ่าน PIN การแจ้งเตือน และโหมดมืด ตั้งได้ที่ ตั้งค่าส่วนตัว</p>
        </div>
      </div>
    )
  }

  const section = drafts[activeTab]
  const dirty = isSectionDirty(section, activeTab)
  const setDraft: SetDraft = (action) =>
    setDrafts((d) => {
      const prev = d[activeTab].draft
      const next = typeof action === 'function' ? action(prev) : action
      return { ...d, [activeTab]: { ...d[activeTab], draft: next } }
    })

  const handleSave = async () => {
    const error = validateSection(activeTab, section.draft)
    if (error) {
      showToast('บันทึกไม่สำเร็จ', error, 'ERROR')
      return
    }
    setSaving(true)
    try {
      const saved = await saveSection(activeTab, section.draft)
      setDrafts((d) => applySectionSaved(d, activeTab, saved))
      showToast('บันทึกแล้ว', `บันทึก "${TABS.find((t) => t.id === activeTab)?.label}" เรียบร้อย`, 'SUCCESS')
    } catch (err: unknown) {
      showToast('บันทึกไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => setDrafts((d) => resetSection(d, activeTab, settings))

  const cfg = section.draft
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-900 text-xs p-2">
      <div className="flex-1 min-h-0 min-w-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-hidden flex flex-col">
        <div className="px-2 sm:px-2.5 py-1.5 sm:py-2 border-b border-slate-200 dark:border-slate-700 shrink-0 flex items-center overflow-x-auto no-scrollbar">
          <div className={TAB_CONTAINER_CLASSES}>
            {TABS.map((tab) => {
              const Icon = tab.icon
              const tabDirty = isSectionDirty(drafts[tab.id], tab.id)
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`${TAB_BUTTON_BASE_CLASSES} ${activeTab === tab.id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                >
                  <Icon className="w-4 h-4 shrink-0 hidden xl:block" />
                  <span>{tab.label}</span>
                  {tabDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-label="ยังไม่บันทึก" />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {section.conflict && (
            <div className="m-3 mb-0 p-2.5 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-amber-800 dark:text-amber-200 flex flex-wrap items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1 min-w-0">ค่าของหัวข้อนี้ถูกเปลี่ยนจากที่อื่นระหว่างที่คุณแก้ไข · ค่าที่คุณกรอกยังอยู่ กดบันทึกเพื่อใช้ค่าของคุณ หรือโหลดค่าล่าสุด</span>
              <button type="button" onClick={handleCancel} className="h-7 px-2.5 rounded-lg border border-amber-400 font-bold">
                โหลดค่าล่าสุด
              </button>
            </div>
          )}
          {activeTab === 'business' && <BusinessSection cfg={cfg} set={setDraft} />}
          {activeTab === 'taxDiscount' && <TaxDiscountSection cfg={cfg} set={setDraft} />}
          {activeTab === 'payment' && <PaymentSection cfg={cfg} set={setDraft} />}
          {activeTab === 'salesRental' && <SalesRentalSection cfg={cfg} set={setDraft} />}
          {activeTab === 'product' && <ProductSection cfg={cfg} set={setDraft} />}
          {activeTab === 'documentNumbering' && (
            <div className={SETTINGS_SECTION}>
              <DocumentNumberingPanel config={cfg} setConfig={setDraft} />
            </div>
          )}
          {activeTab === 'shopSecurity' && <ShopSecuritySection cfg={cfg} set={setDraft} />}
          {activeTab === 'line' && <LineSettingsPanel config={cfg} setConfig={setDraft} />}
        </div>

        <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 shrink-0">
          <span className={SETTINGS_HELPER}>{dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'บันทึกแยกทีละหัวข้อ'}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!dirty || saving}
              className="h-9 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4 text-slate-400" />
              <span>ยกเลิก</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
              className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
