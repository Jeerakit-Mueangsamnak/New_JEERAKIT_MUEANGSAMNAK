// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import POSPage from '@/app/pos/page'
import { AppointmentDispatchModal } from '@/features/appointments/components/AppointmentDispatchModal'
import type { Appointment, Customer, Product } from '@/lib/types/rental-pos'
import type { FullBill } from '@/lib/types/rental-return'
import { ConfirmDialogProvider } from '@/components/common/ConfirmDialogProvider'

const mocks = vi.hoisted(() => ({
  fetchAppointments: vi.fn(),
  addAppointment: vi.fn(),
  dispatch: vi.fn(),
  toast: vi.fn(),
  search: 'appointmentId=appointment-1',
  push: vi.fn(),
  products: [] as Product[],
  customers: [] as Customer[],
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { username: 'owner' } }) }))
vi.mock('@/features/appointments/services/appointment-storage', () => ({
  fetchAppointmentsFromSupabase: mocks.fetchAppointments,
  addAppointmentAndReturn: mocks.addAppointment,
}))
vi.mock('@/features/appointments/services/driver-registry', () => ({
  loadDrivers: () => [{ id: 'D001', name: 'สมชาย', phone: '0812345678', active: true }],
}))
vi.mock('@/features/appointments/services/dispatch-service', () => ({ dispatchToDriver: mocks.dispatch }))
vi.mock('@/features/products/services/product-storage', () => ({ loadProducts: () => mocks.products }))
vi.mock('@/features/customers/services/customer-storage', () => ({
  loadCustomers: () => mocks.customers,
  createCustomerAsync: vi.fn(),
}))
vi.mock('@/features/pos/components/ProductGrid', () => ({ ProductGrid: () => null }))
vi.mock('@/features/pos/components/QuantityModal', () => ({ QuantityModal: () => null }))
vi.mock('@/features/pos/components/CartPanel', () => ({
  CartPanel: ({ customer, items, initialShippingAddress }: {
    customer: Customer | null
    items: Array<{ productName?: string; quantity: number; unitPrice: number }>
    initialShippingAddress?: string
  }) => (
    <div data-testid="prefilled-cart">
      <span>{customer?.customerName}</span>
      <span>{items.map((item) => `${item.productName}:${item.quantity}:${item.unitPrice}`).join('|')}</span>
      <span>{initialShippingAddress}</span>
    </div>
  ),
}))

const customer: Customer = {
  id: 'customer-1',
  customerName: 'คุณสมชาย',
  phone: '0811111111',
  address: 'บ้านลูกค้า',
}
const product: Product = {
  id: 'product-1',
  code: 'P-1',
  name: 'โต๊ะพับ',
  category: 'อุปกรณ์',
  unit: 'ตัว',
  rentalType: 'NORMAL',
  normalPrice: 250,
  dailyPrice: 50,
  defaultDamageFee: 0,
  defaultLossFee: 0,
  totalQuantity: 10,
  availableQuantity: 8,
  rentedQuantity: 0,
  damagedQuantity: 0,
  lostQuantity: 0,
  minimumStock: 0,
  status: 'ACTIVE',
}
const appointment: Appointment = {
  id: 'appointment-1',
  title: 'ส่งโต๊ะพับ',
  customerId: customer.id,
  customerName: customer.customerName,
  phone: customer.phone,
  location: 'สถานที่จัดงาน',
  date: '2026-10-10',
  startTime: '09:00',
  endTime: '10:00',
  type: 'DELIVERY',
  status: 'SCHEDULED',
  items: [{ id: product.id, name: product.name, quantity: 2, unit: 'ตัว' }],
}

const bill = {
  id: 'bill-1',
  billNo: 'BL-001',
  customerId: customer.id,
  customerName: customer.customerName,
  customerPhone: customer.phone,
  customerAddress: 'บ้านลูกค้า',
  siteName: 'สถานที่จัดงาน',
  items: [{
    rentalBillItemId: 'bill-item-1',
    productId: product.id,
    productName: product.name,
    quantity: 5,
    returnedQty: 0,
    outstandingQty: 5,
    dailyRate: 50,
    unit: 'ตัว',
    defaultRepairFee: 0,
    defaultReplacementFee: 0,
    requiresReturn: true,
    rentalStartDate: '2026-10-10',
    scheduledReturnDate: '2026-10-12',
    status: 'PENDING',
    remainingQty: 3,
    deliveryStatus: 'PARTIAL_DELIVERED',
  }],
} as FullBill

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.search = 'appointmentId=appointment-1'
  mocks.products = [product]
  mocks.customers = [customer]
  mocks.fetchAppointments.mockResolvedValue([appointment])
  const created = { ...appointment, id: 'server-appointment-id' }
  mocks.addAppointment.mockResolvedValue({ appointment: created, appointments: [created] })
  mocks.dispatch.mockResolvedValue({
    appointments: [created],
    lineSent: false,
    lineNote: 'LINE อยู่ในโหมดทดสอบ ยังไม่ได้ส่งจริง',
    withdrawNote: '',
  })
})

