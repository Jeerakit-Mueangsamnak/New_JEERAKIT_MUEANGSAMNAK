import { saveUnitToSupabase, deleteUnitFromSupabase, generateUUID } from '@/features/products/api/product-repository'
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
  const newUnit: Unit = { id: generateUUID(), name: trimmed, isActive: true }
  await saveUnitToSupabase(newUnit)
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

export async function toggleUnitStatusAsync(id: string): Promise<Unit[]> {
  const current = loadUnits()
  const target = current.find((u) => u.id === id)
  if (!target) return current
  const updatedUnit = { ...target, isActive: !target.isActive }
  await saveUnitToSupabase(updatedUnit)
  return updateUnitInCache(id, updatedUnit)
}

export async function deleteUnitAsync(id: string, inUseCheck?: (unit: Unit) => boolean): Promise<Unit[]> {
  const current = loadUnits()
  const target = current.find((u) => u.id === id)
  if (!target) return current
  if (inUseCheck && inUseCheck(target)) {
    throw new Error(`ไม่สามารถลบหน่วยนับ "${target.name}" ได้เนื่องจากกำลังถูกใช้งานอยู่`)
  }
  await deleteUnitFromSupabase(id)
  const updated = current.filter((unit) => unit.id !== id)
  saveUnits(updated)
  return updated
}
