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
vi.mock('@/lib/db/rpc', () => mockRpc)
const mockLine = vi.hoisted(() => ({
  contacts: vi.fn(async () => ({ data: [] as unknown[], error: null as unknown })),
  createDriverLineLinkCode: vi.fn(),
  unlinkLineContact: vi.fn(),
  ask: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ not: () => mockLine.contacts() }) }) }) }),
}))
vi.mock('@/app/actions/line', () => ({
  createDriverLineLinkCode: mockLine.createDriverLineLinkCode,
  unlinkLineContact: mockLine.unlinkLineContact,
}))
vi.mock('@/components/common/ConfirmDialogProvider', () => ({ useAskText: () => mockLine.ask }))

describe('Settings › LINE › ทะเบียนคนขับ', () => {
  afterEach(cleanup)

  it('adds a driver without LINE or QR, edits and switches off (never deletes)', async () => {
    setCachedPolicies({ delivery_drivers: [{ id: 'D001', name: 'สมชาย', active: true }] })
    render(<DeliveryDriversPanel />)
    expect(screen.getByText('D001')).toBeDefined()
    expect(screen.getByText('ยังไม่ผูก')).toBeDefined()

    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุลพนักงานส่งของ/), { target: { value: 'สมหญิง' } })
    fireEvent.change(screen.getByLabelText(/เบอร์โทร/), { target: { value: '0899999999' } })
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มพนักงานส่งของ' }))
    await waitFor(() => expect(screen.getByText('D002')).toBeDefined())
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

    fireEvent.click(screen.getAllByRole('button', { name: 'ปิดใช้งาน' })[0])
    await waitFor(() => expect(mockRpc.rpc).toHaveBeenCalledTimes(2))
    const last = mockRpc.rpc.mock.calls[1][1].p_patch.policies.delivery_drivers as Array<{ id: string; active: boolean }>
    expect(last.map((d) => [d.id, d.active])).toEqual([['D001', false], ['D002', true]])
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
    expect(await screen.findByText(/เชื่อมแล้ว · Somchai/)).toBeDefined()
    const row = screen.getByText('D002').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'ออกรหัสเชื่อม LINE' }))
    await waitFor(() => expect(within(row).getByTestId('driver-line-code').textContent).toBe('LINK-ABCDEFGHJK'))
    expect(mockLine.createDriverLineLinkCode).toHaveBeenCalledWith('D002')
  })

  it('ฐานข้อมูลยังไม่มีระบบ LINE: แจ้งชัดและไม่มีปุ่มออกรหัส', async () => {
    setCachedPolicies({ delivery_drivers: [{ id: 'D001', name: 'สมชาย', active: true }] })
    mockLine.contacts.mockResolvedValueOnce({ data: null as unknown as unknown[], error: { message: 'relation does not exist' } })
    render(<DeliveryDriversPanel />)
    expect(await screen.findByText(/ระบบ LINE ยังไม่พร้อม/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'ออกรหัสเชื่อม LINE' })).toBeNull()
  })
})
