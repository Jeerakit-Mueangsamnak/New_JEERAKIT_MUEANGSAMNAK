// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DbError, dbErrorMessage } from '@/lib/db/rpc'
import { ConfirmDialogProvider } from '@/components/common/ConfirmDialogProvider'
import { inUseCount, useDataActions, type DeleteOutcome } from '@/components/common/useDataActions'

afterEach(cleanup)

describe('data management standard: server answers', () => {
  it('a used item is refused with the number of documents', () => {
    expect(inUseCount(new DbError('PRODUCT_IN_USE: 3'))).toBe(3)
    expect(inUseCount(new DbError('CUSTOMER_IN_USE: 1'))).toBe(1)
    expect(inUseCount(new DbError('BILL_NOT_DRAFT'))).toBeNull()
    expect(inUseCount(new Error('PRODUCT_IN_USE: 3'))).toBeNull()
  })
  it('Thai messages for the new refusals', () => {
    expect(dbErrorMessage('PRODUCT_IN_USE: 3')).toContain('ระงับการใช้งานแทน')
    expect(dbErrorMessage('Could not find the function public.customer_delete(p_customer_id) in the schema cache')).toBe(
      'ระบบยังไม่ได้ติดตั้งคำสั่งลบนี้ในฐานข้อมูล'
    )
    expect(dbErrorMessage("BILL_VOID_OWNER_ONLY: another member's bill or a bill from another day")).toContain('เจ้าของร้าน')
    expect(dbErrorMessage('BILL_DRAFT_NOT_YOURS')).toContain('บิลร่างที่ตัวเองสร้าง')
  })
})

function Harness({ run }: { run: (a: ReturnType<typeof useDataActions>) => Promise<unknown> }) {
  const actions = useDataActions()
  return (
    <button type="button" onClick={() => void run(actions)}>
      go
    </button>
  )
}

const mount = (run: (a: ReturnType<typeof useDataActions>) => Promise<unknown>) =>
  render(
    <ConfirmDialogProvider>
      <Harness run={run} />
    </ConfirmDialogProvider>
  )

describe('data management standard: dialogs', () => {
  it('ลบ: never used → confirmed and deleted', async () => {
    const remove = vi.fn(async () => undefined)
    let outcome: DeleteOutcome | undefined
    mount(async (a) => (outcome = await a.deleteOrSuspend({ name: 'สินค้า "พัดลม"', remove, suspend: vi.fn() })))
    fireEvent.click(screen.getByText('go'))
    expect(await screen.findByText('ยืนยันการลบข้อมูลถาวร')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'ลบถาวร' }))
    await waitFor(() => expect(outcome).toBe('deleted'))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('ลบ: used → blocked with the count, "เปลี่ยนเป็นระงับการใช้งาน" suspends instead', async () => {
    const suspend = vi.fn(async () => undefined)
    let outcome: DeleteOutcome | undefined
    mount(async (a) =>
      (outcome = await a.deleteOrSuspend({
        name: 'ลูกค้า "นาย ก"',
        remove: async () => {
          throw new DbError('CUSTOMER_IN_USE: 4')
        },
        suspend,
      }))
    )
    fireEvent.click(screen.getByText('go'))
    fireEvent.click(await screen.findByRole('button', { name: 'ลบถาวร' }))
    expect(await screen.findByText('ไม่สามารถลบข้อมูลนี้ได้')).toBeDefined()
    expect(screen.getByText(/พบในเอกสารจำนวน 4 รายการ/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'รับทราบ' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นระงับการใช้งาน' }))
    await waitFor(() => expect(outcome).toBe('suspended'))
    expect(suspend).toHaveBeenCalledTimes(1)
  })

  it('ระงับ: amber "ยืนยันการระงับ" with "ปิดหน้าต่าง"', async () => {
    let ok: boolean | undefined
    mount(async (a) => (ok = await a.confirmSuspend('หมวดหมู่ "แบบคาน"')))
    fireEvent.click(screen.getByText('go'))
    expect(await screen.findByText('ยืนยันการระงับการใช้งานข้อมูล')).toBeDefined()
    expect(screen.getByRole('button', { name: 'ปิดหน้าต่าง' })).toBeDefined()
    const button = screen.getByRole('button', { name: 'ยืนยันการระงับ' })
    expect(button.className).toContain('bg-amber-500')
    fireEvent.click(button)
    await waitFor(() => expect(ok).toBe(true))
  })

  it('ยกเลิกบิล: the reason is required', async () => {
    let reason: string | null | undefined
    mount(async (a) => (reason = await a.askVoidReason('B001')))
    fireEvent.click(screen.getByText('go'))
    expect(await screen.findByText('ยืนยัน B001')).toBeDefined()
    const confirm = screen.getByRole('button', { name: 'ยืนยัน' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('กรุณาระบุเหตุผลในการยกเลิก (บังคับกรอก)'), { target: { value: 'ลูกค้าเปลี่ยนใจ' } })
    })
    fireEvent.click(confirm)
    await waitFor(() => expect(reason).toBe('ลูกค้าเปลี่ยนใจ'))
  })
})
