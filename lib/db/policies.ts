/**
 * Adjustable shop settings that live in store_settings.policies (Master v4.3.1 §37:
 * "ค่าที่ปรับได้ให้เป็น Settings"). Read by everyone through the settings row; written only
 * through settings_update (settings menu, audited). Kept in a small cache for sync reads.
 */
import { rpc } from '@/lib/db/rpc'

export type Policies = Record<string, unknown>

let cached: Policies = {}

export function setCachedPolicies(p: Policies | null | undefined): void {
  cached = p && typeof p === 'object' ? { ...p } : {}
}

export function getPolicies(): Policies {
  return cached
}

export function getPolicy<T>(key: string, fallback: T): T {
  const v = cached[key]
  return v === undefined || v === null ? fallback : (v as T)
}

/** Shallow-merges top-level policy keys on the server (whole value per key is replaced). */
export async function savePolicies(patch: Policies, reason: string): Promise<Policies> {
  const row = await rpc<{ policies: Policies }>('settings_update', { p_patch: { policies: patch }, p_reason: reason })
  setCachedPolicies(row.policies)
  return cached
}

export interface CategoryDefault {
  calculationType?: string
  unitId?: string
}

/** Category → default pricing type and unit for new products (UI defaults only). */
export function getCategoryDefaults(): Record<string, CategoryDefault> {
  return getPolicy<Record<string, CategoryDefault>>('category_defaults', {})
}

export async function saveCategoryDefault(categoryId: string, value: CategoryDefault | null): Promise<void> {
  const next = { ...getCategoryDefaults() }
  if (value) next[categoryId] = value
  else delete next[categoryId]
  await savePolicies({ category_defaults: next }, 'ตั้งค่าเริ่มต้นของหมวดหมู่สินค้า')
}
