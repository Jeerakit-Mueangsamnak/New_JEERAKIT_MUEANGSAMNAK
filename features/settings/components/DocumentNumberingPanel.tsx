'use client'

import { SETTINGS_INPUT_MONO, SETTINGS_TABLE_BODY, SETTINGS_TABLE_FRAME } from '@/features/settings/components/settings-ui'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import React, { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import {
  DOCUMENT_TYPES,
  DOC_DIGITS_MAX,
  DOC_DIGITS_MIN,
  type DocumentType,
  type SystemConfig,
} from '@/features/settings/services/settings-storage'
import { previewDocumentNumber } from '@/features/settings/api/settings-repository'
import { CustomSelect } from '@/components/common/CustomSelect'

interface DocumentNumberingPanelProps {
  config: SystemConfig
  setConfig: Dispatch<SetStateAction<SystemConfig>>
}

const DIGIT_CHOICES = Array.from({ length: DOC_DIGITS_MAX - DOC_DIGITS_MIN + 1 }, (_, i) => DOC_DIGITS_MIN + i)

/** The next number the server would give — built by the server's own formatter. */
function ServerPreview({ type, prefix, digits }: { type: DocumentType; prefix: string; digits: number }) {
  const [text, setText] = useState<string>('…')
  useEffect(() => {
    let active = true
    const t = setTimeout(() => {
      previewDocumentNumber(type, prefix, digits)
        .then((v) => active && setText(v))
        .catch(() => active && setText('ดูตัวอย่างไม่ได้'))
    }, 300)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [type, prefix, digits])
  return <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200">{text}</span>
}

/** PREFIX-DDMMBBBB-RUNNING: date in the shop's timezone (Buddhist year), running number restarts every day. */
export function DocumentNumberingPanel({ config, setConfig }: DocumentNumberingPanelProps) {
  const update = (type: DocumentType, patch: Partial<{ prefix: string; digits: number }>) =>
    setConfig((prev) => ({
      ...prev,
      documentNumbering: { ...prev.documentNumbering, [type]: { ...prev.documentNumbering[type], ...patch } },
    }))

  return (
      <DataTableFrame fill className={`${SETTINGS_TABLE_FRAME} flex-1`} bodyClassName={SETTINGS_TABLE_BODY}>
        <table className={`${DATA_TABLE_CLASSES} text-xs`} aria-label="รูปแบบเลขเอกสาร">
          <thead>
            <tr>
              <th className={`${DATA_TABLE_TH_CLASSES} px-2 w-12 text-center`}>ลำดับ</th>
              <th className={`${DATA_TABLE_TH_CLASSES} px-2`}>เอกสาร</th>
              <th className={`${DATA_TABLE_TH_CLASSES} px-2 w-32`}>ตัวย่อชือเอกสาร</th>
              <th className={`${DATA_TABLE_TH_CLASSES} px-2 w-28`}>จำนวนหลักลำดับ</th>
              <th className={`${DATA_TABLE_TH_CLASSES} px-2`}>เลขถัดไป (จากเซิร์ฟเวอร์)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {DOCUMENT_TYPES.map(({ type, label }, index) => {
              const f = config.documentNumbering[type]
              return (
                <tr key={type}>
                  <td className="px-2 text-center font-semibold text-slate-700 dark:text-slate-300">{index + 1}</td>
                  <td className="px-2 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{label}</td>
                  <td className="px-2">
                    <input
                      aria-label={`Prefix ${label}`}
                      value={f.prefix}
                      maxLength={10}
                      onChange={(e) => update(type, { prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                      className={SETTINGS_INPUT_MONO}
                    />
                  </td>
                  <td className="px-2">
                    <CustomSelect
                      ariaLabel={`จำนวนหลัก ${label}`}
                      value={f.digits}
                      onChange={(value) => update(type, { digits: Number(value) })}
                      options={DIGIT_CHOICES.map((n) => ({ value: n, label: String(n) }))}
                      buttonClassName="h-[30px] px-2.5 py-0 rounded-lg"
                    />
                  </td>
                  <td className="px-2">{f.prefix ? <ServerPreview type={type} prefix={f.prefix} digits={f.digits} /> : <span className="text-red-700 dark:text-red-400 text-[11px]">ต้องมี Prefix</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
  )
}
