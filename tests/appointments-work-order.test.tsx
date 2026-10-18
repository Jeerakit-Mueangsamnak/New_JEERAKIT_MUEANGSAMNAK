// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AppointmentsPage from '@/app/appointments/page'
import { saveAppointments, loadAppointments } from '@/features/appointments/services/appointment-storage'
import { Appointment } from '@/lib/types/rental-pos'
import { jobStatusOf } from '@/features/appointments/appointment-status'

const mockToast = vi.fn()
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))
vi.mock('@/components/common/Toast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

// Calendar stub: shows the day view (work list) of the day under test plus the page's toolbar actions
const calendarDay = vi.hoisted(() => ({ value: '2026-09-25' }))
vi.mock('@/features/appointments/components/CalendarView', () => ({
  CalendarView: ({ renderDay, actions }: { renderDay?: (d: Date) => React.ReactNode; actions?: React.ReactNode }) => (
    <div data-testid="mock-calendar-view">
      {actions}
      {renderDay?.(new Date(`${calendarDay.value}T00:00:00`))}
    </div>
  ),
}))

// Supabase data layer: local cache stays real; every call that would go to Supabase is mocked
// and reads/writes the same local cache, so the page never needs a network.
const mockSupabase = vi.hoisted(() => ({
  fetchAppointmentsFromSupabase: vi.fn(),
  fetchAppointmentHistory: vi.fn(),
  addAppointment: vi.fn(),
  updateAppointment: vi.fn(),
  setAppointmentStatus: vi.fn(),
}))
vi.mock('@/features/appointments/services/appointment-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/appointments/services/appointment-storage')>()
  return { ...actual, ...mockSupabase }
})

// Dispatch / steps (work_order only) are their own service; LINE is reported by it
const mockDispatch = vi.hoisted(() => ({
  dispatchToDriver: vi.fn(),
  recordWorkOrderStep: vi.fn(),
  deleteJob: vi.fn(),
  unassignDriver: vi.fn(),
  fetchDriverTaskState: vi.fn(async () => null),
}))
vi.mock('@/features/appointments/services/dispatch-service', () => mockDispatch)

// Driver list lives in store_settings.policies.delivery_drivers (Settings › LINE)
import { setCachedPolicies } from '@/lib/db/policies'

vi.mock('@/features/customers/services/customer-storage', () => ({
  loadCustomers: () => [
    { id: 'cust-1', customerName: 'บริษัท ทดสอบ จำกัด', phone: '0811111111' },
  ],
}))

