'use client'

import { useCallback } from 'react'
import { useToast } from '@/components/common/Toast'
import { sendCustomerReminder } from '@/app/actions/line'

/** One due item to remind about: the reminder rule and its bill / appointment. */
type ReminderItem = { rule: string; source_id: string }

const newKey = () => `rem-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`

/**
 * The one send command for customer reminders (owner 2026-11-28): to the bill's / appointment's own customer.
 * `onEach` marks the row being sent.
 * The toast is the same everywhere; one failed item tells why, several only count.
 */
export function useReminderSend() {
  const { showToast } = useToast()

  const run = useCallback(
    async (
      list: ReadonlyArray<ReminderItem>,
      sendOne: (c: ReminderItem) => Promise<{ success: boolean; error?: string }>,
      done: string,
      onEach?: (c: ReminderItem | null) => void,
    ) => {
      let ok = 0
      let fail = 0
      for (const c of list) {
        onEach?.(c)
        const r = await sendOne(c)
        if (r.success) ok++
        else {
          fail++
          if (list.length === 1) showToast('ส่งไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
        }
      }
      onEach?.(null)
      if (ok) showToast(done, `${ok} รายการ${fail ? ` · ไม่สำเร็จ ${fail}` : ''}`, 'SUCCESS')
      return { ok, fail }
    },
    [showToast],
  )

  const sendToCustomers = useCallback(
    (list: ReadonlyArray<ReminderItem>, onEach?: (c: ReminderItem | null) => void) =>
      run(list, (c) => sendCustomerReminder({ rule: c.rule, sourceId: c.source_id, idempotencyKey: newKey() }), 'ส่งเตือนแล้ว', onEach),
    [run],
  )
  return { sendToCustomers }
}
