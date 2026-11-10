'use client'

/**
 * Data management standard (owner 2026-11-08, Data_Management_Standards_Thai.txt): the one place for the
 * three ways to get rid of data and their on-screen messages.
 *   ระงับ  (suspend)     master data — `confirmSuspend`
 *   ยกเลิก (void)        a confirmed bill — `askVoidReason` (reason required)
 *   ลบ    (hard delete)  never-used data — `deleteOrSuspend`: confirm → delete; if the server answers
 *                        <TAG>_IN_USE: <n>, the delete is blocked and the user may suspend instead.
 */
import { useCallback } from 'react'
import { useAskText, useConfirm, useNotice } from '@/components/common/ConfirmDialogProvider'
import { isDbError } from '@/lib/db/rpc'

/** Number of records that still use the item, from a server refusal `<TAG>_IN_USE: <n>`; null = other error. */
export function inUseCount(err: unknown): number | null {
  if (!isDbError(err) || !/_IN_USE$/.test(err.tag)) return null
  const n = Number(err.raw.split(':')[1])
  return Number.isFinite(n) ? n : 0
}

export type DeleteOutcome = 'deleted' | 'suspended' | 'blocked' | 'cancelled'

export interface DeleteOrSuspendOptions {
  /** Shown in the messages, e.g. `สินค้า "พัดลม"`. */
  name: string
  /** Real delete (server checks the dependencies). */
  remove: () => Promise<unknown>
  /** Switch the item off instead; omit when it is already suspended or cannot be suspended. */
  suspend?: () => Promise<unknown>
  /** What the count refers to (default เอกสาร), e.g. สินค้า for a category. */
  usedIn?: string
}

export function useDataActions() {
  const confirm = useConfirm()
  const notice = useNotice()
  const askText = useAskText()

  const confirmSuspend = useCallback(
    (name: string) =>
      confirm({
        title: 'ยืนยันการระงับการใช้งานข้อมูล',
        message: `คุณต้องการระงับการใช้งาน ${name} ใช่หรือไม่? หากระงับแล้ว รายการนี้จะไม่แสดงให้เลือกในบิลใหม่ แต่ข้อมูลในบิลเก่าและรายงานย้อนหลังจะยังคงอยู่ครบถ้วน (สามารถกดเปิดใช้งานใหม่ได้ภายหลัง)`,
        confirmLabel: 'ยืนยันการระงับ',
        cancelLabel: 'ปิดหน้าต่าง',
        warning: true,
      }),
    [confirm]
  )

  /** Reason for cancelling a confirmed bill; null = closed. */
  const askVoidReason = useCallback(
    (billNo: string) =>
      askText({
        title: `ยืนยัน ${billNo}`,
        message: 'การยกเลิกบิลจะทำให้เอกสารนี้เป็นโมฆะ ยอดเงินจะถูกตัดออกจากรายงาน และระบบจะคืนสต็อกสินค้ากลับเข้าคลังอัตโนมัติ (ไม่สามารถกู้คืนบิลนี้ได้อีก)',
        placeholder: 'กรุณาระบุเหตุผลในการยกเลิก (บังคับกรอก)',
        required: true,
        confirmLabel: 'ยืนยัน',
        cancelLabel: 'ปิดหน้าต่าง',
        danger: true,
      }),
    [askText]
  )

  const confirmHardDelete = useCallback(
    (name: string) =>
      confirm({
        title: 'ยืนยันการลบข้อมูลถาวร',
        message: `คุณต้องการลบ ${name} ออกจากระบบอย่างถาวรใช่หรือไม่? ข้อมูลนี้จะถูกลบหายไปและไม่สามารถกู้คืนได้อีก`,
        confirmLabel: 'ลบถาวร',
        cancelLabel: 'ยกเลิก',
        danger: true,
      }),
    [confirm]
  )

  const deleteOrSuspend = useCallback(
    async ({ name, remove, suspend, usedIn = 'เอกสาร' }: DeleteOrSuspendOptions): Promise<DeleteOutcome> => {
      if (!(await confirmHardDelete(name))) return 'cancelled'
      try {
        await remove()
        return 'deleted'
      } catch (err) {
        const n = inUseCount(err)
        if (n === null) throw err
        const title = 'ไม่สามารถลบข้อมูลนี้ได้'
        const message = `ไม่สามารถลบ ${name} ได้ เนื่องจากมีประวัติการใช้งานในระบบแล้ว (พบใน${usedIn}จำนวน ${n} รายการ) กรุณาใช้ปุ่ม 'ระงับการใช้งาน' แทน เพื่อป้องกันข้อมูลในบิลเก่าเสียหาย`
        if (!suspend) {
          await notice({ title, message, confirmLabel: 'รับทราบ' })
          return 'blocked'
        }
        const go = await confirm({ title, message, confirmLabel: 'เปลี่ยนเป็นระงับการใช้งาน', cancelLabel: 'รับทราบ', warning: true })
        if (!go) return 'blocked'
        await suspend()
        return 'suspended'
      }
    },
    [confirm, confirmHardDelete, notice]
  )

  return { confirmSuspend, askVoidReason, confirmHardDelete, deleteOrSuspend }
}