describe('MASTER Appointment & Work Order Flow Tests', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    calendarDay.value = '2026-09-25'
    mockSupabase.fetchAppointmentsFromSupabase.mockImplementation(async () => loadAppointments())
    mockSupabase.fetchAppointmentHistory.mockResolvedValue([])
    setCachedPolicies({})
    for (const write of [mockSupabase.addAppointment, mockSupabase.updateAppointment, mockSupabase.setAppointmentStatus]) {
      write.mockImplementation(async () => loadAppointments())
    }
    mockDispatch.dispatchToDriver.mockImplementation(async () => ({ appointments: loadAppointments(), lineSent: false, lineNote: 'LINE อยู่ในโหมดทดสอบ ยังไม่ได้ส่งจริง', withdrawNote: '' }))
    mockDispatch.recordWorkOrderStep.mockImplementation(async () => loadAppointments())
    // the job is deleted / the driver taken off: the cache follows the server answer
    mockDispatch.deleteJob.mockImplementation(async (apt: Appointment) => {
      saveAppointments(loadAppointments().filter((a) => a.id !== apt.id))
      return { appointments: loadAppointments(), note: '', lineOk: true }
    })
    mockDispatch.unassignDriver.mockImplementation(async (apt: Appointment) => {
      saveAppointments(loadAppointments().map((a) => (a.id === apt.id ? { ...a, driverId: undefined, driverName: undefined, events: [...(a.events ?? []), { id: 'w', stage: 'WITHDRAW', status: 'DONE' }] } : a)))
      return { appointments: loadAppointments(), note: 'แจ้งพนักงานทาง LINE แล้ว', lineOk: true }
    })
  })

  afterEach(cleanup)

  /** Day view row -> the one side panel, on the given tab. */
  const openJob = async (title: string, tab: 'รายละเอียด' | 'สถานะ' = 'รายละเอียด') => {
    fireEvent.click(await screen.findByText(title))
    const panel = await screen.findByRole('complementary', { name: 'รายละเอียดงาน' })
    if (tab === 'สถานะ') fireEvent.click(within(panel).getByRole('button', { name: 'สถานะ' }))
    return panel
  }

  it('หน้านัดหมายไม่มีแท็บหลักซ้ำ (งานวันนี้/พรุ่งนี้/ทั้งหมด) และเปิดได้ทีละแผงเดียว', async () => {
    saveAppointments([
      { id: 'apt-0', title: 'งาน X', customerName: 'ก', date: '2026-09-25', startTime: '09:00', endTime: '10:00', type: 'DELIVERY', status: 'SCHEDULED' },
    ])
    render(<AppointmentsPage />)
    await screen.findByText('งาน X')
    for (const name of ['งานวันนี้', 'งานพรุ่งนี้', 'งานทั้งหมด']) expect(screen.queryByRole('button', { name })).toBeNull()

    await openJob('งาน X')
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข' }))
    // the edit form replaces the details in the same panel: no dialog on top
    expect(screen.getByRole('complementary', { name: 'แก้ไขนัดหมาย' })).toBeDefined()
    expect(screen.queryByRole('complementary', { name: 'รายละเอียดงาน' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('สถานะงานคำนวณเอง: ยังไม่สั่งงานตามเวลา / สั่งงานแล้ว = กำลังดำเนินการ / ยกเลิกคงสถานะสิ้นสุด', async () => {
    const at = (date: string, startTime: string, endTime: string) => ({ date, startTime, endTime, status: 'SCHEDULED' as const })
    const now = new Date('2026-10-10T10:30:00')
    expect(jobStatusOf(at('2026-10-10', '11:00', '12:00'), now)).toBe('WAITING')
    expect(jobStatusOf(at('2026-10-10', '10:00', '11:00'), now)).toBe('DUE')
    expect(jobStatusOf(at('2026-10-10', '09:00', '10:00'), now)).toBe('OVERDUE')
    expect(jobStatusOf({ ...at('2026-10-10', '09:00', '10:00'), events: [{ stage: 'DISPATCH', status: 'DONE' }] }, now)).toBe('IN_PROGRESS')
    expect(jobStatusOf({ ...at('2026-10-10', '11:00', '12:00'), status: 'CANCELLED', events: [{ stage: 'DISPATCH', status: 'DONE' }] }, now)).toBe('CANCELLED')
    expect(jobStatusOf({ ...at('2026-10-10', '11:00', '12:00'), status: 'COMPLETED' }, now)).toBe('COMPLETED')

    saveAppointments([
      { id: 'apt-s1', title: 'งานเลยเวลา', customerName: 'ก', date: '2026-09-25', startTime: '09:00', endTime: '10:00', type: 'DELIVERY', status: 'CONFIRMED' },
      { id: 'apt-s2', title: 'งานสั่งแล้ว', customerName: 'ก', date: '2026-09-25', startTime: '11:00', endTime: '12:00', type: 'DELIVERY', status: 'SCHEDULED', events: [{ id: 'd', stage: 'DISPATCH', status: 'DONE' }] },
      { id: 'apt-s3', title: 'งานยกเลิก', customerName: 'ก', date: '2026-09-25', startTime: '13:00', endTime: '14:00', type: 'DELIVERY', status: 'CANCELLED' },
    ])
    render(<AppointmentsPage />)
    const rowOf = async (title: string) => (await screen.findByText(title)).closest('tr')!
    expect(within(await rowOf('งานเลยเวลา')).getByText('เลยกำหนด')).toBeDefined()
    expect(within(await rowOf('งานสั่งแล้ว')).getByText('กำลังดำเนินการ')).toBeDefined()
    expect(within(await rowOf('งานยกเลิก')).getByText('ยกเลิก')).toBeDefined()
    expect(screen.queryByText('ประเภทงาน')).toBeNull()
  })

  it('UI: การ์ดสรุปเรียงใหม่ สีตามการ์ด, เลยกำหนดนับเฉพาะงานเลยกำหนดจริง, กำหนดการรูปแบบไทย, หัวตารางขั้นตอน', async () => {
    saveAppointments([
      { id: 'k1', title: 'เลยเวลาไม่สั่งงาน', customerName: 'ก', date: '2026-09-25', startTime: '09:00', endTime: '10:00', type: 'DELIVERY', status: 'SCHEDULED' },
      { id: 'k2', title: 'เลยเวลาแต่สั่งงานแล้ว', customerName: 'ก', date: '2026-09-25', startTime: '11:00', endTime: '12:00', type: 'DELIVERY', status: 'SCHEDULED', events: [{ id: 'd', stage: 'DISPATCH', status: 'DONE' }] },
      { id: 'k3', title: 'เลยเวลาแต่เสร็จแล้ว', customerName: 'ก', date: '2026-09-25', startTime: '13:00', endTime: '14:00', type: 'DELIVERY', status: 'COMPLETED' },
      { id: 'k4', title: 'งานอนาคต', customerName: 'ก', date: '2099-01-01', startTime: '09:00', endTime: '10:00', type: 'DELIVERY', status: 'SCHEDULED' },
    ])
    render(<AppointmentsPage />)
    await screen.findByText('เลยเวลาไม่สั่งงาน')
    const cards = screen.getAllByTestId('kpi-card')
    expect(cards.map((c) => c.firstElementChild!.textContent)).toEqual(['งานวันนี้', expect.stringMatching(/^ใกล้ถึงกำหนด \(\d+ วัน\)$/), 'เลยกำหนด', 'งานเสร็จสิ้น'])
    expect(cards.map((c) => (c.lastElementChild as HTMLElement).className.match(/text-(\w+)-600/)![1])).toEqual(['blue', 'purple', 'orange', 'emerald'])
    // Products card style: light background, border and label in the card's own colour
    for (const [i, tone] of ['blue', 'purple', 'orange', 'emerald'].entries()) {
      expect(cards[i].className).toContain(`bg-${tone}-50`)
      expect(cards[i].className).toContain(`border-${tone}-200/60`)
      expect((cards[i].firstElementChild as HTMLElement).className).toContain(`text-${tone}-700`)
    }
    expect(cards[2].lastElementChild!.textContent).toBe('1') // only the open, undispatched job past its time
    expect(cards[3].lastElementChild!.textContent).toBe('1')
    expect(screen.queryByText('งานค้าง')).toBeNull()

    const panel = await openJob('เลยเวลาไม่สั่งงาน')
    expect(within(panel).getByTestId('job-schedule').textContent).toBe('กำหนดการ 09:00 - 10:00 น. 25/09/2569')
    fireEvent.click(within(panel).getByRole('button', { name: 'สถานะ' }))
    expect(within(panel).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['ขั้นตอนงาน', 'เวลา', 'สถานะ'])
    expect(within(panel).getAllByText('ยังไม่มีข้อมูล').length).toBe(9)
  })

  it('รายละเอียดงาน: ชื่องาน/สถานะ, ลูกค้า, สถานที่จัดส่งของงานนี้, กำหนดการ, ตารางสินค้า และปุ่ม แก้ไข/ยกเลิกงาน/สั่งงาน', async () => {
    saveAppointments([
      {
        id: 'apt-d1', title: 'ส่งสินค้า ไซต์ A', customerName: 'บริษัท ทดสอบ จำกัด', phone: '0811111111', date: '2026-09-25', startTime: '09:00', endTime: '10:00',
        type: 'DELIVERY', status: 'SCHEDULED', location: 'ไซต์งานบางนา', details: 'โทรก่อนเข้า',
        items: [{ id: 'p1', name: 'ขาตั้งนั่งร้าน', quantity: 20, unit: 'ต้น' }],
      },
      { id: 'apt-d2', title: 'เก็บแบบ', customerName: 'คุณบี', date: '2026-09-25', startTime: '11:00', endTime: '12:00', type: 'DELIVERY', status: 'SCHEDULED', details: 'เก็บแบบเหล็ก 30 แผ่น' },
    ])
    render(<AppointmentsPage />)
    let panel = await openJob('ส่งสินค้า ไซต์ A')
    expect(within(panel).getByTestId('job-status').textContent).toBe('เลยกำหนด')
    expect(within(panel).getByText('ไซต์งานบางนา')).toBeDefined()
    expect(within(panel).getByText('ขาตั้งนั่งร้าน')).toBeDefined()
    expect(within(panel).getByText('20 ต้น')).toBeDefined()
    expect(within(panel).queryByText('โทรก่อนเข้า')).toBeNull() // items shown: the table replaces the details text
    expect(within(panel).queryByText(/ขั้นตอนถัดไป/)).toBeNull()
    expect(within(panel).queryByText('ปิดหน้าต่าง')).toBeNull() // only the X closes the panel
    for (const name of ['แก้ไข', 'ยกเลิกงาน', 'สั่งงาน']) expect(within(panel).getByRole('button', { name })).toBeDefined()

    fireEvent.click(await screen.findByText('เก็บแบบ'))
    panel = await screen.findByRole('complementary', { name: 'รายละเอียดงาน' })
    expect(within(panel).getByText('เก็บแบบเหล็ก 30 แผ่น')).toBeDefined() // no items: the details text is shown
    expect(within(panel).getByText('ไม่ได้ระบุสถานที่')).toBeDefined() // the customer address is never shown in its place

    fireEvent.click(within(panel).getByRole('button', { name: 'ปิดหน้าต่าง' }))
    expect(screen.queryByRole('complementary', { name: 'รายละเอียดงาน' })).toBeNull()
  })

  it('ไม่มีพนักงานจริง -> สั่งงานไม่ได้ (ปุ่ม disabled และไม่มีรายชื่อพนักงานปลอม)', async () => {
    const apt: Appointment = {
      id: 'apt-1',
      title: 'งานส่งอุปกรณ์ A',
      customerName: 'บริษัท กสทช.',
      date: '2026-09-25',
      startTime: '09:00',
      endTime: '11:00',
      type: 'DELIVERY',
      status: 'SCHEDULED',
    }
    saveAppointments([apt])
    render(<AppointmentsPage />)

    const panel = await openJob('งานส่งอุปกรณ์ A')
    fireEvent.click(within(panel).getByRole('button', { name: 'สั่งงาน' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('ยังไม่มีข้อมูลพนักงาน')).toBeDefined()
    // LINE is not presented as working, and LINE Notify (closed) is not offered
    expect(within(dialog).getByText(/ยังส่งไม่ได้/)).toBeDefined()
    expect(within(dialog).queryByText(/LINE Notify/)).toBeNull()

    const modalDispatchBtn = within(dialog).getByRole('button', { name: /สั่งงาน \(ยังไม่มีข้อมูลพนักงาน\)/ }) as HTMLButtonElement
    expect(modalDispatchBtn.disabled).toBe(true)
    fireEvent.click(modalDispatchBtn)
    expect(mockSupabase.updateAppointment).not.toHaveBeenCalled()
    expect(mockDispatch.dispatchToDriver).not.toHaveBeenCalled()
    expect(mockSupabase.setAppointmentStatus).not.toHaveBeenCalled()

    const stored = loadAppointments()
    expect(stored[0].assigneeId).toBeUndefined()
    expect(stored[0].events).toBeUndefined()
  })

  it('ไม่มี events -> แท็บสถานะแสดง "ยังไม่มีข้อมูล" และไม่ mark ขั้นว่าเสร็จ', async () => {
    saveAppointments([
      {
        id: 'apt-2',
        title: 'งานรับคืนอุปกรณ์ B',
        customerName: 'บริษัท ทีโอที จำกัด',
        date: '2026-09-25',
        startTime: '13:00',
        endTime: '15:00',
        type: 'RETURN',
        status: 'SCHEDULED',
        events: [],
      },
    ])
    render(<AppointmentsPage />)
    const panel = await openJob('งานรับคืนอุปกรณ์ B', 'สถานะ')

    expect(within(panel).getByText('1. สั่งงานเก็บ')).toBeDefined()
    expect(within(panel).getByText('3. ออกเก็บ')).toBeDefined()
    expect(within(panel).getByText('8. รับคืนสินค้า')).toBeDefined()
    expect(within(panel).getAllByText('ยังไม่มีข้อมูล').length).toBe(9)
    expect(within(panel).getAllByText('—').length).toBe(9)
    expect(within(panel).queryByText('ประวัติงาน')).toBeNull()
    // not dispatched yet: the job cannot be closed
    expect((within(panel).getByRole('button', { name: 'ปิดงาน' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('มี events -> แท็บสถานะแสดงข้อมูลเหตุการณ์จริงครบ และประวัติเรียงตามเวลา', async () => {
    mockSupabase.fetchAppointmentHistory.mockResolvedValue([])
    saveAppointments([
      {
        id: 'apt-3',
        title: 'งานส่งอุปกรณ์ไซต์งาน C',
        customerName: 'บริษัท พระราม 9 คอนสตรัคชั่น',
        date: '2026-09-25',
        startTime: '10:00',
        endTime: '12:00',
        type: 'DELIVERY',
        status: 'IN_PROGRESS',
        events: [
          {
            id: 'ev-1',
            stage: 'DISPATCH',
            status: 'DONE',
            by: 'หัวหน้างาน สมชาย',
            timestamp: '2026-09-25 09:30',
            note: 'จัดเตรียมเอกสารส่งของครบ',
            actualQuantity: 10,
            issues: 'ไม่มีปัญหา',
            images: ['https://example.com/img1.jpg'],
          },
          { id: 'ev-2', stage: 'ARRIVED', status: 'PENDING', by: 'คนขับ นพดล', timestamp: '2026-09-25 10:15', issues: 'ติดรอหน้าไซด์งาน 15 นาที' },
        ],
      },
    ])
    render(<AppointmentsPage />)
    const panel = await openJob('งานส่งอุปกรณ์ไซต์งาน C', 'สถานะ')

    expect(within(panel).getByText('โดย หัวหน้างาน สมชาย')).toBeDefined()
    expect(within(panel).getByText('หมายเหตุ: จัดเตรียมเอกสารส่งของครบ')).toBeDefined()
    expect(within(panel).getByText('จำนวนจริง: 10')).toBeDefined()
    expect(within(panel).getByText('ปัญหา: ไม่มีปัญหา')).toBeDefined()
    expect((within(panel).getByAltText('event-img-0') as HTMLImageElement).src).toBe('https://example.com/img1.jpg')
    expect(within(panel).getByText('โดย คนขับ นพดล')).toBeDefined()
    expect(within(panel).getByText('ปัญหา: ติดรอหน้าไซด์งาน 15 นาที')).toBeDefined()
    expect(within(panel).getAllByText('ยังไม่มีข้อมูล').length).toBe(7)
    // row = step | time | status, from the recorded events only
    const dispatchRow = panel.querySelector('[data-stage-key="DISPATCH"]') as HTMLElement
    expect(within(dispatchRow).getByText('1. สั่งงาน')).toBeDefined()
    expect(within(dispatchRow).getByText('09:30')).toBeDefined()
    expect(within(dispatchRow).getByText('กำลังดำเนินการ')).toBeDefined()
    const prepareRow = panel.querySelector('[data-stage-key="PREPARE"]') as HTMLElement
    expect(within(prepareRow).getByText('—')).toBeDefined()
    expect(within(prepareRow).getByText('ยังไม่มีข้อมูล')).toBeDefined()
    expect(within(panel).queryByText('ประวัติงาน')).toBeNull()
  })

  it('นัดหมายเปิด POS เพื่อสร้างบิลพร้อมข้อมูลนัดหมาย โดยไม่สร้างบิลหรือ assignee/event ปลอมเอง', async () => {
    saveAppointments([
      { id: 'apt-4', title: 'งานติดตั้งตลับเมตร D', customerName: 'คุณสมศักดิ์', date: '2026-09-25', startTime: '14:00', endTime: '15:00', type: 'DELIVERY', status: 'SCHEDULED' },
    ])
    render(<AppointmentsPage />)
    await openJob('งานติดตั้งตลับเมตร D')

    fireEvent.click(within(screen.getByRole('complementary', { name: 'รายละเอียดงาน' })).getByRole('button', { name: 'สร้างบิล' }))
    expect(mockPush).toHaveBeenCalledWith('/pos?appointmentId=apt-4')
    expect(screen.queryByRole('button', { name: 'ดูบิล' })).toBeNull()
    const current = loadAppointments()
    expect(current[0].billId).toBeUndefined()
    expect(current[0].assigneeId).toBeUndefined()
    expect(current[0].events).toBeUndefined()
  })

  it('นัดหมายที่เชื่อมบิลแล้วเปิดบิลเดิมแทนการสร้างบิลซ้ำ', async () => {
    saveAppointments([
      {
        id: 'apt-linked',
        title: 'งานที่มีบิลแล้ว',
        customerName: 'คุณสมศักดิ์',
        date: '2026-09-25',
        startTime: '14:00',
        endTime: '15:00',
        type: 'DELIVERY',
        status: 'SCHEDULED',
        billId: 'bill-1',
        billNo: 'BL-001',
      },
    ])
    render(<AppointmentsPage />)
    const panel = await openJob('งานที่มีบิลแล้ว')

    expect(within(panel).queryByRole('button', { name: 'สร้างบิล' })).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'ดูบิล' }))
    expect(mockPush).toHaveBeenCalledWith('/bills?id=bill-1')
  })

  it('รายละเอียด › ยกเลิกงาน: ยืนยันในแผงเดียวกันแล้วลบงานจริง งานหายจากรายการและแผงปิด', async () => {
    saveAppointments([
      { id: 'apt-6', title: 'งาน E', customerName: 'ข', date: '2026-09-25', startTime: '09:00', endTime: '10:00', type: 'DELIVERY', status: 'SCHEDULED' },
    ])
    render(<AppointmentsPage />)
    const panel = await openJob('งาน E')
    fireEvent.click(within(panel).getByRole('button', { name: 'ยกเลิกงาน' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(panel).getByText(/ลบงานนี้ออกจากระบบถาวร/)).toBeDefined()
    fireEvent.click(within(panel).getByRole('button', { name: 'ยืนยันลบงาน' }))
    await waitFor(() => expect(mockDispatch.deleteJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'apt-6' })))
    await waitFor(() => expect(screen.queryByText('งาน E')).toBeNull())
    expect(screen.queryByRole('complementary', { name: 'รายละเอียดงาน' })).toBeNull()
    expect(mockSupabase.setAppointmentStatus).not.toHaveBeenCalled()
    expect(mockDispatch.unassignDriver).not.toHaveBeenCalled()
  })

  it('สั่งงาน: เลือกคนขับจากทะเบียน (ไม่ใช่ผู้ใช้ระบบ) -> บันทึกคนขับ + ขั้น "สั่งงาน" และไม่อ้างว่าส่ง LINE แล้ว', async () => {
    setCachedPolicies({
      delivery_drivers: [
        { id: 'D001', name: 'สมชาย', phone: '0812345678', active: true },
        { id: 'D002', name: 'ปิดแล้ว', active: false },
      ],
    })
    calendarDay.value = '2026-10-10'
    saveAppointments([
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        title: 'ส่งโต๊ะงานบวช',
        customerName: 'คุณมาลี',
        date: '2026-10-10',
        startTime: '09:00',
        endTime: '10:00',
        type: 'DELIVERY',
        status: 'SCHEDULED',
      },
    ])
    render(<AppointmentsPage />)
    const panel = await openJob('ส่งโต๊ะงานบวช')
    fireEvent.click(within(panel).getByRole('button', { name: 'สั่งงาน' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.click(await within(dialog).findByText('เลือกคนขับ'))
    expect(screen.queryByText('D002 ปิดแล้ว')).toBeNull() // switched-off drivers are not offered
    fireEvent.click(await screen.findByText('D001 สมชาย'))
    const send = within(dialog).getByRole('button', { name: 'สั่งงาน' }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)

    await waitFor(() => expect(mockDispatch.dispatchToDriver).toHaveBeenCalledTimes(1))
    const [apt, driver] = mockDispatch.dispatchToDriver.mock.calls[0] as [Appointment, { id: string; name: string }]
    expect(apt.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(driver).toMatchObject({ id: 'D001', name: 'สมชาย' }) // a driver code, never a profiles.id
    expect(mockSupabase.updateAppointment).not.toHaveBeenCalled() // details are not re-saved by a dispatch
    // LINE is not claimed as sent unless the LINE API answered OK
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('บันทึกการสั่งงานแล้ว', expect.stringContaining('ยังไม่ได้ส่งทาง LINE (LINE อยู่ในโหมดทดสอบ'), 'SUCCESS'))
  })

  it('สถานะงาน: ร้านไม่มีปุ่มอัปเดตขั้นเอง (พนักงานอัปเดตทาง LINE) และพนักงานใหม่เริ่มที่รับงานใหม่', async () => {
    calendarDay.value = '2026-10-10'
    saveAppointments([
      {
        id: 'apt-5', title: 'ส่งเต็นท์', customerName: 'คุณวิชัย', date: '2026-10-10', startTime: '13:00', endTime: '14:00', type: 'DELIVERY', status: 'SCHEDULED',
        events: [
          { id: 'e1', stage: 'DISPATCH', status: 'DONE', by: 'เจ้าของ', timestamp: '2026-10-10T05:00:00Z' },
          { id: 'e2', stage: 'ACCEPT', status: 'DONE', by: 'คนเก่า (LINE)', timestamp: '2026-10-10T05:01:00Z' },
          { id: 'e3', stage: 'PREPARE', status: 'DONE', by: 'คนเก่า (LINE)', timestamp: '2026-10-10T05:02:00Z' },
          { id: 'e4', stage: 'DISPATCH', status: 'DONE', by: 'เจ้าของ', timestamp: '2026-10-10T05:10:00Z' },
          { id: 'e5', stage: 'ACCEPT', status: 'DONE', by: 'คนใหม่ (LINE)', timestamp: '2026-10-10T05:11:00Z' },
        ],
      },
    ])
    render(<AppointmentsPage />)
    const panel = await openJob('ส่งเต็นท์', 'สถานะ')
    expect(within(panel).queryByRole('button', { name: /อัปเดตงาน/ })).toBeNull()
    expect(within(panel).queryByPlaceholderText('หมายเหตุ (ถ้ามี)')).toBeNull()
    for (const name of ['ยกเลิกงาน', 'ปิดงาน']) expect(within(panel).getByRole('button', { name })).toBeDefined()
    const row = (key: string) => panel.querySelector(`[data-stage-key="${key}"]`) as HTMLElement
    expect(within(row('ACCEPT')).getByText('โดย คนใหม่ (LINE)')).toBeDefined()
    expect(within(row('PREPARE')).getByText('ยังไม่มีข้อมูล')).toBeDefined() // the old driver's step is history, not this dispatch
  })

  it('สถานะ › ยกเลิกงาน: ถอนงานจากพนักงาน งานยังอยู่ กลับมาสั่งงานใหม่ได้ (ไม่ลบงาน)', async () => {
    saveAppointments([
      { id: 'apt-7', title: 'งาน F', customerName: 'ค', date: '2026-09-25', startTime: '09:00', endTime: '10:00', type: 'DELIVERY', status: 'SCHEDULED', driverId: 'D001', driverName: 'สมชาย', events: [{ id: 'd', stage: 'DISPATCH', status: 'DONE' }] },
    ])
    render(<AppointmentsPage />)
    const panel = await openJob('งาน F', 'สถานะ')
    expect(within(panel).queryByTestId('job-status')).toBeNull() // status tab: no duplicate title / status box
    fireEvent.click(within(panel).getByRole('button', { name: 'รายละเอียด' }))
    expect(within(panel).getByTestId('job-status').textContent).toBe('กำลังดำเนินการ')
    fireEvent.click(within(panel).getByRole('button', { name: 'สถานะ' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'ยกเลิกงาน' }))
    expect(within(panel).getByText(/ถอนงานจากพนักงานคนนี้/)).toBeDefined()
    fireEvent.click(within(panel).getByRole('button', { name: 'ยืนยันถอนงาน' }))
    await waitFor(() => expect(mockDispatch.unassignDriver).toHaveBeenCalledWith(expect.objectContaining({ id: 'apt-7' })))
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('แจ้งพนักงานทาง LINE', 'แจ้งพนักงานทาง LINE แล้ว', 'INFO'))
    // the job stays, without a driver: back to waiting, ยกเลิกงาน (status tab) is off until a new dispatch
    expect(within(panel).queryByTestId('job-status')).toBeNull() // status tab: no duplicate title / status box
    fireEvent.click(within(panel).getByRole('button', { name: 'รายละเอียด' }))
    expect(within(panel).getByTestId('job-status').textContent).toBe('เลยกำหนด')
    fireEvent.click(within(panel).getByRole('button', { name: 'สถานะ' }))
    expect(within(panel).queryByText(/ผู้รับผิดชอบ/)).toBeNull() // no driver: the line is not shown
    expect((within(panel).getByRole('button', { name: 'ยกเลิกงาน' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mockDispatch.deleteJob).not.toHaveBeenCalled()
    expect(mockSupabase.setAppointmentStatus).not.toHaveBeenCalled()
  })

  it('ปิดงาน: หลังสั่งงานแล้ว ยืนยันในแผงเดียวกัน แล้วบันทึกสถานะเสร็จ (ไม่แตะบิลหรือสต็อก)', async () => {
    calendarDay.value = '2026-10-10'
    saveAppointments([
      {
        id: 'apt-c1', title: 'ส่งเก้าอี้', customerName: 'คุณดี', date: '2026-10-10', startTime: '13:00', endTime: '14:00', type: 'DELIVERY', status: 'SCHEDULED',
        events: [{ id: 'e1', stage: 'DISPATCH', status: 'DONE', by: 'เจ้าของ' }],
      },
    ])
    render(<AppointmentsPage />)
    const panel = await openJob('ส่งเก้าอี้', 'สถานะ')
    expect(within(panel).queryByTestId('job-status')).toBeNull() // status tab: no duplicate title / status box
    fireEvent.click(within(panel).getByRole('button', { name: 'รายละเอียด' }))
    expect(within(panel).getByTestId('job-status').textContent).toBe('กำลังดำเนินการ')
    fireEvent.click(within(panel).getByRole('button', { name: 'สถานะ' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'ปิดงาน' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'ยืนยันปิดงาน' }))
    await waitFor(() => expect(mockSupabase.setAppointmentStatus).toHaveBeenCalledWith('apt-c1', 'COMPLETED', ''))
    expect(mockSupabase.updateAppointment).not.toHaveBeenCalled()
    expect(mockDispatch.recordWorkOrderStep).not.toHaveBeenCalled()
  })
})

describe('Driver list (ทะเบียนคนขับ)', () => {
  it('reads only valid drivers, numbers new drivers D001, D002 … and keeps the driver in work_order', async () => {
    const { setCachedPolicies } = await import('@/lib/db/policies')
    const { loadDrivers, nextDriverId } = await import('@/features/appointments/services/driver-registry')
    const { dbAppointmentToDomain } = await import('@/features/appointments/services/appointment-storage')
    setCachedPolicies({ delivery_drivers: [{ id: 'D001', name: 'สมชาย' }, { id: '', name: 'x' }, 'junk', { id: 'D007', name: 'แดง', active: false }] })
    const list = loadDrivers()
    expect(list.map((d) => [d.id, d.active])).toEqual([['D001', true], ['D007', false]])
    expect(nextDriverId(list)).toBe('D008')
    expect(nextDriverId([])).toBe('D001')
    const apt = dbAppointmentToDomain({
      id: 'a', appointment_no: 'AP1', appointment_type: 'DELIVERY', customer_id: null, bill_id: null, related_entity_type: null,
      related_entity_id: null, title: 't', description: null, start_datetime: '2026-10-10T02:00:00Z', end_datetime: '2026-10-10T03:00:00Z',
      location: null, contact_name: null, contact_phone: null, assigned_user_id: null, priority: 'NORMAL', status: 'SCHEDULED',
      work_order: { events: [], driver: { id: 'D001', name: 'สมชาย' } }, created_at: '2026-10-09T00:00:00Z',
    } as Parameters<typeof dbAppointmentToDomain>[0])
    expect(apt).toMatchObject({ driverId: 'D001', driverName: 'สมชาย' })
  })

})
