/**
 * Dispatch (สั่งงาน) of an appointment. Appointment details (date, customer, items…) stay in
 * appointment-storage; this file writes only appointments.work_order.driver and the DISPATCH
 * step. The driver records the other steps from LINE (รับงาน, then one button per step; the
 * database appends each to work_order.events, the one record of job progress). Re-dispatch and
 * cancel withdraw the earlier driver's LINE job and tell him. Nothing here touches bills,
 * payments or stock: goods are handed over and returned in the bill's own steps.
 */
import { deleteAppointmentJob, sendDispatchToDriver, withdrawDriverTasks } from '@/app/actions/line'
import {
  APPOINTMENT_MISSING,
  APPOINTMENT_STALE,
  fetchAppointmentRow,
  fetchAppointmentsFromSupabase,
  mergeWorkOrder,
  saveExistingAppointment,
} from '@/features/appointments/services/appointment-storage'
import { fetchNotificationsFromSupabase } from '@/features/notifications/services/notification-storage'
import type { DeliveryDriver } from '@/features/appointments/services/driver-registry'
import type { Appointment, WorkOrderEvent } from '@/lib/types/rental-pos'

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Records one step as done, on top of what the server holds now. A step someone else already
 * recorded is refused (no duplicate), except DISPATCH, which is recorded again on re-dispatch.
 */
export async function recordWorkOrderStep(
  appointmentId: string,
  step: { stage: string; note?: string; by?: string },
  driver?: { id: string; name: string }
): Promise<Appointment[]> {
  const row = await fetchAppointmentRow(appointmentId)
  if (!row) throw new Error(APPOINTMENT_MISSING)
  const stage = step.stage.toUpperCase()
  const done = (row.work_order?.events ?? []).some((e) => e.stage.toUpperCase() === stage && e.status === 'DONE')
  if (done && stage !== 'DISPATCH') throw new Error(APPOINTMENT_STALE)
  const event: WorkOrderEvent = {
    id: newId(),
    stage,
    status: 'DONE',
    by: step.by,
    timestamp: new Date().toISOString(),
    note: step.note?.trim() || undefined,
  }
  const work_order = mergeWorkOrder(row.work_order, { events: [event], ...(driver ? { driver } : {}) })
  await saveExistingAppointment(appointmentId, { work_order }, row.updated_at)
  return fetchAppointmentsFromSupabase()
}

export interface DispatchOutcome {
  appointments: Appointment[]
  /** true only when LINE answered OK for the job message (live mode) */
  lineSent: boolean
  /** Why it was not sent on LINE (shown to the user); empty when sent */
  lineNote: string
  /** The earlier driver's job was withdrawn: what happened to the notice (empty when nobody was withdrawn) */
  withdrawNote: string
}

type WithdrawOutcome = Awaited<ReturnType<typeof withdrawDriverTasks>>

/** Plain words for the withdraw / cancel notice; empty when no driver had an open LINE job. */
function withdrawNoteOf(r: WithdrawOutcome, who: string): { ok: boolean; note: string } {
  if (!r.success || !r.data) return { ok: false, note: `แจ้ง${who}ทาง LINE ไม่สำเร็จ (${r.error || 'ลองใหม่อีกครั้ง'})` }
  const d = r.data
  if (d.withdrawn === 0) return { ok: true, note: '' }
  if (d.unreachable > 0 && d.queued === 0) return { ok: false, note: `${who}ยังไม่ได้ผูก LINE หรือบล็อก LINE ร้าน กรุณาแจ้งทางโทรศัพท์` }
  if (d.mode !== 'live') return { ok: true, note: `ถอนสิทธิ์${who}แล้ว · LINE อยู่ในโหมดทดสอบ ยังไม่ได้ส่งจริง` }
  if (d.sent >= d.queued) return { ok: true, note: `แจ้ง${who}ทาง LINE แล้ว` }
  return { ok: true, note: `ถอนสิทธิ์${who}แล้ว · ข้อความอยู่ในคิว ระบบจะลองส่ง LINE อีกครั้ง` }
}

export interface JobChangeOutcome {
  appointments: Appointment[]
  /** what happened to the LINE notice to the driver; empty when no driver had an open LINE job */
  note: string
  /** false when the driver could not be told on LINE (the job change itself is saved) */
  lineOk: boolean
}

async function outcome(r: WithdrawOutcome, failText: string): Promise<JobChangeOutcome> {
  if (!r.success || !r.data) throw new Error(r.error || failText)
  const { ok, note } = withdrawNoteOf(r, 'พนักงาน')
  return { appointments: await fetchAppointmentsFromSupabase(), note, lineOk: ok }
}

