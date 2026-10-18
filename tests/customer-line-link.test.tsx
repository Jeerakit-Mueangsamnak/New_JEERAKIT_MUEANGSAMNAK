// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ contact: vi.fn(), code: vi.fn(), unlink: vi.fn(), ask: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => mocks.contact() }) }) }) }) }),
}))
vi.mock('@/app/actions/line', () => ({ createCustomerLineLinkCode: mocks.code, unlinkLineContact: mocks.unlink }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AAA') } }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
vi.mock('@/components/common/ConfirmDialogProvider', () => ({ useAskText: () => mocks.ask }))

import { CustomerLineLink } from '@/features/customers/components/CustomerLineLink'

const ID = '11111111-2222-4333-8444-555555555555'
const show = async (customerId?: string) => {
  await act(async () => {
    render(<CustomerLineLink customerId={customerId} customerName="บริษัท เอ" />)
  })
}

describe('ฟอร์มลูกค้า › เชื่อม LINE', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('ลูกค้าใหม่ที่ยังไม่บันทึก: บอกให้บันทึกก่อน ไม่มีปุ่มสร้างรหัส', async () => {
    await show(undefined)
    expect(screen.getByText(/บันทึกลูกค้าก่อน/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'สร้างรหัสเชื่อม LINE' })).toBeNull()
  })

  it('ยังไม่เชื่อม: สร้างรหัสแล้วแสดงรหัส + QR ในฟอร์ม', async () => {
    mocks.contact.mockResolvedValue({ data: null, error: null })
    mocks.code.mockResolvedValue({ success: true, data: { code: 'LINK-ABCDEFGHJK', expires_at: '2026-10-10T08:00:00Z', oaUrl: 'https://line.me/R/oaMessage/@shop/?x' } })
    await show(ID)
    expect(screen.getByText('ยังไม่เชื่อม')).toBeDefined()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'สร้างรหัสเชื่อม LINE' }))
    })
    expect(mocks.code).toHaveBeenCalledWith(ID)
    expect(screen.getByTestId('customer-line-code').textContent).toBe('LINK-ABCDEFGHJK')
    expect(screen.getByAltText('QR สำหรับส่งรหัสเชื่อม LINE')).toBeDefined()
  })

  it('เชื่อมแล้ว: ยกเลิกต้องมีเหตุผล', async () => {
    mocks.contact.mockResolvedValue({ data: { id: 'k-1', display_name: 'A-LINE' }, error: null })
    mocks.unlink.mockResolvedValue({ success: true })
    await show(ID)
    expect(screen.getByText(/เชื่อมแล้ว · A-LINE/)).toBeDefined()
    mocks.ask.mockResolvedValueOnce('')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ยกเลิกการเชื่อม/ }))
    })
    expect(mocks.unlink).not.toHaveBeenCalled()
    mocks.ask.mockResolvedValueOnce('ผูกผิดคน')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ยกเลิกการเชื่อม/ }))
    })
    expect(mocks.unlink).toHaveBeenCalledWith('k-1', 'ผูกผิดคน')
  })

  it('ฐานข้อมูลยังไม่มีระบบ LINE: แจ้งชัด', async () => {
    mocks.contact.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } })
    await show(ID)
    expect(screen.getByText(/ระบบ LINE ยังไม่พร้อม/)).toBeDefined()
  })
})
