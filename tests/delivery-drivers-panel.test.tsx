// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DeliveryDriversPanel } from '@/features/settings/components/DeliveryDriversPanel'
import { setCachedPolicies } from '@/lib/db/policies'

const mockToast = vi.fn()
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mockToast }) }))
// settings_update echoes the merged policies back
const mockRpc = vi.hoisted(() => ({
  rpc: vi.fn(async (_fn: string, args: { p_patch: { policies: Record<string, unknown> } }) => ({ policies: args.p_patch.policies })),
}))
vi.mock('@/lib/db/rpc', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/db/rpc')>()), ...mockRpc }))
const mockLine = vi.hoisted(() => ({
  contacts: vi.fn(async () => ({ data: [] as unknown[], error: null as unknown })),
  createDriverLineLinkCode: vi.fn(),
  unlinkLineContact: vi.fn(),
  confirm: vi.fn(async () => true),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ not: () => mockLine.contacts() }) }) }) }),
}))
vi.mock('@/app/actions/line', () => ({
  createDriverLineLinkCode: mockLine.createDriverLineLinkCode,
  unlinkLineContact: mockLine.unlinkLineContact,
}))
vi.mock('@/components/common/ConfirmDialogProvider', () => ({
  useConfirm: () => mockLine.confirm,
  useNotice: () => vi.fn(async () => undefined),
  useAskText: () => vi.fn(async () => null),
}))
vi.mock('@/features/appointments/services/appointment-storage', () => ({ loadAppointments: () => [] }))

