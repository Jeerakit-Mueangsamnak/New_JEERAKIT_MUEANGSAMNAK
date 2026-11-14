'use client'
/**
 * Settings → ภาษีและเอกสาร → หมายเหตุ (owner 2026-11-12): pick a shop form at the top right, its 6 หมายเหตุ lines
 * show below; the pencil opens a line for typing. Saved wording is printed instead of the form's own lines.
 */
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { CustomSelect } from '@/components/common/CustomSelect'
import { SETTINGS_INPUT, SETTINGS_TABLE_BODY, SETTINGS_TABLE_FRAME } from '@/features/settings/components/settings-ui'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { SettingsCard } from '@/features/settings/components/SettingsCards'
import { getSharedTemplates } from '@/features/documents/services/template-library-storage'
import { readFormNotes } from '@/features/documents/utils/form-notes'
import type { DocumentTemplate } from '@/lib/types/document'
import type { SystemConfig } from '@/features/settings/services/settings-storage'

type SetDraft = (action: SystemConfig | ((prev: SystemConfig) => SystemConfig)) => void

export function FormNotesCard({ cfg, set, footer, conflict }: { cfg: SystemConfig; set: SetDraft; footer: React.ReactNode; conflict: React.ReactNode }) {
  const [forms, setForms] = useState<DocumentTemplate[] | null>(null)
  const [formId, setFormId] = useState('')
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
        {lines.map((text, i) => (
          <tr key={`${formId}-${i}`}>
            <td className="px-2 text-center font-semibold text-slate-700 dark:text-slate-300">{i + 1}</td>
            <td className="px-2">
            <input
              ref={(el) => {
                inputs.current[i] = el
              }}
              value={text}
              readOnly={editing !== i}
              disabled={!form}
              maxLength={300}
              aria-label={`หมายเหตุข้อ ${i + 1}`}
              onChange={(e) => setLine(i, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
              className={`${SETTINGS_INPUT} ${editing === i ? '' : 'bg-[var(--ref-field)] dark:bg-slate-800 cursor-default'}`}
            />
            </td>
            <td className="px-2 text-center">
            <button
              type="button"
              disabled={!form}
              onClick={() => setEditing(editing === i ? null : i)}
              aria-label={`แก้ไขหมายเหตุข้อ ${i + 1}`}
              aria-pressed={editing === i}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} w-8 mx-auto shrink-0 flex items-center justify-center transition disabled:opacity-40 ${
                editing === i ? 'bg-[var(--ref-accent)] text-white' : 'text-slate-500 hover:bg-[var(--ref-field)] hover:text-[var(--ref-accent)]'
              }`}
            >
              <Pencil className="w-4 h-4" />
            </button>
            </td>
          </tr>
        ))}
        </tbody>
      </table>
      </DataTableFrame>
      </div>
    </SettingsCard>
  )
}
