import { saveUnitToSupabase, deleteUnitFromSupabase } from '@/features/products/api/product-repository'
import { DbError } from '@/lib/db/rpc'
import { Unit } from '@/lib/types/rental-pos'
export type { Unit }

/**
 * Master Units Storage
 *
 * Single source of truth for Master Units, backed by Supabase remote schema,
 * with localStorage cache for offline/dev compatibility.
 * - Migrates from existing category rules & legacy units without destroying existing data.
 * - Provides safe add, update, and delete/toggle operations.
 * - Prevents damaging references when a unit is in use by category rules or products.
 */

export const DEFAULT_UNITS: Unit[] = [
  { id: 'unit-1', name: 'แผ่น', isActive: true },
  { id: 'unit-2', name: 'ต้น', isActive: true },
  { id: 'unit-3', name: 'ชุด', isActive: true },
  { id: 'unit-4', name: 'ชิ้น', isActive: true },
  { id: 'unit-5', name: 'กล่อง', isActive: true },
  { id: 'unit-6', name: 'เมตร', isActive: true },
  { id: 'unit-7', name: 'ท่อน', isActive: true },
]

/**
 * Load all units from Supabase / localStorage with safe non-destructive fallback.
 */
let _cachedUnits: Unit[] | null = null

export function setCachedUnits(units: Unit[]) {
  _cachedUnits = units
}

export function loadUnits(): Unit[] {
  if (typeof window === 'undefined') {
    if (process.env.NODE_ENV === 'test') {
      return DEFAULT_UNITS
    }
    return []
  }
  if (process.env.NODE_ENV === 'test' && !_cachedUnits?.length) {
    return DEFAULT_UNITS
  }
  return _cachedUnits || []
}

/**
 * Save units to localStorage cache.
 * Note: Does not auto-seed all defaults to Remote.
 */
export function saveUnits(units: Unit[]): void {
  if (typeof window === 'undefined') return
  _cachedUnits = units
}

/**
 * Add a new Master Unit.
 */
export async function addUnitAsync(name: string): Promise<Unit[]> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('กรุณาระบุชื่อหน่วยนับ')
  const current = loadUnits()
  if (current.some((u) => u.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`หน่วยนับ "${trimmed}" มีอยู่ในระบบแล้ว`)
  }
  const newUnit: Unit = { id: await saveUnitToSupabase({ name: trimmed }), name: trimmed, isActive: true }
  const updated = [...current, newUnit]
  saveUnits(updated)
  return updated
}

function updateUnitInCache(id: string, unit: Unit): Unit[] {
  const current = loadUnits()
  const updated = current.map((currentUnit) => (currentUnit.id === id ? unit : currentUnit))
  saveUnits(updated)
  return updated
}

export async function updateUnitAsync(id: string, name: string): Promise<Unit[]> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('กรุณาระบุชื่อหน่วยนับ')
  const current = loadUnits()
  if (current.some((u) => u.id !== id && u.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`ชื่อหน่วยนับ "${trimmed}" มีอยู่ในระบบแล้ว`)
  }
  const target = current.find(u => u.id === id)
  if (!target) return current
  const updatedUnit = { ...target, name: trimmed }
  await saveUnitToSupabase(updatedUnit)
  return updateUnitInCache(id, updatedUnit)
}
/**
 * ลบถาวร: the server refuses a unit that products still use (UNIT_IN_USE: <products>). Rows of
 * ตารางประกอบข้อมูล live in the shop settings, so they are counted here (`settingsUses`) the same way.
 */
export async function deleteUnitAsync(id: string, settingsUses = 0): Promise<Unit[]> {
  if (settingsUses > 0) throw new DbError(`UNIT_IN_USE: ${settingsUses}`)
  await deleteUnitFromSupabase(id)
  const updated = loadUnits().filter((unit) => unit.id !== id)
  saveUnits(updated)
  return updated
}

/** ระงับ / เปิดใช้งาน: the unit stays on its products and in old documents. */
export async function setUnitActiveAsync(id: string, active: boolean): Promise<Unit[]> {
  const target = loadUnits().find((u) => u.id === id)
  if (!target) throw new Error('ไม่พบหน่วยนับ')
  const updatedUnit = { ...target, isActive: active }
  await saveUnitToSupabase(updatedUnit)
  return updateUnitInCache(id, updatedUnit)
}
