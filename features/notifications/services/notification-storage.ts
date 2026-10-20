/**
 * In-app notifications (Master v4.3.1 §27). Created on the server (rental_overdue_scan:
 * delivery due, return due soon, overdue, payment due, low stock — raised per member, switched
 * on/off and timed by each member in ตั้งค่าส่วนตัว › การแจ้งเตือน). The app reads public.notifications (RLS: own or menu-addressed rows)
 * and marks them read / handled through notification_mark. Notices never change business data.
 */
import { createClient } from '@/lib/supabase/client'
import { rpc, selectRows } from '@/lib/db/rpc'

export type NotificationType =
  | 'RENTAL_DUE_SOON'
  | 'RENTAL_OVERDUE'
  | 'DELIVERY_DUE'
  | 'PAYMENT_DUE'
  | 'LOW_STOCK'
  | 'APPOINTMENT_DUE'
  | 'OTHER'
export type NotificationStatus = 'UNREAD' | 'READ' | 'HANDLED' | 'DISMISSED'

export interface ActionableNotificationData {
  sourceType?: string
  sourceId?: string
  severity?: string
  [key: string]: unknown
}

export interface ActionableNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  data: ActionableNotificationData
  status: NotificationStatus
  createdAt: string
  actionedAt?: string
}

const KNOWN: ReadonlySet<string> = new Set(['RENTAL_DUE_SOON', 'RENTAL_OVERDUE', 'DELIVERY_DUE', 'PAYMENT_DUE', 'LOW_STOCK', 'APPOINTMENT_DUE'])

let _cachedNotifications: ActionableNotification[] | null = null

export function setCachedNotifications(notifications: ActionableNotification[]): void {
  _cachedNotifications = notifications
}

export function loadNotifications(): ActionableNotification[] {
  return _cachedNotifications || []
}

function notifyChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new Event('app-storage-update'))
  } catch {
    // best-effort
  }
}

export async function fetchNotificationsFromSupabase(): Promise<ActionableNotification[]> {
  const supabase = createClient()
  // Notices are raised per member (own switches in ตั้งค่าส่วนตัว). The OWNER may read every row,
  // so the bell asks only for this member's own rows and the menu-addressed ones.
  const { data: sessionData } = await supabase.auth.getSession()
  const me = sessionData.session?.user.id
  const rows = await selectRows<{
    id: string
    event_type: string
    severity: string
    title: string
    body: string | null
    entity_type: string | null
    entity_id: string | null
    status: string
    created_at: string
    handled_at: string | null
  }>(
    supabase
      .from('notifications')
      .select('id, event_type, severity, title, body, entity_type, entity_id, status, created_at, handled_at')
      .in('status', ['UNREAD', 'READ', 'HANDLED'])
      .or(me ? `recipient_user_id.eq.${me},recipient_menu.not.is.null` : 'recipient_menu.not.is.null')
      .order('created_at', { ascending: false })
      .limit(200)
  )
  _cachedNotifications = rows.map((n) => ({
    id: n.id,
    type: (KNOWN.has(n.event_type) ? n.event_type : 'OTHER') as NotificationType,
    title: n.title,
    message: n.body || '',
    data: { sourceType: n.entity_type || undefined, sourceId: n.entity_id || undefined, severity: n.severity },
    status: n.status as NotificationStatus,
    createdAt: n.created_at,
    actionedAt: n.handled_at || undefined,
  }))
  notifyChanged()
  return _cachedNotifications
}

/** Marks one notice on the server and in the cache. */
export async function markNotificationStatus(id: string, status: 'READ' | 'HANDLED' | 'DISMISSED'): Promise<ActionableNotification[]> {
  await rpc('notification_mark', { p_notification_id: id, p_status: status })
  _cachedNotifications = loadNotifications().map((n) => (n.id === id ? { ...n, status } : n))
  notifyChanged()
  return _cachedNotifications
}

export async function markAllNotificationsRead(): Promise<ActionableNotification[]> {
  for (const n of loadNotifications().filter((x) => x.status === 'UNREAD')) {
    await rpc('notification_mark', { p_notification_id: n.id, p_status: 'READ' })
  }
  _cachedNotifications = loadNotifications().map((n) => (n.status === 'UNREAD' ? { ...n, status: 'READ' } : n))
  notifyChanged()
  return _cachedNotifications
}

/** Runs the server notice scan (OWNER / scheduled job only); others simply skip it. */
export async function runNotificationScan(): Promise<void> {
  try {
    await rpc('rental_overdue_scan')
  } catch {
    // not the OWNER: the scheduled job / OWNER session creates the notices
  }
}

/** Bell tabs: the four kinds of notice the shop follows (system, due work, bills, stock). */
export type NotificationGroup = 'SYSTEM' | 'WORK' | 'BILL' | 'STOCK'

export const NOTIFICATION_GROUPS: { key: NotificationGroup; label: string }[] = [
  { key: 'SYSTEM', label: 'ระบบ' },
  { key: 'WORK', label: 'งานถึงกำหนด' },
  { key: 'BILL', label: 'บิล' },
  { key: 'STOCK', label: 'สต็อก' },
]

export function notificationGroup(n: Pick<ActionableNotification, 'type'>): NotificationGroup {
  switch (n.type) {
    case 'APPOINTMENT_DUE':
    case 'DELIVERY_DUE':
      return 'WORK'
    case 'PAYMENT_DUE':
    case 'RENTAL_DUE_SOON':
    case 'RENTAL_OVERDUE':
      return 'BILL'
    case 'LOW_STOCK':
      return 'STOCK'
    default:
      return 'SYSTEM'
  }
}
