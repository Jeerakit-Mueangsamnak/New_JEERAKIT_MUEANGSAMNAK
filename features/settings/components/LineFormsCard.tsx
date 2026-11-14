'use client'
import React from 'react'
import { Copy } from 'lucide-react'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'
import { useToast } from '@/components/common/Toast'
import { liffUrl } from '@/lib/line/liff-links'
import { SettingsCard } from './SettingsCards'
import { SETTINGS_INPUT_MONO, SETTINGS_LABEL } from './settings-ui'

/**
 * ฟอร์มใน LINE (owner 2026-11-13): the OWNER copies the income / expense form link into their own
 * LINE (e.g. Keep or a pinned chat). The form works only for the OWNER's linked LINE.
 */
export function LineFormsCard() {
  const { showToast } = useToast()
  const finance = liffUrl('finance')
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      showToast('คัดลอกแล้ว', 'ลิงก์ฟอร์มรายรับรายจ่าย', 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }
  return (
    <SettingsCard title="ฟอร์มใน LINE">
      <div className="py-2 space-y-1.5">
        <label className={SETTINGS_LABEL} htmlFor="line-form-finance">ฟอร์มรายรับรายจ่าย (เจ้าของร้าน)</label>
        <div className="flex gap-2">
          <input id="line-form-finance" readOnly value={finance ?? 'ยังไม่ได้ตั้งค่า LIFF'} className={`${SETTINGS_INPUT_MONO} flex-1 min-w-0`} />
          <button
            type="button"
            disabled={!finance}
            onClick={() => finance && void copy(finance)}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} self-center shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap border border-slate-300 dark:border-slate-600 disabled:opacity-50`}
          >
            <Copy className="w-3.5 h-3.5" /> คัดลอก
          </button>
        </div>
      </div>
    </SettingsCard>
  )
}
