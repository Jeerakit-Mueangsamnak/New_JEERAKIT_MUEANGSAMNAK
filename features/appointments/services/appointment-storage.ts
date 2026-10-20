/**
 * Appointments (Master v4.3.1 §26) on the v4.3 schema. Reads: RLS SELECT on
 * public.appointments; writes: appointment_save / appointment_reschedule /
 * appointment_set_status (menu "appointments", audited, never hard-deleted).
 * The app's on-site checklist (items + steps) is kept in appointments.work_order.
 */
import { createClient } from '@/lib/supabase/client'
import { isDbError, rpc, selectRows } from '@/lib/db/rpc'
import { loadSystemSettings } from '@/features/settings/services/settings-storage'
import type { Appointment, AppointmentStatus, AppointmentType } from '@/lib/types/rental-pos'

let _cachedAppointments: Appointment[] | null = null

export function setCachedAppointments(appointments: Appointment[]): void {
  _cachedAppointments = appointments
}

export function loadAppointments(): Appointment[] {
  return _cachedAppointments || []
}

/** Cache-only replace (tests / optimistic UI). */
export function saveAppointments(appointments: Appointment[]): void {
  _cachedAppointments = appointments
}

const TYPE_TO_SERVER: Record<AppointmentType, string> = {
  DELIVERY: 'DELIVERY',
  RETURN: 'RETURN',
  PAYMENT: 'PAYMENT',
  CONTRACT: 'FOLLOW_UP',
  QUOTATION: 'FOLLOW_UP',
  INSPECTION: 'INSPECTION',
  GENERAL: 'GENERAL',
}

function typeFromServer(t: string, related?: string | null): AppointmentType {
  if (t === 'DELIVERY' || t === 'PICKUP' || t === 'INSTALLATION') return 'DELIVERY'
  if (t === 'RETURN') return 'RETURN'
  if (t === 'PAYMENT') return 'PAYMENT'
  if (t === 'INSPECTION' || t === 'REPAIR') return 'INSPECTION'
  if (t === 'FOLLOW_UP') return related === 'QUOTATION' ? 'QUOTATION' : 'CONTRACT'
  return 'GENERAL'
}

const STATUSES: AppointmentStatus[] = ['DRAFT', 'SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']

function statusFromServer(s: string): AppointmentStatus {
  return (STATUSES as string[]).includes(s) ? (s as AppointmentStatus) : 'SCHEDULED'
}

export interface AppointmentRow {
  id: string
  appointment_no: string
  appointment_type: string
  customer_id: string | null
  bill_id: string | null
  related_entity_type: string | null
  related_entity_id: string | null
  title: string
  description: string | null
  start_datetime: string
  end_datetime: string
  location: string | null
  contact_name: string | null
  contact_phone: string | null
  assigned_user_id: string | null
  priority: string
  status: string
  work_order: {
    items?: Appointment['items']
    events?: Appointment['events']
    driver?: { id?: string; name?: string }
    type?: { id?: string; label?: string }
  } | null
  created_at: string
  updated_at?: string
}

