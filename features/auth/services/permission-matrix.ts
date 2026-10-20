import { MENU_CATALOG, type MenuCode } from '@/features/auth/services/permissions'

/**
 * What each important action needs, as the database enforces it today (read only — there is no
 * separate per-action grant). An action runs when the member holds ANY of its menus
 * (public._require_menu, VARIADIC = any of); risky ones also ask the member's own PIN
 * (public._require_pin with the action code). The 6 risky actions marked `grant` also need the
 * OWNER's per-user grant (public._require_action, migration 20261007131509_member_action_grants).
 * OWNER-only actions are refused for every USER (public._require_owner / RLS).
 */
/** Actions the OWNER grants per USER (public.member_action_grants; USER default = denied). */
export const GRANTABLE_ACTIONS = ['PRODUCT_PRICE_CHANGE', 'STOCK_ADJUST', 'BILL_VOID', 'REFUND', 'EXPENSE', 'WRITE_OFF'] as const
export type ActionGrantCode = (typeof GRANTABLE_ACTIONS)[number]

export interface ActionPermission {
  id: string
  label: string
  /** Any of these menus allows the action; empty = OWNER only. */
  menus: MenuCode[]
  ownerOnly?: boolean
  /** The member confirms with their own PIN (the server checks it). */
  pin?: 'ALWAYS' | 'WHEN_OVER_LIMIT' | 'AFTER_CONFIRM'
  /** Server function that checks it. */
  rpc: string
  /** A USER also needs this OWNER grant (checked after the menu, before the PIN). */
  grant?: ActionGrantCode
}

export const ACTION_PERMISSIONS: readonly ActionPermission[] = [
  { id: 'sell', label: 'ออกบิล / รับชำระที่หน้าร้าน', menus: ['pos', 'bills'], rpc: 'bill_confirm, payment_receive' },
  { id: 'bill_price', label: 'แก้ราคา / ให้ส่วนลดในบิล', menus: ['pos', 'bills'], pin: 'WHEN_OVER_LIMIT', rpc: 'bill_save_draft (PRICE_OVERRIDE)' },
  { id: 'bill_cancel_draft', label: 'ยกเลิกบิลแบบร่าง', menus: ['pos', 'bills'], rpc: 'bill_cancel (DRAFT)' },
  { id: 'bill_void', label: 'Void / ยกเลิกบิลที่ยืนยันแล้ว', menus: ['pos', 'bills'], pin: 'ALWAYS', rpc: 'bill_cancel (CONFIRMED), bill_void', grant: 'BILL_VOID' },
  { id: 'bill_correct', label: 'แก้ไข / ปรับยอดบิลที่ยืนยันแล้ว', menus: ['bills'], pin: 'ALWAYS', rpc: 'bill_correct, bill_adjust' },
  { id: 'payment_void', label: 'ยกเลิกรายการรับเงิน', menus: ['bills', 'finance'], pin: 'ALWAYS', rpc: 'payment_void (PAYMENT_VOID)' },
  { id: 'refund', label: 'คืนเงิน', menus: ['bills', 'finance'], pin: 'ALWAYS', rpc: 'refund_pay (REFUND)', grant: 'REFUND' },
  { id: 'write_off', label: 'ตัดหนี้สูญ', menus: ['bills', 'finance'], pin: 'ALWAYS', rpc: 'write_off_record (WRITE_OFF)', grant: 'WRITE_OFF' },
  { id: 'product_price', label: 'แก้ราคาหลักสินค้า', menus: ['products'], pin: 'ALWAYS', rpc: 'product_set_price (PRODUCT_PRICE_CHANGE)', grant: 'PRODUCT_PRICE_CHANGE' },
  { id: 'stock_receive', label: 'รับสินค้าเข้าสต็อก', menus: ['products'], pin: 'ALWAYS', rpc: 'stock_receive (STOCK_RECEIVE)' },
  { id: 'stock_adjust', label: 'ปรับสต็อก / แปลงของชำรุด', menus: ['products'], pin: 'ALWAYS', rpc: 'stock_adjust, convert_damaged_stock', grant: 'STOCK_ADJUST' },
  { id: 'stock_count', label: 'ยืนยันผลตรวจนับสต็อก', menus: ['products'], pin: 'ALWAYS', rpc: 'stock_count_confirm' },
  { id: 'expense', label: 'บันทึก / ยกเลิกรายจ่าย', menus: ['finance'], pin: 'ALWAYS', rpc: 'expense_create, expense_void', grant: 'EXPENSE' },
  { id: 'other_income', label: 'รายรับอื่น', menus: ['finance'], rpc: 'other_income_create' },
  { id: 'quotation', label: 'ใบเสนอราคา / จองสินค้า', menus: ['quotations'], rpc: 'quotation_save_draft, reservation_create' },
  { id: 'customer', label: 'เพิ่ม / แก้ข้อมูลลูกค้า', menus: ['customers', 'pos', 'bills'], rpc: 'customer_create, customer_update' },
  { id: 'appointment', label: 'นัดหมาย', menus: ['appointments'], rpc: 'appointment_save' },
  { id: 'audit', label: 'ดูประวัติการทำรายการ (Audit Log)', menus: [], ownerOnly: true, rpc: 'audit_logs (RLS: OWNER)' },
  { id: 'members', label: 'จัดการผู้ใช้และสิทธิ์', menus: [], ownerOnly: true, rpc: 'owner_set_member_*' },
  { id: 'settings', label: 'ตั้งค่าร้าน', menus: [], ownerOnly: true, rpc: 'settings_update' },
]

export const PIN_LABEL: Record<NonNullable<ActionPermission['pin']>, string> = {
  ALWAYS: 'ต้องใส่ PIN',
  WHEN_OVER_LIMIT: 'PIN เมื่อเกินเพดาน',
  AFTER_CONFIRM: 'PIN เมื่อบิลยืนยันแล้ว',
}

export type ActionAccess = 'ALLOWED' | 'NO_MENU' | 'NOT_GRANTED' | 'OWNER_ONLY'

/** What the server would answer for this member: role, granted menus and granted actions. */
export function actionAccess(
  role: 'OWNER' | 'USER' | undefined,
  menus: readonly string[],
  action: ActionPermission,
  grants: readonly string[] = []
): ActionAccess {
  if (role === 'OWNER') return 'ALLOWED'
  if (action.ownerOnly) return 'OWNER_ONLY'
  if (!action.menus.some((m) => menus.includes(m))) return 'NO_MENU'
  if (action.grant && !grants.includes(action.grant)) return 'NOT_GRANTED'
  return 'ALLOWED'
}

/** Menus shown in the matrix: grantable ones get a checkbox, owner-only ones are locked. */
export const MATRIX_MENUS = MENU_CATALOG.map((m) => ({ code: m.code, label: m.label, href: m.href, locked: m.ownerOnly }))