/** ยกเลิกงาน on the job details: the job is deleted (the driver, if any, is told on LINE first). */
export async function deleteJob(apt: Appointment): Promise<JobChangeOutcome> {
  const done = await outcome(await deleteAppointmentJob({ appointmentId: apt.id, title: apt.title }), 'ลบงานไม่สำเร็จ')
  // The database ended this job's notices: reload the bell so they leave the list now (best-effort)
  await fetchNotificationsFromSupabase().catch(() => undefined)
  return done
}

/** ยกเลิกงาน on the status tab: the driver is taken off the job and told; the job stays for a new dispatch. */
export async function unassignDriver(apt: Appointment): Promise<JobChangeOutcome> {
  return outcome(await withdrawDriverTasks({ appointmentId: apt.id, kind: 'UNASSIGN', title: apt.title }), 'ถอนงานไม่สำเร็จ')
}

function lineNoteOf(r: Awaited<ReturnType<typeof sendDispatchToDriver>>): { sent: boolean; note: string } {
  if (!r.success || !r.data) return { sent: false, note: r.error || 'ส่ง LINE ไม่สำเร็จ' }
  if (r.data.mode !== 'live') return { sent: false, note: 'LINE อยู่ในโหมดทดสอบ ยังไม่ได้ส่งจริง' }
  if (r.data.status === 'SENT') return { sent: true, note: '' }
  if (r.data.status === 'DEAD' || r.data.status === 'CANCELLED') return { sent: false, note: 'LINE ส่งไม่สำเร็จ' }
  return { sent: false, note: 'อยู่ในคิว ระบบจะลองส่ง LINE อีกครั้ง' }
}

/**
 * The dispatch dialog: saves the driver + DISPATCH step first (the job is assigned even if LINE
 * is down), then sends the job to that driver's own LINE. LINE is reported as sent only when the
 * LINE API answered OK.
 */
export async function dispatchToDriver(apt: Appointment, driver: DeliveryDriver, by?: string): Promise<DispatchOutcome> {
  const appointments = await recordWorkOrderStep(
    apt.id,
    { stage: 'DISPATCH', note: `สั่งงานให้ ${driver.name} (${driver.id})`, by },
    { id: driver.id, name: driver.name }
  )
  const saved = appointments.find((a) => a.id === apt.id) ?? apt
  // The job now belongs to this driver: any other driver's open LINE job is withdrawn and he is told
  let withdrawn: WithdrawOutcome
  try {
    withdrawn = await withdrawDriverTasks({ appointmentId: apt.id, kind: 'REASSIGN', title: saved.title })
  } catch {
    withdrawn = { success: false, error: 'ส่ง LINE ไม่สำเร็จ' }
  }
  const withdrawNote = withdrawNoteOf(withdrawn, 'พนักงานคนเดิม').note
  const dispatch = [...(saved.events ?? [])].reverse().find((e) => e.stage.toUpperCase() === 'DISPATCH')
  const when = `${saved.date} ${saved.startTime}${saved.endTime ? `-${saved.endTime}` : ''}`
  const items = (saved.items ?? []).map((i) => `${i.name} ${i.quantity}${i.unit ? ` ${i.unit}` : ''}`).join(', ')
  const detail = [when, saved.location, items].filter(Boolean).join(' · ')
  let line: Awaited<ReturnType<typeof sendDispatchToDriver>>
  try {
    line = await sendDispatchToDriver({
      appointmentId: apt.id,
      driverCode: driver.id,
      title: saved.title,
      detail,
      idempotencyKey: `dispatch-${dispatch?.id ?? newId()}`,
    })
  } catch {
    line = { success: false, error: 'ส่ง LINE ไม่สำเร็จ' }
  }
  const { sent, note } = lineNoteOf(line)
  return { appointments, lineSent: sent, lineNote: note, withdrawNote }
}

export interface DriverTaskState {
  driverCode: string
  status: 'SENT' | 'ACCEPTED' | 'DONE' | 'CANCELLED'
  label: string
}

const TASK_LABEL: Record<DriverTaskState['status'], string> = {
  SENT: 'ส่งงานแล้ว รอคนขับรับงาน',
  ACCEPTED: 'คนขับรับงานแล้ว',
  DONE: 'พนักงานอัปเดตครบทุกขั้นแล้ว (รอร้านปิดงาน)',
  CANCELLED: 'ยกเลิกแล้ว',
}

/** Latest LINE job of this appointment's driver, read only. null when none or LINE is not set up yet. */
export async function fetchDriverTaskState(appointmentId: string): Promise<DriverTaskState | null> {
  try {
    const { createClient } = await import('@/lib/supabase/client')
    const { data, error } = await createClient()
      .from('line_tasks')
      .select('driver_code, status')
      .eq('appointment_id', appointmentId)
      .not('driver_code', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data?.driver_code) return null
    const status = data.status as DriverTaskState['status']
    return TASK_LABEL[status] ? { driverCode: data.driver_code as string, status, label: TASK_LABEL[status] } : null
  } catch {
    return null
  }
}
