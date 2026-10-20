// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  contacts: vi.fn(),
  profiles: vi.fn(),
  myCode: vi.fn(),
  unlink: vi.fn(),
  ask: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () =>
        table === 'line_contacts' ? { eq: () => mocks.contacts() } : { order: () => mocks.profiles() },
    }),
  }),
}))
vi.mock('@/app/actions/line', () => ({
  createMyLineLinkCode: mocks.myCode,
  unlinkLineContact: mocks.unlink,
}))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'p-me', role: 'USER' } }) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
vi.mock('@/components/common/ConfirmDialogProvider', () => ({ useAskText: () => mocks.ask }))

import { LineMembersPanel } from '@/features/settings/components/LineMembersPanel'

const renderPanel = async () => {
  await act(async () => {
    render(<LineMembersPanel />)
  })
}
const row = (table: string, text: string) =>
  within(screen.getByRole('table', { name: table })).getByText(text).closest('tr') as HTMLElement

describe('Settings › LINE › เพิ่มข้อมูล', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contacts.mockResolvedValue({
      data: [
        { id: 'k-1', display_name: 'A-LINE', profile_id: null, customer_id: 'c-1' },
        { id: 'k-2', display_name: 'Boss', profile_id: 'p-owner', customer_id: null },
      ],
      error: null,
    })
    mocks.profiles.mockResolvedValue({
      data: [
        { id: 'p-me', display_name: 'ฉันเอง', username: 'me' },
        { id: 'p-owner', display_name: 'เจ้าของ', username: 'owner' },
        { id: 'p-x', display_name: 'พนักงาน X', username: 'x' },
      ],
      error: null,
    })
  })
  afterEach(cleanup)

  it('แสดงเฉพาะพนักงานที่ใช้ระบบ พร้อมสถานะ LINE จริง (ลูกค้าไปจัดการในฟอร์มลูกค้า)', async () => {
    await renderPanel()
    expect(screen.queryByRole('table', { name: 'ตารางลูกค้า LINE' })).toBeNull()
    expect(within(row('ตารางพนักงาน LINE', 'เจ้าของ')).getByText(/เชื่อมแล้ว · Boss/)).toBeDefined()
    // a staff code is only for oneself; another member's row has no button
    expect(within(row('ตารางพนักงาน LINE', 'ฉันเอง')).getByRole('button', { name: 'ออกรหัสของฉัน' })).toBeDefined()
    expect(within(row('ตารางพนักงาน LINE', 'พนักงาน X')).queryByRole('button')).toBeNull()
    // only oneself or the OWNER may unlink a member
    expect(within(row('ตารางพนักงาน LINE', 'เจ้าของ')).queryByRole('button', { name: /ยกเลิกการเชื่อม/ })).toBeNull()
  })

  it('ออกรหัสของตัวเองแล้วแสดงรหัสในแถวนั้น', async () => {
    mocks.myCode.mockResolvedValue({ success: true, data: { code: '123456', expires_at: '2026-10-10T08:00:00Z' } })
    await renderPanel()
    await act(async () => {
      fireEvent.click(within(row('ตารางพนักงาน LINE', 'ฉันเอง')).getByRole('button', { name: 'ออกรหัสของฉัน' }))
    })
    expect(within(row('ตารางพนักงาน LINE', 'ฉันเอง')).getByTestId('line-code').textContent).toBe('123456')
  })

  it('ฐานข้อมูลยังไม่มีระบบ LINE: แจ้งชัดและไม่ให้ออกรหัส', async () => {
    mocks.contacts.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } })
    await renderPanel()
    expect(screen.getByText(/ระบบ LINE ยังไม่พร้อม/)).toBeDefined()
    expect((within(row('ตารางพนักงาน LINE', 'ฉันเอง')).getByRole('button', { name: 'ออกรหัสของฉัน' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
