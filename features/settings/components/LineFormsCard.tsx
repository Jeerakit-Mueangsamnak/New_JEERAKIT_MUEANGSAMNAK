'use client'
import React from 'react'
import { Copy } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { liffUrl } from '@/lib/line/liff-links'
import { ActionButton } from '@/components/common/ActionButton'
import { SETTINGS_ROW_INPUT, SettingsRow } from './SettingsRows'

/**
 * ฟอร์มใน LINE (owner 2026-11-13): the OWNER copies the income / expense form link into their own
 * LINE (e.g. Keep or a pinned chat). The form works only for the OWNER's linked LINE.
 * One row of the เชื่อมต่อ LINE links card (owner 2026-11-18: rows, name left | field right).
 */
export function LineFormsRow() {
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
    <SettingsRow label="ฟอร์มรายรับรายจ่าย (เจ้าของร้าน)">
      <input
        aria-label="ฟอร์มรายรับรายจ่าย (เจ้าของร้าน)"
        readOnly
        value={finance ?? 'ยังไม่ได้ตั้งค่า LIFF'}
        className={`${SETTINGS_ROW_INPUT} font-mono`}
      />
      <ActionButton variant="share" icon={<Copy />} disabled={!finance} onClick={() => finance && void copy(finance)} className="shrink-0">
        คัดลอก
      </ActionButton>
    </SettingsRow>
  )
}
