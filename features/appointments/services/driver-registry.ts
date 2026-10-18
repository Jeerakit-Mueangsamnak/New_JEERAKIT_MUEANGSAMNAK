/**
 * Delivery drivers (คนขับ / พนักงานขนส่ง). Drivers work on the road and do not sign in, so they
 * are NOT app users: the OWNER keeps them as a list in store_settings.policies.delivery_drivers
 * (Settings › LINE). Each driver has a short code of their own (D001, D002, …) that appointments
 * record when a job is dispatched. Drivers are never deleted, only switched off.
 */
import { getPolicy, savePolicies } from '@/lib/db/policies'

export const DRIVERS_POLICY_KEY = 'delivery_drivers'

export interface DeliveryDriver {
  /** Driver code, e.g. D001 */
  id: string
  name: string
  phone?: string
  active: boolean
}

function clean(raw: unknown): DeliveryDriver[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .map((d) => ({
      id: String(d.id ?? '').trim(),
      name: String(d.name ?? '').trim(),
      phone: String(d.phone ?? '').trim() || undefined,
      active: d.active !== false,
    }))
    .filter((d) => d.id && d.name)
}

export function loadDrivers(): DeliveryDriver[] {
  return clean(getPolicy<unknown>(DRIVERS_POLICY_KEY, []))
}

/** Next free code: D001, D002, … (codes of switched-off drivers are never reused). */
export function nextDriverId(list: DeliveryDriver[]): string {
  const max = list.reduce((m, d) => Math.max(m, Number(/^D(\d+)$/.exec(d.id)?.[1] ?? 0)), 0)
  return `D${String(max + 1).padStart(3, '0')}`
}

/** Saves the whole list (OWNER, audited by settings_update) and returns what the server holds. */
export async function saveDrivers(list: DeliveryDriver[], reason: string): Promise<DeliveryDriver[]> {
  const body = list.map((d) => ({ id: d.id, name: d.name.trim(), ...(d.phone?.trim() ? { phone: d.phone.trim() } : {}), active: d.active }))
  const saved = await savePolicies({ [DRIVERS_POLICY_KEY]: body }, reason)
  return clean(saved[DRIVERS_POLICY_KEY])
}
