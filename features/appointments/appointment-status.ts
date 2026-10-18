import type { AppointmentStatus } from '@/lib/types/rental-pos'
import { currentRunEvents } from '@/lib/work-order-stages'

/** Labels and badge colours for the appointment lifecycle (Master §9 / §26). */
export const APPOINTMENT_STATUS_META: Record<AppointmentStatus, { label: string; badge: string; color: string }> = {
  DRAFT: {
    label: 'ร่าง',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700',
    color: '#94a3b8',
  },
  SCHEDULED: {
    label: 'นัดแล้ว',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800',
    color: '#d97706',
  },
  CONFIRMED: {
    label: 'ยืนยันแล้ว',
    badge: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800',
    color: '#0891b2',
  },
  IN_PROGRESS: {
    label: 'กำลังดำเนินการ',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800',
    color: '#2563eb',
  },
  COMPLETED: {
    label: 'เสร็จแล้ว',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800',
    color: '#10b981',
  },
  CANCELLED: {
    label: 'ยกเลิก',
    badge: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700',
    color: '#64748b',
  },
  NO_SHOW: {
    label: 'ไม่มาตามนัด',
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800',
    color: '#e11d48',
  },
  RESCHEDULED: {
    label: 'เลื่อนนัดแล้ว',
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800',
    color: '#9333ea',
  },
}

/** Finished appointments: no more edits, reschedules or status changes (server: APPOINTMENT_NOT_EDITABLE). */
export const isAppointmentClosed = (status: AppointmentStatus) =>
  status === 'COMPLETED' || status === 'CANCELLED' || status === 'NO_SHOW'

/**
 * Status shown for a job (no one picks it by hand). Finished jobs keep their saved end status
 * (COMPLETED / CANCELLED / NO_SHOW). An open job is "in progress" once it was dispatched to a
 * driver; before that it follows the clock: before the start time, between start and end, after
 * the end. Nothing here is saved: the server status of an open job is left as it is.
 */
export type JobStatusKey = 'WAITING' | 'DUE' | 'OVERDUE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'

export const JOB_STATUS_META: Record<JobStatusKey, { label: string; badge: string }> = {
  WAITING: { label: 'รอถึงกำหนด', badge: APPOINTMENT_STATUS_META.SCHEDULED.badge },
  DUE: { label: 'รอสั่งงาน', badge: APPOINTMENT_STATUS_META.CONFIRMED.badge },
  OVERDUE: { label: 'เลยกำหนด', badge: APPOINTMENT_STATUS_META.NO_SHOW.badge },
  IN_PROGRESS: { label: 'กำลังดำเนินการ', badge: APPOINTMENT_STATUS_META.IN_PROGRESS.badge },
  COMPLETED: { label: APPOINTMENT_STATUS_META.COMPLETED.label, badge: APPOINTMENT_STATUS_META.COMPLETED.badge },
  CANCELLED: { label: APPOINTMENT_STATUS_META.CANCELLED.label, badge: APPOINTMENT_STATUS_META.CANCELLED.badge },
  NO_SHOW: { label: APPOINTMENT_STATUS_META.NO_SHOW.label, badge: APPOINTMENT_STATUS_META.NO_SHOW.badge },
}

/** The job is with a driver now: a DISPATCH was recorded and no WITHDRAW came after it. */
export const isDispatched = (apt: { events?: { stage: string; status: string }[] }) =>
  currentRunEvents(apt.events).some((e) => e.stage.toUpperCase() === 'DISPATCH' && e.status === 'DONE')

export function jobStatusOf(
  apt: { status: AppointmentStatus; date: string; startTime: string; endTime?: string; events?: { stage: string; status: string }[] },
  now: Date = new Date()
): JobStatusKey {
  if (apt.status === 'COMPLETED' || apt.status === 'CANCELLED' || apt.status === 'NO_SHOW') return apt.status
  if (isDispatched(apt)) return 'IN_PROGRESS'
  const start = new Date(`${apt.date}T${apt.startTime || '00:00'}:00`)
  const endRaw = new Date(`${apt.date}T${apt.endTime || apt.startTime || '00:00'}:00`)
  const end = endRaw < start ? start : endRaw
  if (Number.isNaN(start.getTime()) || now < start) return 'WAITING'
  return now <= end ? 'DUE' : 'OVERDUE'
}
