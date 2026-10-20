// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Bill menu: the selected bill follows each reload, and cancel cannot be submitted twice. */

const m = vi.hoisted(() => ({
  fetchBills: vi.fn(),
  confirmBill: vi.fn(),
  cancelOrVoidBill: vi.fn(),
  confirm: vi.fn(async () => true),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: m.toast }) }))
vi.mock('@/components/common/ConfirmDialogProvider', () => ({ useConfirm: () => m.confirm }))
vi.mock('@/lib/contexts/SystemSettingsContext', () => ({ useSystemSettings: () => ({ settings: { business: {} } }) }))
vi.mock('@/features/auth/hooks/useActionPermission', () => ({
  useActionPermission: () => () => true,
  NO_ACTION_PERMISSION_TITLE: 'no',
}))
vi.mock('@/lib/hooks/useAutoFitPageSize', () => ({
  useAutoFitPageSize: () => ({ containerRef: { current: null }, setCurrentPage: () => {}, endIndex: 100 }),
}))
vi.mock('@/features/bills/services/bill-storage', () => ({
  loadBills: () => [],
  fetchBillsFromSupabase: m.fetchBills,
  canHardDeleteBill: (b: { rentalStatus: string }) => b.rentalStatus === 'DRAFT',
}))
vi.mock('@/features/bills/services/bill-service', () => ({
  confirmBill: m.confirmBill,
  cancelBill: vi.fn(),
  cancelOrVoidBill: m.cancelOrVoidBill,
}))
vi.mock('@/features/bills/components/BillActionView', () => ({ BillActionView: () => null }))
vi.mock('@/features/bills/components/BillRevisionView', () => ({ BillRevisionView: () => null }))
vi.mock('@/features/bills/components/AuditLogViewerModal', () => ({ AuditLogViewerModal: () => null }))
vi.mock('@/features/bills/components/LineNotifyModal', () => ({ LineNotifyModal: () => null }))
vi.mock('@/features/bills/components/PaymentRefundModal', () => ({ PaymentRefundModal: () => null }))
vi.mock('@/features/bills/components/DepositRefundModal', () => ({ DepositModal: () => null }))
vi.mock('@/features/bills/components/DeliveryModal', () => ({ DeliveryModal: () => null }))
vi.mock('@/features/appointments/components/AppointmentDispatchModal', () => ({ AppointmentDispatchModal: () => null }))
vi.mock('@/features/documents/utils/rental-bill-print', () => ({ printRentalBillA4: vi.fn() }))

function bill(over: Record<string, unknown>) {
  return {
    id: 'b1',
    billNo: 'BL-0001',
    billDate: '2026-10-17',
    customerName: 'ลูกค้าทดสอบ',
    customerPhone: '0800000000',
    rentalStartDate: '2026-10-17',
    scheduledReturnDate: '2026-10-20',
    grandTotal: 1000,
    paidAmount: 0,
    outstandingAmount: 1000,
    heldDepositAmount: 0,
    rentalStatus: 'DRAFT',
    serverStatus: 'DRAFT',
    paymentStatus: 'UNPAID',
    deliveryStatus: 'NOT_DELIVERED',
    items: [],
    ...over,
  }
}

const toolbarButton = (name: string) =>
  screen.getAllByRole('button').find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined

describe('Bills page (เมนูจัดการบิล)', () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset?.())
    m.confirm.mockResolvedValue(true)
  })
  afterEach(() => cleanup())

  it('after confirming a draft from the toolbar, the toolbar shows the confirmed bill actions', async () => {
    m.fetchBills.mockResolvedValueOnce([bill({})]).mockResolvedValueOnce([bill({ rentalStatus: 'CONFIRMED', serverStatus: 'CONFIRMED' })])
    m.confirmBill.mockResolvedValue(null)
    const { default: BillsPage } = await import('@/app/bills/page')
    render(<BillsPage />)
    const row = (await screen.findAllByText('BL-0001'))[0]
    fireEvent.click(row)
    await act(async () => {
      fireEvent.click(toolbarButton('ยืนยันบิล')!)
    })
    await waitFor(() => expect(m.fetchBills).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(toolbarButton('ยืนยันบิล')).toBeUndefined())
    expect(toolbarButton('ส่งของ')?.disabled).toBe(false)
    expect(toolbarButton('รับชำระเงิน')?.disabled).toBe(false)
  })

  it('the cancel button is disabled while the cancel is being saved', async () => {
    m.fetchBills.mockResolvedValue([bill({ rentalStatus: 'RENTING', serverStatus: 'ACTIVE' })])
    let finish: () => void = () => {}
    m.cancelOrVoidBill.mockImplementation(() => new Promise<void>((r) => (finish = r)))
    const { default: BillsPage } = await import('@/app/bills/page')
    render(<BillsPage />)
    await screen.findAllByText('BL-0001')
    fireEvent.click(screen.getAllByTitle('ยกเลิกบิล')[0])
    fireEvent.change(await screen.findByPlaceholderText('เช่น ลูกค้าขอยกเลิกงาน...'), { target: { value: 'ลูกค้าขอยกเลิก' } })
    const submit = toolbarButton('ยืนยันยกเลิกบิล')!
    await act(async () => {
      fireEvent.click(submit)
    })
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(m.cancelOrVoidBill).toHaveBeenCalledTimes(1)
    await act(async () => finish())
  })
})
