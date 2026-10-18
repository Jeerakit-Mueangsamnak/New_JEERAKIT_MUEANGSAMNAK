/**
 * Appointment types (ประเภทนัดหมาย). The built-in types map to appointments.appointment_type
 * (the code the workflow and colors use). Types the user adds are names only: they are kept in
 * store_settings.policies.appointment_types and an appointment of such a type keeps the base code
 * GENERAL in appointment_type, with the chosen type's id and name in work_order.type.
 * No workflow, stage or status is created for a new type.
 */
import { getPolicy, savePolicies } from '@/lib/db/policies'
import type { AppointmentType } from '@/lib/types/rental-pos'

export const APPOINTMENT_TYPES_POLICY_KEY = 'appointment_types'

export interface AppointmentTypeOption {
  id: string
  label: string
  /** Code saved in appointments.appointment_type (built-in types: their own code; added types: GENERAL). */
  code: AppointmentType
  custom?: boolean
}

export const BUILT_IN_APPOINTMENT_TYPES: AppointmentTypeOption[] = [
  { id: 'DELIVERY', label: '🚚 นัดส่งสินค้า', code: 'DELIVERY' },
  { id: 'RETURN', label: '🔄 นัดรับคืนสินค้า', code: 'RETURN' },
  { id: 'PAYMENT', label: '💰 นัดชำระเงิน', code: 'PAYMENT' },
  { id: 'CONTRACT', label: '📝 นัดทำสัญญา', code: 'CONTRACT' },
  { id: 'QUOTATION', label: '📊 นัดติดตามใบเสนอราคา', code: 'QUOTATION' },
  { id: 'INSPECTION', label: '🔍 นัดตรวจสินค้า', code: 'INSPECTION' },
  { id: 'GENERAL', label: '📌 นัดหมายทั่วไป', code: 'GENERAL' },
]

/** Name without the leading emoji, for comparing and for the generated job name. */
export const plainTypeName = (label: string) => label.replace(/^[^\p{L}\p{N}]+/u, '').trim()
const sameName = (a: string, b: string) => plainTypeName(a).toLocaleLowerCase() === plainTypeName(b).toLocaleLowerCase()

function cleanCustom(raw: unknown): AppointmentTypeOption[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({ id: String(t.id ?? '').trim(), label: String(t.label ?? '').trim(), code: 'GENERAL' as const, custom: true }))
    .filter((t) => t.id && t.label)
}

export function loadAppointmentTypes(): AppointmentTypeOption[] {
  return [...BUILT_IN_APPOINTMENT_TYPES, ...cleanCustom(getPolicy<unknown>(APPOINTMENT_TYPES_POLICY_KEY, []))]
}

/** Empty or duplicate names are refused (message in Thai); returns the saved type. */
export async function addAppointmentType(name: string): Promise<AppointmentTypeOption> {
  const label = name.trim()
  if (!plainTypeName(label)) throw new Error('กรุณาระบุชื่อประเภทนัดหมาย')
  const all = loadAppointmentTypes()
  if (all.some((t) => sameName(t.label, label))) throw new Error(`ประเภท "${label}" มีอยู่แล้ว`)
  const custom = all.filter((t) => t.custom)
  const id = `custom-${Date.now()}`
  const saved = await savePolicies(
    { [APPOINTMENT_TYPES_POLICY_KEY]: [...custom.map((t) => ({ id: t.id, label: t.label })), { id, label }] },
    `เพิ่มประเภทนัดหมาย: ${label}`
  )
  const added = cleanCustom(saved[APPOINTMENT_TYPES_POLICY_KEY]).find((t) => t.id === id)
  if (!added) throw new Error('บันทึกประเภทนัดหมายไม่สำเร็จ')
  return added
}

/** The type an appointment shows: the added type it was saved with, else its built-in type. */
export function appointmentTypeOf(apt: { type: AppointmentType; appointmentTypeId?: string; appointmentTypeLabel?: string }): AppointmentTypeOption {
  if (apt.appointmentTypeId && apt.appointmentTypeLabel) {
    return { id: apt.appointmentTypeId, label: apt.appointmentTypeLabel, code: apt.type, custom: true }
  }
  return BUILT_IN_APPOINTMENT_TYPES.find((t) => t.id === apt.type) ?? BUILT_IN_APPOINTMENT_TYPES[BUILT_IN_APPOINTMENT_TYPES.length - 1]
}