afterEach(() => {
  cleanup()
  vi.setSystemTime(new Date())
})

describe('Appointment and bill work-order integration', () => {
  it('prefills POS from the appointment customer, actual product record, quantity, and job site', async () => {
    render(<ConfirmDialogProvider><POSPage /></ConfirmDialogProvider>)
    const cart = await screen.findByTestId('prefilled-cart')
    expect(cart.textContent).toContain('คุณสมชาย')
    expect(cart.textContent).toContain('โต๊ะพับ:2:250')
    expect(cart.textContent).toContain('สถานที่จัดงาน')
  })

  it('does not invent an appointment product when its active product record is missing', async () => {
    mocks.products = []
    render(<ConfirmDialogProvider><POSPage /></ConfirmDialogProvider>)

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(
      'โหลดรายการสินค้าไม่ครบ',
      expect.stringContaining('โต๊ะพับ'),
      'ERROR'
    ))
    expect(screen.getByTestId('prefilled-cart').textContent).not.toContain('โต๊ะพับ')
  })

  it('uses the product master daily rental mode and price when that product is per-day', async () => {
    mocks.products = [{ ...product, rentalType: 'DAILY', calculationType: 'PER_DAY' }]
    render(<ConfirmDialogProvider><POSPage /></ConfirmDialogProvider>)

    const cart = await screen.findByTestId('prefilled-cart')
    expect(cart.textContent).toContain('โต๊ะพับ:2:50')
  })

  it('dispatches immediately using the current shop time and selected bill quantity', async () => {
    vi.setSystemTime(new Date('2026-10-16T03:55:00.000Z'))
    const created = { ...appointment, id: 'server-appointment-id' }
    const onDispatched = vi.fn()
    render(<AppointmentDispatchModal sourceBill={bill} onClose={vi.fn()} onDispatched={onDispatched} />)

    fireEvent.click(screen.getByRole('button', { name: 'ส่งของ' }))
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('เลือกคนขับ'))
    fireEvent.click(await screen.findByText('D001 สมชาย'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'สั่งงานทันที' }))

    await waitFor(() => expect(mocks.addAppointment).toHaveBeenCalledOnce())
    const input = mocks.addAppointment.mock.calls[0][0]
    expect(input).toMatchObject({
      type: 'DELIVERY',
      billId: 'bill-1',
      billNo: 'BL-001',
      customerId: customer.id,
      location: 'สถานที่จัดงาน',
      items: [{ id: product.id, quantity: 3 }],
      date: '2026-10-16',
      startTime: '10:55',
      endTime: '11:55',
    })
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(
      created,
      expect.objectContaining({ id: 'D001', name: 'สมชาย' }),
      'owner'
    ))
    expect(onDispatched).toHaveBeenCalledOnce()
  })

  it('saves the entered date, time and work type as an appointment without dispatching', async () => {
    vi.setSystemTime(new Date('2026-10-16T03:55:00.000Z'))
    const onClose = vi.fn()
    render(<AppointmentDispatchModal sourceBill={bill} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'วันที่' }))
    fireEvent.click(screen.getByRole('button', { name: 'เดือนถัดไป' }))
    fireEvent.click(screen.getByRole('button', { name: /^15$/ }))
    const startTime = screen.getByLabelText('เวลาเริ่มงาน')
    fireEvent.change(startTime, { target: { value: '13:00' } })
    fireEvent.blur(startTime)
    const endTime = screen.getByLabelText('เวลาสิ้นสุดงาน')
    fireEvent.change(endTime, { target: { value: '14:30' } })
    fireEvent.blur(endTime)
    fireEvent.click(screen.getByRole('button', { name: 'รับคืน' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'นัดหมาย' }))

    await waitFor(() => expect(mocks.addAppointment).toHaveBeenCalledOnce())
    expect(mocks.addAppointment.mock.calls[0][0]).toMatchObject({
      type: 'RETURN',
      date: '2026-11-15',
      startTime: '13:00',
      endTime: '14:30',
      items: [{ id: product.id, quantity: 5 }],
    })
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
