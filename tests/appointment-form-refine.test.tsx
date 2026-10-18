// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AppointmentForm } from '@/features/appointments/components/AddAppointmentModal'
import { normalizeTime } from '@/features/appointments/components/AppointmentFormFields'
import { addAppointment, dbAppointmentToDomain } from '@/features/appointments/services/appointment-storage'
import { getPolicies, setCachedPolicies } from '@/lib/db/policies'
import { setCachedProducts } from '@/features/products/services/product-storage'
import { saveCategories } from '@/lib/category-rules-storage'
import type { Appointment, Customer, Product } from '@/lib/types/rental-pos'

const mockToast = vi.fn()
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mockToast }) }))

// Server calls: settings_update merges policies like the server; appointment_save is recorded.
const mockRpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/rpc', () => ({ rpc: mockRpc, selectRows: vi.fn(async () => []) }))
vi.mock('@/lib/supabase/client', () => {
  const chain: any = new Proxy(() => chain, { get: () => chain, apply: () => chain })
  return { createClient: () => chain }
})

const customers = [{ id: 'cust-1', customerName: 'บริษัท ทดสอบ จำกัด', phone: '0811111111', address: 'ถนนพระราม 9' }] as Customer[]
const product = (id: string, name: string, categoryId: string, unit: string) =>
  ({ id, name, category: '', categoryId, unit, status: 'ACTIVE' }) as unknown as Product

const renderForm = (props: Partial<React.ComponentProps<typeof AppointmentForm>> = {}) => {
  const onSubmit = vi.fn()
  render(<AppointmentForm customers={customers} initialDate="2026-10-10" onSubmit={onSubmit} onCancel={() => {}} {...props} />)
  return onSubmit
}
const pickCustomer = () => {
  fireEvent.change(screen.getByPlaceholderText('พิมพ์ค้นหาชื่อลูกค้า, บริษัท, เบอร์โทร...'), { target: { value: 'ทดสอบ' } })
  fireEvent.click(screen.getByRole('button', { name: /บริษัท ทดสอบ จำกัด/ }))
}
const save = () => fireEvent.click(screen.getByRole('button', { name: /บันทึกการ/ }))
const typeTitle = (value: string) => fireEvent.change(screen.getByLabelText(/ชื่องาน/), { target: { value } })

