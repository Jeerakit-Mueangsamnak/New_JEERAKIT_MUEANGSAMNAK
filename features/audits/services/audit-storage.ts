/**
 * Audit log reader (Master v4.3.1 §29). The audit trail is written only by the database,
 * inside the same transaction as each change (who, when, what, before/after, reason, PIN used —
 * never the PIN itself). It is append-only and kept forever; only the OWNER may read it (RLS).
 */
import { createClient } from '@/lib/supabase/client'
import { selectRows } from '@/lib/db/rpc'

export type AuditEntityType =
  | 'BILL'
  | 'PRODUCT'
  | 'FINANCE'
  | 'STOCK'
  | 'CUSTOMER'
  | 'SETTINGS'
  | 'QUOTATION'
  | string

export interface AuditLogEntry {
  id: string
  userId: string
  displayName: string
  action: string
  entityType: AuditEntityType
  entityId: string
  billId?: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  reason?: string | null
  correlationId: string
  createdAt: string
  pinVerified?: boolean
  amount?: number | null
  quantity?: number | null
  channel?: string | null
  result?: string | null
}

/** Actions that move money or stock out of the normal flow (shown highlighted). */
export const HIGH_RISK_ACTIONS = [
  'REFUND_PAY',
  'PAYMENT_VOID',
  'BILL_VOID',
  'BILL_CANCEL',
  'BILL_CORRECT',
  'BILL_ADJUST',
  'STOCK_ADJUST',
  'STOCK_RECEIVE',
  'STOCK_CONVERT',
  'STOCK_COUNT_CONFIRM',
  'LOST_RECORD',
  'WRITE_OFF',
  'EXPENSE_CREATE',
  'EXPENSE_VOID',
  'PRODUCT_PRICE_CHANGE',
  'PIN_RESET',
  'PIN_BLOCKED',
]

export function isHighRiskAction(action: string): boolean {
  return HIGH_RISK_ACTIONS.includes(action)
}

/** Group of the audit screen (จัดการสิทธิ์ › ประวัติการทำรายการ) each database entity_type belongs to. */
export type AuditCategory = 'BILL' | 'CUSTOMER' | 'STOCK' | 'MEMBER' | 'FINANCE' | 'SYSTEM'

const AUDIT_CATEGORY_BY_ENTITY: Record<string, AuditCategory> = {
  BILL: 'BILL',
  BILL_LINE: 'BILL',
  CARRY_FORWARD: 'BILL',
  CHARGE: 'BILL',
  INCIDENT: 'BILL',
  RESERVATION: 'BILL',
  QUOTATION: 'BILL',
  APPOINTMENT: 'BILL',
  LINE_TASK: 'BILL',
  CUSTOMER: 'CUSTOMER',
  CUSTOMER_DOCUMENT: 'CUSTOMER',
  PRODUCT: 'STOCK',
  PRODUCT_CATEGORY: 'STOCK',
  PRODUCT_UNIT: 'STOCK',
  UNIT: 'STOCK',
  STOCK_COUNT: 'STOCK',
  MEMBER: 'MEMBER',
  PROFILE: 'MEMBER',
  PAYMENT: 'FINANCE',
  REFUND: 'FINANCE',
  EXPENSE: 'FINANCE',
  OTHER_INCOME: 'FINANCE',
}

/** Unknown entity types (settings, LINE channel, …) fall under SYSTEM. */
export function auditCategoryOf(entityType: string | null | undefined): AuditCategory {
  return AUDIT_CATEGORY_BY_ENTITY[entityType || ''] ?? 'SYSTEM'
}

export function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface AuditRow {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  reason: string | null
  correlation_id: string
  created_at: string
  pin_verified: boolean
  amount: number | null
  quantity: number | null
  channel: string | null
  result: string | null
}

export interface AuditLogFilter {
  entityId?: string
  billId?: string
  actorId?: string
  limit?: number
}

export async function fetchAuditLogs(filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
  const supabase = createClient()
  let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(filter.limit ?? 1000)
  if (filter.actorId) q = q.eq('actor_id', filter.actorId)
  if (filter.entityId) q = q.eq('entity_id', filter.entityId)
  if (filter.billId) q = q.or(`entity_id.eq.${filter.billId},after_data->>bill_id.eq.${filter.billId}`)
  const [rows, profiles] = await Promise.all([
    selectRows<AuditRow>(q),
    selectRows<{ id: string; display_name: string | null; username: string | null }>(
      supabase.from('profiles').select('id, display_name, username')
    ),
  ])
  const names = new Map(profiles.map((p) => [p.id, p.display_name || p.username || '']))
  return rows.map((r) => ({
    id: r.id,
    userId: r.actor_id || 'system',
    displayName: r.actor_id ? names.get(r.actor_id) || 'ผู้ใช้' : 'ระบบ',
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id || '',
    billId: (r.after_data?.bill_id as string | undefined) || (r.entity_type === 'BILL' ? r.entity_id || undefined : undefined),
    before: r.before_data,
    after: r.after_data,
    reason: r.reason,
    correlationId: r.correlation_id,
    createdAt: r.created_at,
    pinVerified: r.pin_verified,
    amount: r.amount,
    quantity: r.quantity,
    channel: r.channel,
    result: r.result,
  }))
}

export async function getAuditLogsForBill(billId: string): Promise<AuditLogEntry[]> {
  return fetchAuditLogs({ billId })
}
