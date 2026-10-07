/**
 * Appointments (Master v4.3.1 §26) on the v4.3 schema. Reads: RLS SELECT on
 * public.appointments; writes: appointment_save / appointment_reschedule /
 * appointment_set_status (menu "appointments", audited, never hard-deleted).
 * The app's on-site checklist (items + steps) is kept in appointments.work_order.
 */
import { createClient } from '@/lib/supabase/client'
import { rpc, selectRows } from '@/lib/db/rpc'
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

interface AppointmentRow {
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
  work_order: { items?: Appointment['items']; events?: Appointment['events'] } | null
  created_at: string
}

const two = (n: number) => String(n).padStart(2, '0')
const localParts = (iso: string) => {
  const d = new Date(iso)
  return { date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, time: `${two(d.getHours())}:${two(d.getMinutes())}` }
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
    createdAt: row.created_at,
  }
}

const isUuid = (v?: string) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

function startEnd(apt: Appointment): { start: string; end: string } {
  const date = apt.date || localParts(new Date().toISOString()).date
  const start = new Date(`${date}T${apt.startTime || '09:00'}:00`)
  let end = new Date(`${date}T${apt.endTime || apt.startTime || '10:00'}:00`)
  if (end < start) end = start
  return { start: start.toISOString(), end: end.toISOString() }
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
    work_order: { items: apt.items ?? [], events: apt.events ?? [] },
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

/**
 * Saves details and, when the date/time changed, reschedules (server sets RESCHEDULED and writes
 * Appointment History with the reason). Status changes go through setAppointmentStatus.
 */
export async function updateAppointment(updated: Appointment, rescheduleReason = 'เลื่อนนัดหมาย'): Promise<Appointment[]> {
  const before = loadAppointments().find((a) => a.id === updated.id)
  if (!before) return addAppointment(updated)
  await rpc('appointment_save', { p_appointment_id: updated.id, p_data: editableFields(updated) })
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
