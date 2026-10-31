'use client'

import { useCallback } from 'react'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { useToast } from '@/components/common/Toast'
import { unlinkLineContact } from '@/app/actions/line'

/**
 * Shared "ยกเลิกการเชื่อม LINE" flow for the Settings › LINE panels:
 * confirm → unlinkLineContact → toast → reload. Callers keep their own busy/row state.
 */
export function useUnlinkLineContact(onDone?: () => void | Promise<void>) {
  const confirm = useConfirm()
  const { showToast } = useToast()

  return useCallback(
    async (contactId: string, name: string, message?: string): Promise<boolean> => {
      const ok = await confirm({
        title: `ยกเลิกการเชื่อม LINE: ${name}`,
        message: message || 'ข้อความที่ยังไม่ส่งถึงคนนี้จะถูกยกเลิก',
        confirmLabel: 'ยกเลิกการเชื่อม',
        danger: true,
      })
      if (!ok) return false

      let r: Awaited<ReturnType<typeof unlinkLineContact>>
      try {
        r = await unlinkLineContact(contactId)
      } catch (e: unknown) {
        showToast('ยกเลิกไม่สำเร็จ', e instanceof Error ? e.message : 'เกิดข้อผิดพลาด', 'ERROR')
        return false
      }
      if (!r.success) {
        showToast('ยกเลิกไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
        return false
      }
      showToast('ยกเลิกการเชื่อมแล้ว', name, 'SUCCESS')
      await onDone?.()
      return true
    },
    [confirm, showToast, onDone]
  )
}
