/**
 * The member's own notification switches (ตั้งค่าส่วนตัว › การแจ้งเตือน). Stored on the member's
 * profile (profiles.notification_prefs) and written only through my_notification_prefs_set; the
 * server notice scan raises each notice per member by these switches, for the menus they hold.
 * Pure helpers only (also used on the server side by buildCurrentUser).
 */
import type { NotificationSettings } from '@/features/settings/services/settings-storage'

export const DEFAULT_NOTIFICATION_PREFS: NotificationSettings = {
  deliveryReminder: { enabled: true, daysBefore: 1 },
  returnReminder: { enabled: true, daysBefore: 1 },
  paymentReminder: { enabled: true, daysBefore: 1 },
  lowStockReminder: { enabled: true },
  overdueReturnReminder: { enabled: true },
  appointmentReminder: { enabled: true, daysBefore: 3 },
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const days = (v: unknown, fallback: number): number => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : fallback
}

/** Saved switches on top of the defaults (missing or broken values fall back to the default). */
export function normalizeNotificationPrefs(raw: unknown): NotificationSettings {
  const saved = obj(raw)
  const item = <K extends keyof NotificationSettings>(key: K): NotificationSettings[K] => {
    const d = DEFAULT_NOTIFICATION_PREFS[key] as { enabled: boolean; daysBefore?: number }
    const s = obj(saved[key])
    const enabled = typeof s.enabled === 'boolean' ? s.enabled : d.enabled
    return (d.daysBefore === undefined ? { enabled } : { enabled, daysBefore: days(s.daysBefore, d.daysBefore) }) as NotificationSettings[K]
  }
  return {
    deliveryReminder: item('deliveryReminder'),
    returnReminder: item('returnReminder'),
    paymentReminder: item('paymentReminder'),
    lowStockReminder: item('lowStockReminder'),
    overdueReturnReminder: item('overdueReturnReminder'),
    appointmentReminder: item('appointmentReminder'),
  }
}
