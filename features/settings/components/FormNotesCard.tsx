'use client'
/**
 * Settings → ภาษีและเอกสาร → หมายเหตุ (owner 2026-11-12): pick a shop form at the top right, its 6 หมายเหตุ lines
 * show below; the pencil opens a line for typing. Saved wording is printed instead of the form's own lines.
 * ข้อมูลการบริการ (owner 2026-11-17): the form's "บริการให้เช่า :" / "การบริการ :" texts, edited the same way under
 * the notes and saved with them; printed on every bill made from that form.
 */
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { CustomSelect } from '@/components/common/CustomSelect'
import { SETTINGS_INPUT, SETTINGS_TABLE_BODY, SETTINGS_TABLE_FRAME } from '@/features/settings/components/settings-ui'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { SettingsCard } from '@/features/settings/components/SettingsCards'
import { getSharedTemplates } from '@/features/documents/services/template-library-storage'
import { FORM_SERVICE_LABELS, readFormNotes, readFormServices } from '@/features/documents/utils/form-notes'
import type { DocumentTemplate } from '@/lib/types/document'
import type { SystemConfig } from '@/features/settings/services/settings-storage'

type SetDraft = (action: SystemConfig | ((prev: SystemConfig) => SystemConfig)) => void
/** Row keys of the service texts (after the 6 note lines) */
const SERVICE_ROW = 100

export function FormNotesCard({ cfg, set, footer, conflict }: { cfg: SystemConfig; set: SetDraft; footer: React.ReactNode; conflict: React.ReactNode }) {
  const [forms, setForms] = useState<DocumentTemplate[] | null>(null)
  const [formId, setFormId] = useState('')
  /** The line open for typing: notes are 0…5, service texts SERVICE_ROW + 0…1 */
  const [editing, setEditing] = useState<number | null>(null)
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    let alive = true
    getSharedTemplates()
      .then((list) => {
        if (!alive) return
        setForms(list)
        setFormId((id) => id || list[0]?.id || '')
      })
      .catch(() => alive && setForms([]))
    return () => {
      alive = false
    }
  }, [])

  const form = forms?.find((f) => f.id === formId)
  const formLines = useMemo(() => (form ? readFormNotes(form.templateSchema) : readFormNotes('')), [form])
  const lines = cfg.documentNotes[formId] ?? formLines

  const setLine = (index: number, text: string) =>
    set((p) => {
      const next = [...(p.documentNotes[formId] ?? formLines)]
      next[index] = text
      return { ...p, documentNotes: { ...p.documentNotes, [formId]: next } }
    })

  const formServices = useMemo(() => readFormServices(form?.templateSchema ?? ''), [form])
  const services = cfg.documentServices?.[formId] ?? formServices
  const setService = (index: number, text: string) =>
    set((p) => {
      const next = [...(p.documentServices?.[formId] ?? formServices)]
      next[index] = text
      return { ...p, documentServices: { ...(p.documentServices ?? {}), [formId]: next } }
    })

  /** One row: number or name · the text (read-only until its pencil is pressed) · the pencil. */
  const row = (key: number, head: React.ReactNode, label: string, text: string, onText: (t: string) => void) => (
    <tr key={`${formId}-${key}`}>
      <td className="px-2 text-center font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">{head}</td>
      <td className="px-2">
        <input
          ref={(el) => {
            inputs.current[key] = el
          }}
          value={text}
          readOnly={editing !== key}
          disabled={!form}
          maxLength={300}
          aria-label={label}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
          className={`${SETTINGS_INPUT} ${editing === key ? '' : 'bg-[var(--ref-field)] dark:bg-slate-800 cursor-default'}`}
        />
      </td>
      <td className="px-2 text-center">
        <button
          type="button"
          disabled={!form}
          onClick={() => setEditing(editing === key ? null : key)}
          aria-label={`แก้ไข${label}`}
          aria-pressed={editing === key}
          className={`${COMMAND_BUTTON_SIZE_CLASSES} w-8 mx-auto shrink-0 flex items-center justify-center transition disabled:opacity-40 ${
            editing === key ? 'bg-[var(--ref-accent)] text-white' : 'text-slate-500 hover:bg-[var(--ref-field)] hover:text-[var(--ref-accent)]'
          }`}
        >
          <Pencil className="w-4 h-4" />
        </button>
      </td>
    </tr>
  )

  useEffect(() => {
    if (editing !== null) inputs.current[editing]?.focus()
  }, [editing])

  return (
    <SettingsCard
      title="หมายเหตุ"
      className="min-h-0"
      footer={footer}
      action={
        <div className="w-60 max-w-[55%] shrink-0">
          <CustomSelect
            value={formId}
            onChange={(id: string) => {
              setFormId(id)
              setEditing(null)
            }}
            options={(forms ?? []).map((f) => ({ value: f.id, label: f.name }))}
            placeholder={forms === null ? 'กำลังโหลด…' : 'ยังไม่มีแบบฟอร์ม'}
            disabled={!forms?.length}
            ariaLabel="เลือกเอกสาร"
            align="right"
          />
        </div>
      }
    >
      {conflict}
      <div className="py-2">
      <DataTableFrame className={SETTINGS_TABLE_FRAME} bodyClassName={SETTINGS_TABLE_BODY}>
      <table className={`${DATA_TABLE_CLASSES} text-xs`} aria-label="หมายเหตุ">
        <thead>
          <tr>
            <th className={`${DATA_TABLE_TH_CLASSES} px-2 w-12 text-center`}>ลำดับ</th>
            <th className={`${DATA_TABLE_TH_CLASSES} px-2`}>หมายเหตุ</th>
            <th className={`${DATA_TABLE_TH_CLASSES} px-2 w-14 text-center`}>แก้ไข</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {lines.map((text, i) => row(i, i + 1, `หมายเหตุข้อ ${i + 1}`, text, (t) => setLine(i, t)))}
        </tbody>
      </table>
      </DataTableFrame>
      </div>
      <div className="py-2">
      <DataTableFrame className={SETTINGS_TABLE_FRAME} bodyClassName={SETTINGS_TABLE_BODY}>
      <table className={`${DATA_TABLE_CLASSES} text-xs`} aria-label="ข้อมูลการบริการ">
        <thead>
          <tr>
            <th className={`${DATA_TABLE_TH_CLASSES} px-2 w-28 text-center`}>หัวข้อ</th>
            <th className={`${DATA_TABLE_TH_CLASSES} px-2`}>ข้อมูลการบริการ</th>
            <th className={`${DATA_TABLE_TH_CLASSES} px-2 w-14 text-center`}>แก้ไข</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {FORM_SERVICE_LABELS.map((label, i) => row(SERVICE_ROW + i, label, label, services[i] ?? '', (t) => setService(i, t)))}
        </tbody>
      </table>
      </DataTableFrame>
      </div>
    </SettingsCard>
  )
}
