import type { AppointmentStatus } from '@/lib/types/rental-pos'

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

/** Statuses a new appointment may start with. */
export const APPOINTMENT_INITIAL_STATUSES: AppointmentStatus[] = ['DRAFT', 'SCHEDULED', 'CONFIRMED']

/**
 * Next lifecycle steps offered in the UI for the current status (cancel is offered separately
 * for every open appointment). The server accepts any of these from an open appointment.
 */
export function nextAppointmentSteps(status: AppointmentStatus): { status: AppointmentStatus; label: string }[] {
  switch (status) {
    case 'DRAFT':
      return [{ status: 'SCHEDULED', label: 'ลงนัด' }]
    case 'SCHEDULED':
    case 'RESCHEDULED':
      return [
        { status: 'CONFIRMED', label: 'ยืนยันนัด' },
        { status: 'IN_PROGRESS', label: 'เริ่มงาน' },
        { status: 'NO_SHOW', label: 'ไม่มาตามนัด' },
      ]
    case 'CONFIRMED':
      return [
        { status: 'IN_PROGRESS', label: 'เริ่มงาน' },
        { status: 'NO_SHOW', label: 'ไม่มาตามนัด' },
      ]
    case 'IN_PROGRESS':
      return [{ status: 'COMPLETED', label: 'เสร็จงาน' }]
    default:
      return []
  }
}