describe('Settings › LINE › ทะเบียนคนขับ', () => {
  afterEach(cleanup)

  it('บันทึกและสร้างลิงก์: adds a driver and makes their one-time link at once; edits and switches off (never deletes)', async () => {
    setCachedPolicies({ delivery_drivers: [{ id: 'D001', name: 'สมชาย', active: true }] })
    mockLine.createDriverLineLinkCode.mockResolvedValue({
      success: true,
      data: { code: 'LINK-ABCDEFGHJK', expires_at: new Date(Date.now() + 600_000).toISOString(), oaUrl: 'https://line.me/R/oaMessage/%40myshop/?LINK-ABCDEFGHJK' },
    })
    render(<DeliveryDriversPanel />)
    expect(screen.getByText('D001')).toBeDefined()
    expect(await screen.findByText('ยังไม่ผูก')).toBeDefined()

    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุลพนักงานส่งของ/), { target: { value: 'สมหญิง' } })
    fireEvent.change(screen.getByLabelText(/เบอร์โทร/), { target: { value: '0899999999' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและสร้างลิงก์' }))
    await waitFor(() => expect(screen.getByText('D002')).toBeDefined())
    const row = screen.getByText('D002').closest('tr') as HTMLElement
    await waitFor(() => expect(within(row).getByTestId('driver-line-code').textContent).toBe('LINK-ABCDEFGHJK'))
    expect(mockLine.createDriverLineLinkCode).toHaveBeenCalledWith('D002')
    expect(within(row).getByText('รอกดลิงก์')).toBeDefined()
    expect(within(row).getByText(/หมดอายุใน/)).toBeDefined()
    expect(within(row).getByAltText(/QR ลิงก์ผูก LINE/)).toBeDefined()
    expect(mockRpc.rpc).toHaveBeenLastCalledWith('settings_update', {
      p_patch: {
        policies: {
          delivery_drivers: [
            { id: 'D001', name: 'สมชาย', active: true },
            { id: 'D002', name: 'สมหญิง', phone: '0899999999', active: true },
          ],
        },
      },
      p_reason: 'เพิ่มคนขับ D002',
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'ระงับ' })[0])
    await waitFor(() => expect(mockRpc.rpc).toHaveBeenCalledTimes(2))
    expect(mockLine.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'ยืนยันการระงับการใช้งานข้อมูล' }))
    const last = mockRpc.rpc.mock.calls[1][1].p_patch.policies.delivery_drivers as Array<{ id: string; active: boolean }>
    expect(last.map((d) => [d.id, d.active])).toEqual([['D001', false], ['D002', true]])
  })

  it('ลบ: a driver never used is removed from the list; a driver with a linked LINE is blocked and suspended instead', async () => {
    mockRpc.rpc.mockClear()
    setCachedPolicies({
      delivery_drivers: [
        { id: 'D001', name: 'สมชาย', active: true },
        { id: 'D002', name: 'สมศักดิ์', active: true },
      ],
    })
    mockLine.contacts.mockResolvedValue({ data: [{ id: 'k-1', display_name: 'Somchai', driver_code: 'D001' }], error: null })
    render(<DeliveryDriversPanel />)
    expect(await screen.findByText(/LINE "Somchai"/)).toBeDefined()

    fireEvent.click(within(screen.getByText('D002').closest('tr') as HTMLElement).getByRole('button', { name: 'ลบ' }))
    await waitFor(() => expect(mockRpc.rpc).toHaveBeenCalledTimes(1))
    expect(mockRpc.rpc.mock.calls[0][1]).toEqual({
      p_patch: { policies: { delivery_drivers: [{ id: 'D001', name: 'สมชาย', active: true }] } },
      p_reason: 'ลบคนขับ D002',
    })

    await waitFor(() => expect(screen.queryByText('D002')).toBeNull())
    const del = within(screen.getByText('D001').closest('tr') as HTMLElement).getByRole('button', { name: 'ลบ' }) as HTMLButtonElement
    await waitFor(() => expect(del.disabled).toBe(false))
    fireEvent.click(del)
    await waitFor(() => expect(mockRpc.rpc).toHaveBeenCalledTimes(2))
    expect(mockLine.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: 'เปลี่ยนเป็นระงับการใช้งาน' }))
    expect(mockRpc.rpc.mock.calls[1][1]).toMatchObject({ p_reason: 'ระงับคนขับ D001' })
    mockLine.contacts.mockReset()
    mockLine.contacts.mockResolvedValue({ data: [], error: null })
    mockLine.confirm.mockClear()
  })

  it('LINE ของคนขับ: แสดงสถานะจริง ออกรหัสเชื่อมให้คนขับ (ใช้รหัสคนขับ ไม่ใช่บัญชีผู้ใช้)', async () => {
    setCachedPolicies({
      delivery_drivers: [
        { id: 'D001', name: 'สมชาย', active: true },
        { id: 'D002', name: 'สมศักดิ์', active: true },
      ],
    })
    mockLine.contacts.mockResolvedValueOnce({ data: [{ id: 'k-1', display_name: 'Somchai', driver_code: 'D001' }], error: null })
    mockLine.createDriverLineLinkCode.mockResolvedValue({ success: true, data: { code: 'LINK-ABCDEFGHJK', expires_at: '2026-10-10T08:00:00Z', oaUrl: null } })
    render(<DeliveryDriversPanel />)
    expect(await screen.findByText(/LINE "Somchai"/)).toBeDefined()
    expect(screen.getByText('ผูก LINE แล้ว')).toBeDefined()
    const row = screen.getByText('D002').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'สร้างลิงก์' }))
    await waitFor(() => expect(within(row).getByTestId('driver-line-code').textContent).toBe('LINK-ABCDEFGHJK'))
    expect(mockLine.createDriverLineLinkCode).toHaveBeenCalledWith('D002')
  })

  it('ฐานข้อมูลยังไม่มีระบบ LINE: แจ้งชัดและไม่มีปุ่มออกรหัส', async () => {
    setCachedPolicies({ delivery_drivers: [{ id: 'D001', name: 'สมชาย', active: true }] })
    mockLine.contacts.mockResolvedValueOnce({ data: null as unknown as unknown[], error: { message: 'relation does not exist' } })
    render(<DeliveryDriversPanel />)
    expect(await screen.findByText(/ระบบ LINE ยังไม่พร้อม/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'สร้างลิงก์' })).toBeNull()
  })

  it('ยกเลิกการผูก ต้องยืนยันก่อน (ไม่ต้องพิมพ์เหตุผล)', async () => {
    setCachedPolicies({ delivery_drivers: [{ id: 'D001', name: 'สมชาย', active: true }] })
    mockLine.contacts.mockResolvedValue({ data: [{ id: 'k-1', display_name: 'Somchai', driver_code: 'D001' }], error: null })
    mockLine.unlinkLineContact.mockResolvedValue({ success: true })
    render(<DeliveryDriversPanel />)
    const button = await screen.findByRole('button', { name: /ยกเลิกการผูก/ })
    mockLine.confirm.mockResolvedValueOnce(false)
    fireEvent.click(button)
    await waitFor(() => expect(mockLine.confirm).toHaveBeenCalledTimes(1))
    expect(mockLine.unlinkLineContact).not.toHaveBeenCalled()
    mockLine.confirm.mockResolvedValueOnce(true)
    fireEvent.click(button)
    await waitFor(() => expect(mockLine.unlinkLineContact).toHaveBeenCalledWith('k-1'))
    mockLine.contacts.mockReset()
    mockLine.contacts.mockResolvedValue({ data: [], error: null })
  })
})
