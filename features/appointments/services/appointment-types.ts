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
