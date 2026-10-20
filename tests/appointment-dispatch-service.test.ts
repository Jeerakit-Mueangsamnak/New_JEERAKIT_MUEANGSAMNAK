import { beforeEach, describe, expect, it, vi } from 'vitest'

// Server row of the appointment as the database holds it now; every read returns it.
const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  line: vi.fn(),
  withdraw: vi.fn(async () => ({ success: true, data: { withdrawn: 0, queued: 0, unreachable: 0, sent: 0, mode: 'mock' } })),
  del: vi.fn(),
  notices: vi.fn(async () => []),
}))
vi.mock('@/features/notifications/services/notification-storage', () => ({ fetchNotificationsFromSupabase: db.notices }))
vi.mock('@/lib/supabase/client', () => {
  const chain: Record<string, unknown> = {}
  for (const k of ['from', 'select', 'eq', 'limit', 'order', 'not']) chain[k] = () => chain
  return { createClient: () => chain }
})
vi.mock('@/lib/db/rpc', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/rpc')>()
  return {
    ...actual,
    rpc: db.rpc,
    // the appointment row for a by-id read; the list read gets the same single row
    selectRows: vi.fn(async () => (db.row ? [db.row] : [])),
  }
})
vi.mock('@/app/actions/line', () => ({ sendDispatchToDriver: db.line, withdrawDriverTasks: db.withdraw, deleteAppointmentJob: db.del }))

import { DbError } from '@/lib/db/rpc'
import { APPOINTMENT_GUARD_MISSING, APPOINTMENT_MISSING, APPOINTMENT_STALE, updateAppointment } from '@/features/appointments/services/appointment-storage'
import { deleteJob, dispatchToDriver, recordWorkOrderStep, unassignDriver } from '@/features/appointments/services/dispatch-service'
import type { Appointment } from '@/lib/types/rental-pos'

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const baseRow = () => ({
  id: ID, appointment_no: 'AP1', appointment_type: 'DELIVERY', customer_id: null, bill_id: null, related_entity_type: null,
  related_entity_id: null, title: 'ส่งโต๊ะ · คุณมาลี', description: null, start_datetime: '2026-10-10T02:00:00Z',
  end_datetime: '2026-10-10T03:00:00Z', location: null, contact_name: 'คุณมาลี', contact_phone: null, assigned_user_id: null,
  priority: 'NORMAL', status: 'SCHEDULED', created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-10T01:00:00.123456+00:00',
  work_order: { items: [], events: [{ id: 'e-1', stage: 'DISPATCH', status: 'DONE', by: 'เจ้าของ' }], driver: { id: 'D001', name: 'สมชาย' } },
})
const savedData = () => {
  const call = db.rpc.mock.calls.find(([fn]) => fn === 'appointment_save_guarded' || fn === 'appointment_save')
  return call?.[1] as { p_data: { work_order: { events: Array<{ id: string; stage: string }>; driver?: { id: string } } }; p_expected_updated_at?: string }
}
const screenCopy = (over: Partial<Appointment> = {}): Appointment => ({
  id: ID, title: 'ส่งโต๊ะ · คุณมาลี', customerName: 'คุณมาลี', date: '2026-10-10', startTime: '09:00', endTime: '10:00',
  type: 'DELIVERY', status: 'SCHEDULED', updatedAt: '2026-10-10T01:00:00.123456+00:00', ...over,
})