const two = (n: number) => String(n).padStart(2, '0')
const localParts = (iso: string) => {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: loadSystemSettings().timezone || 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` }
}

export function shopLocalDateTimeToIso(date: string, time: string, timeZone: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) throw new RangeError('Invalid shop-local appointment date or time')

  const [, yearText, monthText, dayText] = dateMatch
  const [, hourText, minuteText] = timeMatch
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const target = Date.UTC(year, month - 1, day, hour, minute)
  const dateCheck = new Date(Date.UTC(year, month - 1, day))
  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    dateCheck.getUTCFullYear() !== year || dateCheck.getUTCMonth() !== month - 1 || dateCheck.getUTCDate() !== day ||
    hour > 23 || minute > 59
  ) {
    throw new RangeError('Invalid shop-local appointment date or time')
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const partsAt = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    }
  }

  let instant = target
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = partsAt(instant)
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
    const adjustment = target - actualAsUtc
    if (adjustment === 0) break
    instant += adjustment
  }

  const resolved = partsAt(instant)
  if (
    resolved.year !== year || resolved.month !== month || resolved.day !== day ||
    resolved.hour !== hour || resolved.minute !== minute
  ) {
    throw new RangeError(`Appointment time does not exist in shop timezone ${timeZone}`)
  }
  return new Date(instant).toISOString()
}

export function dbAppointmentToDomain(row: AppointmentRow, lookups?: { customers?: Map<string, string>; bills?: Map<string, string> }): Appointment {
  const start = localParts(row.start_datetime)
  const end = localParts(row.end_datetime)
  return {
    id: row.id,
    customerId: row.customer_id || undefined,
    customerName: row.contact_name || (row.customer_id ? lookups?.customers?.get(row.customer_id) : '') || '',
    phone: row.contact_phone || '',
    title: row.title,
    type: typeFromServer(row.appointment_type, row.related_entity_type),
    appointmentTypeId: row.work_order?.type?.id || undefined,
    appointmentTypeLabel: row.work_order?.type?.label || undefined,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    location: row.location || '',
    contactPerson: row.contact_name || undefined,
    billId: row.bill_id || undefined,
    billNo: row.bill_id ? lookups?.bills?.get(row.bill_id) : undefined,
    quotationId: row.related_entity_type === 'QUOTATION' ? row.related_entity_id || undefined : undefined,
    details: row.description || undefined,
    status: statusFromServer(row.status),
    priority: (row.priority as Appointment['priority']) || 'NORMAL',
    assigneeId: row.assigned_user_id || undefined,
    items: row.work_order?.items,
    events: row.work_order?.events,
    driverId: row.work_order?.driver?.id || undefined,
    driverName: row.work_order?.driver?.name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const isUuid = (v?: string) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

function startEnd(apt: Appointment): { start: string; end: string } {
  const timezone = loadSystemSettings().timezone || 'Asia/Bangkok'
  const date = apt.date || localParts(new Date().toISOString()).date
  const start = shopLocalDateTimeToIso(date, apt.startTime || '09:00', timezone)
  let end = shopLocalDateTimeToIso(date, apt.endTime || apt.startTime || '10:00', timezone)
  if (Date.parse(end) < Date.parse(start)) end = start
  return { start, end }
}

function editableFields(apt: Appointment): Record<string, unknown> {
  return {
    appointment_type: TYPE_TO_SERVER[apt.type] || 'GENERAL',
    customer_id: isUuid(apt.customerId) ? apt.customerId : null,
    bill_id: isUuid(apt.billId) ? apt.billId : null,
    related_entity_type: isUuid(apt.quotationId) ? 'QUOTATION' : null,
    related_entity_id: isUuid(apt.quotationId) ? apt.quotationId : null,
    title: (apt.title || '').trim() || 'นัดหมาย',
    description: apt.details || null,
    location: apt.location || null,
    contact_name: apt.contactPerson || apt.customerName || null,
    contact_phone: apt.phone || null,
    assigned_user_id: isUuid(apt.assigneeId) ? apt.assigneeId : null,
    priority: apt.priority || 'NORMAL',
    work_order: {
      items: apt.items ?? [],
      events: apt.events ?? [],
      ...(apt.driverId ? { driver: { id: apt.driverId, name: apt.driverName || '' } } : {}),
      // Added type: the name the user chose (appointment_type keeps the base code); undefined clears an old one
      type: apt.appointmentTypeId && apt.appointmentTypeLabel ? { id: apt.appointmentTypeId, label: apt.appointmentTypeLabel } : undefined,
    },
  }
}

export async function fetchAppointmentsFromSupabase(): Promise<Appointment[]> {
  const supabase = createClient()
  const [rows, customers, bills] = await Promise.all([
    selectRows<AppointmentRow>(supabase.from('appointments').select('*').order('start_datetime', { ascending: true })),
    selectRows<{ id: string; name: string }>(supabase.from('customers').select('id, name')),
    selectRows<{ id: string; bill_no: string | null }>(supabase.from('bills').select('id, bill_no')),
  ])
  const lookups = {
    customers: new Map(customers.map((c) => [c.id, c.name])),
    bills: new Map(bills.filter((b) => b.bill_no).map((b) => [b.id, b.bill_no as string])),
  }
  _cachedAppointments = rows.map((r) => dbAppointmentToDomain(r, lookups))
  return _cachedAppointments
}

/** New appointment (server number). Returns the fresh list. */
export async function addAppointment(incoming: Appointment): Promise<Appointment[]> {
  const { start, end } = startEnd(incoming)
  // A new appointment may start as DRAFT, SCHEDULED or CONFIRMED (server default SCHEDULED).
  const status = ['DRAFT', 'SCHEDULED', 'CONFIRMED'].includes(incoming.status) ? incoming.status : 'SCHEDULED'
  await rpc('appointment_save', {
    p_appointment_id: null,
    p_data: { ...editableFields(incoming), start_datetime: start, end_datetime: end, status },
  })
  return fetchAppointmentsFromSupabase()
}

/** Creates an appointment and returns the server-assigned row from the refreshed list. */
export async function addAppointmentAndReturn(
  incoming: Appointment
): Promise<{ appointment: Appointment; appointments: Appointment[] }> {
  const { start, end } = startEnd(incoming)
  const status = ['DRAFT', 'SCHEDULED', 'CONFIRMED'].includes(incoming.status) ? incoming.status : 'SCHEDULED'
  const result = await rpc<{ appointment?: { id?: string } }>('appointment_save', {
    p_appointment_id: null,
    p_data: { ...editableFields(incoming), start_datetime: start, end_datetime: end, status },
  })
  const appointments = await fetchAppointmentsFromSupabase()
  const appointmentId = result?.appointment?.id
  const appointment = appointmentId ? appointments.find((item) => item.id === appointmentId) : undefined
  if (!appointment) throw new Error('บันทึกนัดหมายแล้ว แต่โหลดข้อมูลนัดหมายที่สร้างไม่สำเร็จ กรุณารีเฟรชรายการ')
  return { appointment, appointments }
}

export const APPOINTMENT_MISSING = 'ไม่พบนัดหมายนี้ในระบบ กรุณารีเฟรชรายการแล้วลองใหม่'
export const APPOINTMENT_STALE = 'นัดหมายนี้ถูกแก้ไขจากอีกเครื่องหรือคนขับแล้ว กรุณารีเฟรชแล้วทำรายการอีกครั้ง'

type WorkOrder = NonNullable<AppointmentRow['work_order']>
type WorkOrderEvent = NonNullable<Appointment['events']>[number]

/** The row as it is on the server now (not the screen's copy). */
export async function fetchAppointmentRow(id: string): Promise<AppointmentRow | null> {
  const supabase = createClient()
  const rows = await selectRows<AppointmentRow>(supabase.from('appointments').select('*').eq('id', id).limit(1))
  return rows[0] ?? null
}

/** Step records are append-only: saved steps are kept as they are, new ids are added after them. */
export function mergeWorkOrderEvents(saved: WorkOrderEvent[] = [], incoming: WorkOrderEvent[] = []): WorkOrderEvent[] {
  const seen = new Set(saved.map((e) => e.id))
  return [...saved, ...incoming.filter((e) => !seen.has(e.id))]
}

const sameTime = (a?: string, b?: string) => !!a && !!b && Date.parse(a) === Date.parse(b)

export const APPOINTMENT_GUARD_MISSING =
  'ฐานข้อมูลยังไม่ได้ติดตั้งส่วนป้องกันการบันทึกทับของนัดหมาย จึงยังแก้ไขหรือสั่งงานไม่ได้ (รอติดตั้ง Migration)'

/**
 * Saves an existing row only if nobody changed it since `expectedUpdatedAt`, checked by the
 * database under the row lock (appointment_save_guarded, migration 20261010090000). The plain
 * appointment_save is never used as a fallback: without the guard the save is refused.
 */
export async function saveExistingAppointment(id: string, data: Record<string, unknown>, expectedUpdatedAt?: string): Promise<void> {
  try {
    await rpc('appointment_save_guarded', { p_appointment_id: id, p_data: data, p_expected_updated_at: expectedUpdatedAt ?? null })
  } catch (err) {
    if (isDbError(err) && err.tag === 'APPOINTMENT_STALE') throw new Error(APPOINTMENT_STALE)
    if (isDbError(err) && (err.sqlState === 'PGRST202' || /Could not find the function/.test(err.raw))) throw new Error(APPOINTMENT_GUARD_MISSING)
    throw err
  }
}

/** work_order to save: what is on the server, with this screen's changes on top and every saved step kept. */
export function mergeWorkOrder(saved: WorkOrder | null, changes: WorkOrder): WorkOrder {
  return { ...(saved ?? {}), ...changes, events: mergeWorkOrderEvents(saved?.events, changes.events) }
}

/**
 * Saves details and, when the date/time changed, reschedules (server sets RESCHEDULED and writes
 * Appointment History with the reason). Status changes go through setAppointmentStatus; work-order
 * steps and dispatch go through dispatch-service. Never creates a new appointment: a row that is
 * gone, or was changed since this screen loaded it, is refused with a message to refresh.
 */
export async function updateAppointment(updated: Appointment, rescheduleReason = 'เลื่อนนัดหมาย'): Promise<Appointment[]> {
  const row = await fetchAppointmentRow(updated.id)
  if (!row) throw new Error(APPOINTMENT_MISSING)
  if (updated.updatedAt && row.updated_at && !sameTime(updated.updatedAt, row.updated_at)) throw new Error(APPOINTMENT_STALE)
  const before = dbAppointmentToDomain(row)
  const fields = editableFields(updated)
  fields.work_order = mergeWorkOrder(row.work_order, fields.work_order as WorkOrder)
  await saveExistingAppointment(updated.id, fields, row.updated_at)
  const a = startEnd(before)
  const b = startEnd(updated)
  if (a.start !== b.start || a.end !== b.end) {
    await rpc('appointment_reschedule', { p_appointment_id: updated.id, p_new_start: b.start, p_new_end: b.end, p_reason: rescheduleReason })
  }
  return fetchAppointmentsFromSupabase()
}

/** Lifecycle step (confirm / start / complete / no-show / cancel). Cancel needs a reason; nothing is ever deleted. */
export async function setAppointmentStatus(id: string, status: AppointmentStatus, reason?: string): Promise<Appointment[]> {
  await rpc('appointment_set_status', { p_appointment_id: id, p_status: status, p_reason: reason?.trim() || null })
  return fetchAppointmentsFromSupabase()
}

export interface AppointmentHistoryEntry {
  id: string
  changeType: 'CREATE' | 'UPDATE' | 'RESCHEDULE' | 'STATUS' | 'ASSIGN'
  originalStart?: string
  newStart?: string
  fromStatus?: string
  toStatus?: string
  reason?: string
  createdAt: string
}

/** Appointment History (Master §26): reschedules keep the original and new time with the reason. */
export async function fetchAppointmentHistory(appointmentId: string): Promise<AppointmentHistoryEntry[]> {
  const supabase = createClient()
  const rows = await selectRows<{
    id: string
    change_type: AppointmentHistoryEntry['changeType']
    original_start_datetime: string | null
    new_start_datetime: string | null
    before_data: { status?: string } | null
    after_data: { status?: string } | null
    reason: string | null
    created_at: string
  }>(
    supabase
      .from('appointment_history')
      .select('id, change_type, original_start_datetime, new_start_datetime, before_data, after_data, reason, created_at')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true })
  )
  return rows.map((r) => ({
    id: r.id,
    changeType: r.change_type,
    originalStart: r.original_start_datetime || undefined,
    newStart: r.new_start_datetime || undefined,
    fromStatus: r.before_data?.status,
    toStatus: r.after_data?.status,
    reason: r.reason || undefined,
    createdAt: r.created_at,
  }))
}
