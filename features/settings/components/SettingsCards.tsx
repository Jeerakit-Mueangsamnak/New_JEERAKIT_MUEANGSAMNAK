'use client'
/**
 * Settings laid out as cards (owner 2026-11-12, from the shop's reference screens): each card has a title and its
 * own save button. A card marked "ยังไม่เปิดใช้" is screen only for now (owner: "เบื้องต้นทำทุกอย่างเป็น UI ก่อน"):
 * its fields cannot be changed and nothing is saved, so no one thinks a value is in use when it is not.
 */
import React from 'react'
import { COMMAND_BUTTON_SIZE_CLASSES, TABLE_LINE_COLOUR_CLASSES } from '@/components/common/ActionButton'
import { Save, RotateCcw } from 'lucide-react'
import { SETTINGS_INPUT, SETTINGS_INPUT_MONO, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'

/** Brown buttons of the page (accent from .settings-ref in globals.css). */
/**
 * Settings buttons = the shared command size and the system colours (owner 2026-11-13): save = emerald-700 like the
 * other menus' save buttons; the second button = their cancel button (grey line, white).
 */
export const REF_BUTTON = `${COMMAND_BUTTON_SIZE_CLASSES} px-3 text-white bg-emerald-700 hover:bg-emerald-800 shadow-md shadow-emerald-600/20 disabled:opacity-45 disabled:hover:bg-emerald-700 disabled:shadow-none flex items-center`
export const REF_BUTTON_QUIET = `${COMMAND_BUTTON_SIZE_CLASSES} px-3 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 flex items-center`

export function SettingsCard({
  title,
  icon: Icon,
  preview,
  action,
  footer,
  className = '',
  bodyClassName = '',
  children,
}: {
  /** No title = no title row (owner 2026-11-13: the tab already names it) */
  title?: string
  icon?: React.ComponentType<{ className?: string }>
  /** Screen only, not saved yet */
  preview?: boolean
  action?: React.ReactNode
  footer?: React.ReactNode
  /** Extra layout classes, e.g. flex-1 to fill the work area */
  className?: string
  /** Extra classes for the content area, e.g. a flex column so a table fills the card */
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section className={`text-xs flex flex-col ${className}`.trim()}>
      {/* Same as the customers menu (owner 2026-11-13): title row with a line under it, no box around */}
      {title ? (
        <header className={`pb-1.5 border-b ${TABLE_LINE_COLOUR_CLASSES} flex items-center justify-between gap-2`}>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              {Icon && <Icon className="w-4 h-4 text-[var(--ref-accent)] dark:text-blue-400 shrink-0" />}
              <span>{title}</span>
              {preview && (
                <span className="font-sans shrink-0 rounded-full bg-[var(--ref-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--ref-accent)] dark:text-blue-300">
                  ยังไม่เปิดใช้
                </span>
              )}
            </h3>
          </div>
          {action}
        </header>
      ) : null}
      {/* the content takes the free height, so the save buttons sit at the bottom of a section that fills the work area */}
      <div className={`flex-1 ${bodyClassName} ${preview ? 'opacity-60 pointer-events-none select-none' : ''}`.trim()} aria-disabled={preview || undefined}>
        {children}
      </div>
      {footer && <footer className={`pt-2 border-t ${TABLE_LINE_COLOUR_CLASSES} flex justify-end gap-2`}>{footer}</footer>}
    </section>
  )
}

/** Save / undo for a card that saves one settings section. */
export function CardSaveButtons({
  label,
  dirty,
  saving,
  onSave,
  onCancel,
}: {
  label: string
  dirty: boolean
  saving: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={onCancel}
        disabled={!dirty || saving}
        className={REF_BUTTON_QUIET}
      >
        <RotateCcw className="w-4 h-4" />
        <span>คืนค่าที่บันทึกไว้</span>
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className={REF_BUTTON}
      >
        <Save className="w-4 h-4" />
        <span>{saving ? 'กำลังบันทึก…' : label}</span>
      </button>
    </>
  )
}

/** The save button of a card that is screen only: always off. */
function PreviewSave({ label }: { label: string }) {
  return (
    <button type="button" disabled className={REF_BUTTON}>
      <span>{label}</span>
    </button>
  )
}

function Field({ label, value, unit, mono = true }: { label: string; value: string; unit?: string; mono?: boolean }) {
  return (
    <div>
      <label className={SETTINGS_LABEL}>{label}</label>
      <div className="relative">
        <input value={value} readOnly disabled className={`${mono ? SETTINGS_INPUT_MONO : SETTINGS_INPUT} ${unit ? 'pr-12' : ''}`} />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-500">{unit}</span>}
      </div>
    </div>
  )
}

function Switch({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ref-line)] bg-[var(--ref-field)] px-4 py-3">
      <span className="text-xs font-bold text-slate-900 dark:text-slate-200">{label}</span>
      <span className={`w-10 h-6 rounded-full p-0.5 flex ${on ? 'bg-[var(--ref-accent)] justify-end' : 'bg-slate-300 dark:bg-slate-600 justify-start'}`}>
        <span className="w-5 h-5 rounded-full bg-white shadow" />
      </span>
    </div>
  )
}

function Check({ label, on }: { label: string; on: boolean }) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-[var(--ref-line)] bg-[var(--ref-field)] px-4 py-3 text-xs font-bold text-slate-900 dark:text-slate-200">
      <input type="checkbox" checked={on} readOnly disabled className="w-4 h-4 rounded" />
      {label}
    </label>
  )
}

const grid = 'py-2 grid grid-cols-1 sm:grid-cols-2 gap-2'

// ── ภาษีและเอกสาร ────────────────────────────────────────────────────────────

// ── LINE และการแจ้งเตือน ────────────────────────────────────────────────────

const NOTICE_TOPICS = ['บิลเกินกำหนดคืน', 'นัดรับคืนวันนี้', 'สินค้าใกล้หมด', 'นัดส่ง / นัดรับของ', 'การชำระเงินและมัดจำ', 'ของเสีย / ของหาย']

export function ShopNoticeTypesPreview() {
  return (
    <SettingsCard title="ประเภทการแจ้งเตือน และผู้รับ" preview footer={<PreviewSave label="บันทึกการแจ้งเตือน" />}>
      <div className="p-4 space-y-2">
        {NOTICE_TOPICS.map((topic) => (
          <Switch key={topic} label={`แจ้งเตือน: ${topic}`} on />
        ))}
        <p className={`${SETTINGS_LABEL} pt-2`}>ผู้รับแจ้งเตือนของร้าน</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Check label="เจ้าของร้าน" on />
          <Check label="พนักงาน" on />
          <Check label="คนขับ / ผู้จัดส่ง" on={false} />
        </div>
      </div>
    </SettingsCard>
  )
}

// ── การแจ้งเตือนส่วนบุคคล ───────────────────────────────────────────────────

export function QuietHoursPreview() {
  return (
    <SettingsCard title="เวลางดแจ้งเตือน และสรุปรายวัน" preview footer={<PreviewSave label="บันทึกของฉัน" />}>
      <div className={grid}>
        <Field label="เริ่มเวลางดแจ้งเตือน" value="21:00" />
        <Field label="สิ้นสุดเวลางดแจ้งเตือน" value="07:00" />
        <div className="sm:col-span-2">
          <Switch label="สรุปแจ้งเตือนวันละครั้ง (daily digest)" on={false} />
        </div>
      </div>
    </SettingsCard>
  )
}