describe('Appointment save: no silent create, no lost update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.row = baseRow()
    db.rpc.mockResolvedValue({})
  })

  it('a row that is gone is refused (never re-created as a new appointment)', async () => {
    db.row = null
    await expect(updateAppointment(screenCopy())).rejects.toThrow(APPOINTMENT_MISSING)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('a row changed since the screen loaded it is refused', async () => {
    await expect(updateAppointment(screenCopy({ updatedAt: '2026-10-10T00:59:00Z' }))).rejects.toThrow(APPOINTMENT_STALE)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('saves with the server version, keeps saved steps and the driver the form does not edit', async () => {
    await updateAppointment(screenCopy({ details: 'แก้รายละเอียด', events: [] }))
    const data = savedData()
    expect(db.rpc.mock.calls[0][0]).toBe('appointment_save_guarded')
    expect(data.p_expected_updated_at).toBe('2026-10-10T01:00:00.123456+00:00')
    expect(data.p_data.work_order.events.map((e) => e.id)).toEqual(['e-1'])
    expect(data.p_data.work_order.driver).toEqual({ id: 'D001', name: 'สมชาย' })
  })

  it('the database refusing a stale save shows the refresh message', async () => {
    db.rpc.mockRejectedValueOnce(new DbError('APPOINTMENT_STALE', '40001'))
    await expect(updateAppointment(screenCopy())).rejects.toThrow(APPOINTMENT_STALE)
  })

  it('without the guarded save on the database the edit is refused (the plain save is never a fallback)', async () => {
    db.rpc.mockRejectedValueOnce(new DbError('Could not find the function public.appointment_save_guarded', 'PGRST202'))
    await expect(updateAppointment(screenCopy())).rejects.toThrow(APPOINTMENT_GUARD_MISSING)
    expect(db.rpc.mock.calls.map(([fn]) => fn)).toEqual(['appointment_save_guarded'])
  })
})

describe('Work-order steps and dispatch (separate from appointment details)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.row = baseRow()
    db.rpc.mockResolvedValue({})
  })

  it('appends a step to what the server holds (history is never rewritten)', async () => {
    await recordWorkOrderStep(ID, { stage: 'ACCEPT', note: 'รับแล้ว', by: 'แอดมิน' })
    const data = savedData()
    expect(Object.keys(data.p_data)).toEqual(['work_order'])
    expect(data.p_data.work_order.events.map((e) => [e.id === 'e-1' ? 'e-1' : 'new', e.stage])).toEqual([['e-1', 'DISPATCH'], ['new', 'ACCEPT']])
  })

  it('a step someone already recorded is refused, not duplicated', async () => {
    db.row = { ...baseRow(), work_order: { events: [{ id: 'e-2', stage: 'ACCEPT', status: 'DONE' }] } }
    await expect(recordWorkOrderStep(ID, { stage: 'ACCEPT' })).rejects.toThrow(APPOINTMENT_STALE)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('dispatch saves the driver code first, then sends to LINE; mock / failure is never shown as sent', async () => {
    db.line.mockResolvedValueOnce({ success: true, data: { task_id: 't', duplicate: false, status: 'PENDING', mode: 'mock' } })
    const r = await dispatchToDriver(screenCopy(), { id: 'D002', name: 'สมศักดิ์', active: true }, 'แอดมิน')
    expect(savedData().p_data.work_order.driver).toEqual({ id: 'D002', name: 'สมศักดิ์' })
    expect(db.line).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: ID, driverCode: 'D002' }))
    expect(r).toMatchObject({ lineSent: false, lineNote: expect.stringContaining('โหมดทดสอบ') })

    db.line.mockResolvedValueOnce({ success: false, error: 'ผู้รับยังไม่ได้ผูก LINE' })
    expect(await dispatchToDriver(screenCopy(), { id: 'D002', name: 'สมศักดิ์', active: true })).toMatchObject({ lineSent: false, lineNote: 'ผู้รับยังไม่ได้ผูก LINE' })

    db.line.mockResolvedValueOnce({ success: true, data: { task_id: 't', duplicate: false, status: 'SENT', mode: 'live' } })
    expect(await dispatchToDriver(screenCopy(), { id: 'D002', name: 'สมศักดิ์', active: true })).toMatchObject({ lineSent: true })
  })

  it('dispatch withdraws any other driver after saving the new one; the notice result is reported, not claimed', async () => {
    db.line.mockResolvedValueOnce({ success: true, data: { task_id: 't', duplicate: false, status: 'PENDING', mode: 'mock' } })
    db.withdraw.mockResolvedValueOnce({ success: true, data: { withdrawn: 1, queued: 1, unreachable: 0, sent: 0, mode: 'mock' } })
    const r = await dispatchToDriver(screenCopy(), { id: 'D002', name: 'สมศักดิ์', active: true })
    expect(db.withdraw).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: ID, kind: 'REASSIGN' }))
    expect(db.withdraw.mock.invocationCallOrder[0]).toBeGreaterThan(db.rpc.mock.invocationCallOrder[0]) // after the driver is saved
    expect(db.withdraw.mock.invocationCallOrder[0]).toBeLessThan(db.line.mock.invocationCallOrder[0]) // before the new job is sent
    expect(r.withdrawNote).toBe('ถอนสิทธิ์พนักงานคนเดิมแล้ว · LINE อยู่ในโหมดทดสอบ ยังไม่ได้ส่งจริง')

    db.line.mockResolvedValueOnce({ success: false, error: 'x' })
    db.withdraw.mockResolvedValueOnce({ success: true, data: { withdrawn: 0, queued: 0, unreachable: 0, sent: 0, mode: 'live' } })
    expect((await dispatchToDriver(screenCopy(), { id: 'D002', name: 'สมศักดิ์', active: true })).withdrawNote).toBe('')
  })

  it('details ยกเลิกงาน deletes the job; the driver notice is reported, not claimed', async () => {
    db.del.mockResolvedValueOnce({ success: true, data: { withdrawn: 1, queued: 1, unreachable: 0, sent: 1, mode: 'live' } })
    const r = await deleteJob(screenCopy())
    expect(db.del).toHaveBeenCalledWith({ appointmentId: ID, title: screenCopy().title })
    expect(r).toMatchObject({ note: 'แจ้งพนักงานทาง LINE แล้ว', lineOk: true })
    expect(db.notices).toHaveBeenCalledTimes(1) // the bell reloads: the deleted job's notices leave the list
    db.del.mockResolvedValueOnce({ success: false, error: 'งานนี้มีใบส่งของของบิลผูกอยู่ จึงลบไม่ได้ (เก็บเป็นหลักฐานบิลและสต็อก)' })
    await expect(deleteJob(screenCopy())).rejects.toThrow('ใบส่งของ')
    expect(db.rpc).not.toHaveBeenCalled() // no bill, payment or stock RPC
  })

  it('status ยกเลิกงาน takes the driver off (UNASSIGN); an unlinked driver is reported', async () => {
    db.withdraw.mockResolvedValueOnce({ success: true, data: { withdrawn: 1, queued: 0, unreachable: 1, sent: 0, mode: 'live' } })
    const r = await unassignDriver(screenCopy())
    expect(db.withdraw).toHaveBeenLastCalledWith({ appointmentId: ID, kind: 'UNASSIGN', title: screenCopy().title })
    expect(r.lineOk).toBe(false)
    expect(r.note).toContain('โทรศัพท์')
    expect(db.del).not.toHaveBeenCalled() // the job is not deleted
    expect(db.notices).not.toHaveBeenCalled() // notices are not touched by an unassign
  })

  it('never calls bill, payment or stock RPCs', async () => {
    db.line.mockResolvedValue({ success: false, error: 'x' })
    await recordWorkOrderStep(ID, { stage: 'ACCEPT' })
    await dispatchToDriver(screenCopy(), { id: 'D001', name: 'สมชาย', active: true })
    for (const [fn] of db.rpc.mock.calls) expect(fn).toMatch(/^appointment_save/)
  })
})