describe('ฟอร์มนัดหมาย (ข้อ 1–7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setCachedPolicies({})
    mockRpc.mockImplementation(async (fn: string, args: any) => {
      if (fn === 'settings_update') return { policies: { ...getPolicies(), ...args.p_patch.policies } }
      return null
    })
    saveCategories([
      { id: 'cat-a', name: 'นั่งร้าน', isActive: true },
      { id: 'cat-b', name: 'แบบหล่อ', isActive: true },
    ])
    setCachedProducts([
      product('prod-1', 'ขาตั้งนั่งร้าน 1.7 ม.', 'cat-a', 'ต้น'),
      product('prod-2', 'แผ่นแบบเหล็ก', 'cat-b', 'แผ่น'),
    ])
  })
  afterEach(cleanup)

  it('ไม่มีช่องประเภทนัดหมายและสถานะ; ชื่องานพิมพ์เองและต้องกรอก', async () => {
    const onSubmit = renderForm()
    expect(screen.queryByRole('combobox', { name: 'ประเภทนัดหมาย' })).toBeNull()
    expect(screen.queryByText('ประเภทนัดหมาย')).toBeNull()
    expect(screen.queryByText('สถานะ')).toBeNull()
    pickCustomer()
    save()
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('กรุณาระบุชื่องาน', undefined, 'ERROR'))
    expect(onSubmit).not.toHaveBeenCalled()
    typeTitle('เก็บแบบ')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const apt = onSubmit.mock.calls[0][0] as Appointment
    expect(apt.title).toBe('เก็บแบบ')
    expect(apt.status).toBe('SCHEDULED') // the system works the status out; nobody picks it
  })

  it('สถานที่จัดส่ง: ว่างตอนเพิ่ม และเลือก/เปลี่ยนลูกค้าไม่นำที่อยู่ลูกค้ามาใส่แทน', () => {
    renderForm()
    const location = screen.getByLabelText('สถานที่จัดส่ง') as HTMLInputElement
    expect(location.value).toBe('')
    expect(location.placeholder).toBe('')
    pickCustomer()
    expect(location.value).toBe('') // the customer address is not copied in
    fireEvent.change(location, { target: { value: 'ไซต์งานบางนา' } })
    pickCustomer()
    expect(location.value).toBe('ไซต์งานบางนา')
  })

  it('ชื่อประเภทเดิมของงานเก่ายังอ่านกลับมาได้ (ข้อมูลเดิมไม่หาย)', async () => {
    const apt = {
      id: 'x', title: 'งาน', customerName: 'ก', date: '2026-10-10', startTime: '09:00', endTime: '10:00', status: 'SCHEDULED',
      type: 'GENERAL', appointmentTypeId: 'custom-1', appointmentTypeLabel: 'นัดติดตั้งหน้างาน',
      items: [{ id: 'prod-1', name: 'ขาตั้งนั่งร้าน 1.7 ม.', quantity: 20, unit: 'ต้น' }],
    } as Appointment
    await addAppointment(apt)
    const data = mockRpc.mock.calls.find((c) => c[0] === 'appointment_save')![1].p_data
    expect(data.title).toBe('งาน')
    expect(data.work_order.type).toEqual({ id: 'custom-1', label: 'นัดติดตั้งหน้างาน' })
    expect(data.work_order.items).toEqual(apt.items)

    const back = dbAppointmentToDomain({
      id: 'x', appointment_no: 'A1', appointment_type: 'GENERAL', customer_id: null, bill_id: null, related_entity_type: null, related_entity_id: null,
      title: 'งาน', description: null, start_datetime: '2026-10-10T02:00:00Z', end_datetime: '2026-10-10T03:00:00Z', location: null,
      contact_name: 'ก', contact_phone: null, assigned_user_id: null, priority: 'NORMAL', status: 'SCHEDULED', work_order: data.work_order, created_at: '',
    })
    expect(back.appointmentTypeLabel).toBe('นัดติดตั้งหน้างาน')
    expect(back.items).toEqual(apt.items)
  })

  it('เวลา: กดเลือกชั่วโมง/นาทีได้, พิมพ์เองได้ (24 ชม.), และเวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม', async () => {
    const onSubmit = renderForm()
    const start = screen.getByLabelText('เวลาเริ่ม', { selector: 'input' }) as HTMLInputElement
    fireEvent.click(start)
    const picker = screen.getByRole('dialog', { name: 'เวลาเริ่ม' })
    fireEvent.click(within(within(picker).getByRole('group', { name: 'ชั่วโมง' })).getByRole('button', { name: '14' }))
    fireEvent.click(within(within(picker).getByRole('group', { name: 'นาที' })).getByRole('button', { name: '30' }))
    expect(start.value).toBe('14:30')
    expect(screen.queryByRole('dialog', { name: 'เวลาเริ่ม' })).toBeNull()

    const end = screen.getByLabelText('เวลาสิ้นสุด', { selector: 'input' }) as HTMLInputElement
    fireEvent.change(end, { target: { value: '930' } })
    fireEvent.blur(end)
    expect(end.value).toBe('09:30')
    fireEvent.change(end, { target: { value: '25:00' } })
    fireEvent.blur(end)
    expect(end.value).toBe('09:30') // invalid typing is not kept

    pickCustomer()
    typeTitle('ส่งสินค้า')
    save()
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม', undefined, 'ERROR'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(normalizeTime('7.05')).toBe('07:05')
  })

  it('สินค้า: หมวดหมู่กรองสินค้า, เลือกหลายรายการ, แก้จำนวน, ลบ, กันซ้ำ และจำนวนต้องมากกว่า 0', async () => {
    const onSubmit = renderForm()
    expect(screen.getByText('ยังไม่ได้เลือกสินค้า')).toBeDefined() // no sample rows

    fireEvent.click(screen.getByRole('button', { name: 'ทุกหมวดหมู่' }))
    fireEvent.click(screen.getByRole('button', { name: 'นั่งร้าน' }))
    fireEvent.click(screen.getByRole('button', { name: 'เลือกสินค้า...' }))
    expect(screen.queryByRole('button', { name: /^แผ่นแบบเหล็ก/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^ขาตั้งนั่งร้าน/ }))

    fireEvent.click(screen.getByRole('button', { name: 'นั่งร้าน' }))
    fireEvent.click(screen.getByRole('button', { name: 'ทุกหมวดหมู่' }))
    fireEvent.click(screen.getByRole('button', { name: 'เลือกสินค้า...' }))
    fireEvent.click(screen.getByRole('button', { name: /^แผ่นแบบเหล็ก/ }))
    fireEvent.click(screen.getByRole('button', { name: 'เลือกสินค้า...' }))
    fireEvent.click(screen.getByRole('button', { name: /^ขาตั้งนั่งร้าน/ }))
    expect(mockToast).toHaveBeenCalledWith('มีสินค้านี้ในรายการแล้ว', expect.any(String), 'INFO')

    fireEvent.change(screen.getByLabelText('จำนวน ขาตั้งนั่งร้าน 1.7 ม.'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('จำนวน แผ่นแบบเหล็ก'), { target: { value: '0' } })
    pickCustomer()
    typeTitle('ส่งสินค้า')
    save()
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('จำนวนสินค้าต้องมากกว่า 0', undefined, 'ERROR'))
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'ลบ แผ่นแบบเหล็ก' }))
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].items).toEqual([{ id: 'prod-1', name: 'ขาตั้งนั่งร้าน 1.7 ม.', quantity: 50, unit: 'ต้น' }])
    expect(mockRpc).not.toHaveBeenCalled() // no bill, payment or stock call from the form
  })

  it('แก้ไข: ฟอร์มเดียวกับเพิ่มงาน แสดงข้อมูลเดิมครบ และบันทึกชื่องานที่แก้ได้', async () => {
    const initial: Appointment = {
      id: 'apt-1', title: 'ส่งนั่งร้าน 100 ชุด', type: 'DELIVERY', customerName: 'บริษัท ทดสอบ จำกัด', customerId: 'cust-1',
      date: '2026-10-10', startTime: '09:00', endTime: '10:00', status: 'SCHEDULED', location: 'ไซต์งานบางนา',
      items: [{ id: 'prod-2', name: 'แผ่นแบบเหล็ก', quantity: 12, unit: 'แผ่น' }],
    }
    const onSubmit = renderForm({ initial })
    expect((screen.getByLabelText(/ชื่องาน/) as HTMLInputElement).value).toBe('ส่งนั่งร้าน 100 ชุด')
    expect((screen.getByLabelText('สถานที่จัดส่ง') as HTMLInputElement).value).toBe('ไซต์งานบางนา')
    expect((screen.getByLabelText('จำนวน แผ่นแบบเหล็ก') as HTMLInputElement).value).toBe('12')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].title).toBe('ส่งนั่งร้าน 100 ชุด')
    expect(onSubmit.mock.calls[0][0].status).toBe('SCHEDULED')

    cleanup()
    const edited = renderForm({ initial })
    typeTitle('เก็บแบบ ไซต์บางนา')
    save()
    await waitFor(() => expect(edited).toHaveBeenCalled())
    expect(edited.mock.calls[0][0]).toMatchObject({ id: 'apt-1', title: 'เก็บแบบ ไซต์บางนา', location: 'ไซต์งานบางนา' })
    expect(onSubmit.mock.calls[0][0].location).toBe('ไซต์งานบางนา')
  })
})
