'use client'

import { SETTINGS_HELPER, SETTINGS_INPUT_MONO, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import React, { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { Hash } from 'lucide-react'
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
    <div className="space-y-2.5">
      <h4 className={SETTINGS_SECTION_TITLE}>
        <Hash className="w-3.5 h-3.5 text-blue-600" />
        <span>รูปแบบเลขเอกสาร</span>
      </h4>
      <p className={SETTINGS_HELPER}>
        รูปแบบ PREFIX-วันเดือนปี พ.ศ.-ลำดับ เช่น ABC-07102569-001 · ลำดับเริ่มใหม่ทุกวันตามเวลาของร้าน ({config.timezone}) · เลขที่ออกแล้วไม่ถูกใช้ซ้ำ
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[11px] text-slate-500 dark:text-slate-400">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="text-left font-semibold py-1.5 pr-2">เอกสาร</th>
              <th className="text-left font-semibold py-1.5 pr-2 w-32">Prefix</th>
              <th className="text-left font-semibold py-1.5 pr-2 w-24">จำนวนหลักลำดับ</th>
              <th className="text-left font-semibold py-1.5">เลขถัดไป (จากเซิร์ฟเวอร์)</th>
            </tr>
          </thead>
          <tbody>
            {DOCUMENT_TYPES.map(({ type, label }) => {
              const f = config.documentNumbering[type]
              return (
                <tr key={type} className="border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                  <td className="py-1.5 pr-2 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{label}</td>
                  <td className="py-1.5 pr-2">
                    <input
                      aria-label={`Prefix ${label}`}
                      value={f.prefix}
                      maxLength={10}
                      onChange={(e) => update(type, { prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                      className={`${SETTINGS_INPUT_MONO} h-8`}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <CustomSelect
                      ariaLabel={`จำนวนหลัก ${label}`}
                      value={f.digits}
                      onChange={(value) => update(type, { digits: Number(value) })}
                      buttonClassName="h-8 px-2.5 py-0 rounded-xl font-mono"
                      options={DIGIT_CHOICES.map((n) => ({ value: n, label: String(n) }))}
                    />
                  </td>
                  <td className="py-1.5">{f.prefix ? <ServerPreview type={type} prefix={f.prefix} digits={f.digits} /> : <span className="text-red-600 text-[11px]">ต้องมี Prefix</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
