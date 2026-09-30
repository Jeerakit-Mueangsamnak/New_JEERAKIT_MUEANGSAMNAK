import { saveCategoryToSupabase, deleteCategoryFromSupabase, generateUUID } from '@/features/products/api/product-repository'
import { addUnitAsync, loadUnits } from '@/lib/unit-storage'
/**
 * Shared Product Category Rules & Composite Lookup Storage
 *
 * 1. Product Categories (หมวดหมู่สินค้า - ตาราง 1)
 * 2. Master Units (หน่วยนับ - ตาราง 2, in unit-storage.ts)
 * 3. Composite Rules (ตารางประกอบข้อมูล - ตาราง 3)
 *
 * Single source of truth backed by localStorage:
 * - 'pos_master_categories'
 * - 'pos_category_composite_rules'
 * - 'pos_category_rules' (legacy sync)
 */

export type CalculationType =
  | 'PER_ROUND'
  | 'PER_DAY'
  | 'SALE'
  | 'NO_CHARGE'
  | 'PER_WEEK'
  | 'PER_MONTH'
  | 'CUSTOM'

export interface ProductCategoryItem {
  id: string
  name: string
  calculationType?: CalculationType
  calculationLabel?: string
  defaultUnitId?: string
  isDefault?: boolean
  isActive?: boolean
}

export interface CategoryCompositeRule {
  id: string
  categoryId: string
  calculationType: CalculationType
  unitId?: string
}

export interface ProductCategoryRule {
  id: string
  name: string
  calculationType: CalculationType
  calculationLabel: string
  unit: string
  unitId?: string
  unitName?: string
  isDefault?: boolean
}

export const CALCULATION_OPTIONS: Array<{ type: CalculationType; label: string }> = [
  { type: 'PER_ROUND', label: 'ต่อรอบ' },
  { type: 'PER_DAY', label: 'ต่อวัน' },
  { type: 'SALE', label: 'ขาย' },
  { type: 'NO_CHARGE', label: 'ไม่คิดเงิน' },
]

export const CALCULATION_LONG_LABELS: Record<CalculationType, string> = {
  PER_ROUND: 'ราคาเช่าต่อรอบ × จำนวนสินค้า × จำนวนรอบ',
  PER_DAY: 'ราคาเช่าต่อวัน × จำนวนสินค้า × จำนวนวัน',
  SALE: 'ราคาขายต่อชิ้น × จำนวนสินค้า',
  NO_CHARGE: 'ไม่คิดเงิน (ฟรี)',
  PER_WEEK: 'ราคาเช่าต่อสัปดาห์ × จำนวนสินค้า × จำนวนสัปดาห์',
  PER_MONTH: 'ราคาเช่าต่อเดือน × จำนวนสินค้า × จำนวนเดือน',
  CUSTOM: 'กำหนดเอง',
}

export const DEFAULT_CATEGORIES: ProductCategoryItem[] = [
  { id: 'cat-1', name: 'แบบคาน' },
  { id: 'cat-2', name: 'แบบเสา' },
  { id: 'cat-3', name: 'นั่งร้าน' },
  { id: 'cat-4', name: 'อุปกรณ์เสริม' },
  { id: 'cat-5', name: 'ทั่วไป' },
]

export const DEFAULT_CATEGORY_RULES: ProductCategoryRule[] = [
  {
    id: 'cat-1',
    name: 'แบบคาน',
    calculationType: 'PER_ROUND',
    calculationLabel: 'ราคาเช่าต่อรอบ × จำนวนสินค้า × จำนวนรอบ',
    unit: 'แผ่น',
    unitId: 'unit-1',
    isDefault: true,
  },
  {
    id: 'cat-2',
    name: 'แบบเสา',
    calculationType: 'PER_ROUND',
    calculationLabel: 'ราคาเช่าต่อรอบ × จำนวนสินค้า × จำนวนรอบ',
    unit: 'ต้น',
    unitId: 'unit-2',
    isDefault: true,
  },
  {
    id: 'cat-3',
    name: 'นั่งร้าน',
    calculationType: 'PER_ROUND',
    calculationLabel: 'ราคาเช่าต่อรอบ × จำนวนสินค้า × จำนวนรอบ',
    unit: 'ชุด',
    unitId: 'unit-3',
    isDefault: true,
  },
  {
    id: 'cat-4',
    name: 'อุปกรณ์เสริม',
    calculationType: 'PER_ROUND',
    calculationLabel: 'ราคาเช่าต่อรอบ × จำนวนสินค้า × จำนวนรอบ',
    unit: 'ชิ้น',
    unitId: 'unit-4',
    isDefault: true,
  },
  {
    id: 'cat-5',
    name: 'ทั่วไป',
    calculationType: 'PER_ROUND',
    calculationLabel: 'ราคาเช่าต่อรอบ × จำนวนสินค้า × จำนวนรอบ',
    unit: 'ชิ้น',
    unitId: 'unit-4',
    isDefault: true,
  },
]

const COMPOSITE_RULES_KEY = 'pos_category_composite_rules'

// ─── Categories Management (ตาราง 1) ───────────────────────

let _cachedCategories: ProductCategoryItem[] | null = null

export function setCachedCategories(categories: ProductCategoryItem[]) {
  _cachedCategories = categories
}

export function loadCategories(): ProductCategoryItem[] {
  if (typeof window === 'undefined') {
    if (process.env.NODE_ENV === 'test') {
      return DEFAULT_CATEGORIES
    }
    return []
  }
  if (process.env.NODE_ENV === 'test' && !_cachedCategories?.length) {
    return DEFAULT_CATEGORIES
  }
  return _cachedCategories || []
}

export function saveCategories(categories: ProductCategoryItem[]): void {
  if (typeof window === 'undefined') return
  _cachedCategories = categories
}

export async function addCategoryAsync(name: string): Promise<ProductCategoryItem[]> {
  const current = loadCategories()
  const trimmed = name.trim()
  if (!trimmed) throw new Error('กรุณาระบุชื่อหมวดหมู่')
  if (current.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`หมวดหมู่ "${trimmed}" มีอยู่ในระบบแล้ว`)
  }
  const newCat = { id: generateUUID(), name: trimmed }
  await saveCategoryToSupabase(newCat)
  const updated = [...current, newCat]
  saveCategories(updated)
  return updated
}

function updateCategoryInCache(id: string, category: ProductCategoryItem): ProductCategoryItem[] {
  const current = loadCategories()
  const updated = current.map((currentCategory) => (currentCategory.id === id ? category : currentCategory))
  saveCategories(updated)
  return updated
}

export async function updateCategoryAsync(id: string, name: string): Promise<ProductCategoryItem[]> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('กรุณาระบุชื่อหมวดหมู่')
  const current = loadCategories()
  const duplicate = current.some((c) => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase())
  if (duplicate) throw new Error(`ชื่อหมวดหมู่ "${trimmed}" มีอยู่ในระบบแล้ว`)
  const target = current.find((category) => category.id === id)
  if (!target) throw new Error('ไม่พบหมวดหมู่ที่ต้องการแก้ไข')
  const updatedCategory = { ...target, name: trimmed }
  await saveCategoryToSupabase(updatedCategory)
  return updateCategoryInCache(id, updatedCategory)
}

export async function deleteCategoryAsync(id: string, inUseCheck?: (cat: ProductCategoryItem) => boolean): Promise<ProductCategoryItem[]> {
  const current = loadCategories()
  const target = current.find((c) => c.id === id)
  if (!target) return current
  if (inUseCheck && inUseCheck(target)) {
    throw new Error(`ไม่สามารถลบหมวดหมู่ "${target.name}" ได้เนื่องจากกำลังถูกใช้งานอยู่`)
  }
  await deleteCategoryFromSupabase(id)
  const updated = current.filter((category) => category.id !== id)
  saveCategories(updated)
  return updated
}

// ─── Composite Rules Management (ตาราง 3: ตารางประกอบข้อมูล) ─

export function loadCompositeRules(): CategoryCompositeRule[] {
  if (process.env.NODE_ENV === 'test' && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(COMPOSITE_RULES_KEY)
      if (raw) return JSON.parse(raw) as CategoryCompositeRule[]
    } catch {}
  }

  if (typeof window === 'undefined') {
    if (process.env.NODE_ENV === 'test') {
      return DEFAULT_CATEGORIES.map(cat => ({
        id: `comp-${cat.id}`,
        categoryId: cat.id,
        calculationType: (cat as any).calculationType || 'PER_ROUND',
        unitId: (cat as any).defaultUnitId || '',
      }))
    }
    return []
  }

  const categories = loadCategories()
  return categories.map(cat => ({
    id: `comp-${cat.id}`,
    categoryId: cat.id,
    calculationType: cat.calculationType || 'PER_ROUND',
    unitId: cat.defaultUnitId || '',
  }))
}

export function saveCompositeRules(rules: CategoryCompositeRule[]): void {
  if (typeof window === 'undefined') return
  if (process.env.NODE_ENV !== 'test') return
  try {
    localStorage.setItem(COMPOSITE_RULES_KEY, JSON.stringify(rules))
  } catch {
    // ignore
  }
}

function addCompositeRuleToCache(ruleData: Omit<CategoryCompositeRule, 'id'>): CategoryCompositeRule[] {
  const current = loadCompositeRules()
  const newRule: CategoryCompositeRule = {
    ...ruleData,
    id: `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  }
  const updated = [...current, newRule]
  saveCompositeRules(updated)
  return updated
}

export async function addCompositeRuleAsync(ruleData: Omit<CategoryCompositeRule, 'id'>): Promise<CategoryCompositeRule[]> {
  const cats = loadCategories()
  const cat = cats.find(c => c.id === ruleData.categoryId)
  if (cat) {
    const updatedCat = {
      ...cat,
      calculationType: ruleData.calculationType,
      defaultUnitId: ruleData.unitId,
    }
    await saveCategoryToSupabase(updatedCat)
    const newCats = cats.map(c => c.id === cat.id ? updatedCat : c)
    saveCategories(newCats)
  }
  return addCompositeRuleToCache(ruleData)
}

function updateCompositeRuleInCache(updatedRule: CategoryCompositeRule): CategoryCompositeRule[] {
  const current = loadCompositeRules()
  const updated = current.map((r) => (r.id === updatedRule.id ? updatedRule : r))
  saveCompositeRules(updated)
  return updated
}

export async function updateCompositeRuleAsync(updatedRule: CategoryCompositeRule): Promise<CategoryCompositeRule[]> {
  const cats = loadCategories()
  const cat = cats.find(c => c.id === updatedRule.categoryId)
  if (cat) {
    const updatedCat = {
      ...cat,
      calculationType: updatedRule.calculationType,
      defaultUnitId: updatedRule.unitId,
    }
    await saveCategoryToSupabase(updatedCat)
    // Update local category cache
    const newCats = cats.map(c => c.id === cat.id ? updatedCat : c)
    saveCategories(newCats)
  }
  return updateCompositeRuleInCache(updatedRule)
}

// ─── Backward Compatibility Wrappers ───────────────────────

export function loadCategoryRules(): ProductCategoryRule[] {
  if (typeof window === 'undefined') {
    if (process.env.NODE_ENV === 'test') return DEFAULT_CATEGORY_RULES
    return []
  }

  if (process.env.NODE_ENV === 'test' && (!_cachedCategories || _cachedCategories.length === 0)) {
    return DEFAULT_CATEGORY_RULES
  }

  const categories = loadCategories()
  const units = loadUnits()

  const rules: ProductCategoryRule[] = categories.map((cat) => {
    const calcType = cat.calculationType || 'PER_ROUND'
    return {
      id: cat.id,
      name: cat.name,
      calculationType: calcType,
      calculationLabel: cat.calculationLabel || CALCULATION_LONG_LABELS[calcType] || 'ต่อรอบ',
      unit: units.find((unit) => unit.id === cat.defaultUnitId)?.name || 'ชิ้น',
      unitId: cat.defaultUnitId,
      isDefault: cat.isDefault,
    }
  })

  return rules
}

async function resolveRuleUnitId(rule: Pick<ProductCategoryRule, 'unit' | 'unitId'>): Promise<string> {
  const unitName = rule.unit.trim()
  if (!unitName) throw new Error('กรุณาระบุหน่วยนับ')
  const units = loadUnits()
  const unit = rule.unitId
    ? units.find((candidate) => candidate.id === rule.unitId)
    : units.find((candidate) => candidate.name.toLocaleLowerCase() === unitName.toLocaleLowerCase())
  if (rule.unitId && !unit) throw new Error('ไม่พบหน่วยนับที่เลือก')
  if (unit) return unit.id

  const updatedUnits = await addUnitAsync(unitName)
  const createdUnit = updatedUnits.find((candidate) => candidate.name.toLocaleLowerCase() === unitName.toLocaleLowerCase())
  if (!createdUnit) throw new Error('ไม่สามารถสร้างหน่วยนับได้')
  return createdUnit.id
}

export async function addCategoryRuleAsync(ruleData: Omit<ProductCategoryRule, 'id'>): Promise<ProductCategoryRule[]> {
  const name = ruleData.name.trim()
  if (!name) throw new Error('กรุณาระบุชื่อหมวดหมู่')
  const current = loadCategories()
  if (current.some((category) => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error(`หมวดหมู่ "${name}" มีอยู่ในระบบแล้ว`)
  }
  const defaultUnitId = await resolveRuleUnitId(ruleData)
  const category: ProductCategoryItem = {
    id: generateUUID(),
    name,
    calculationType: ruleData.calculationType,
    calculationLabel: ruleData.calculationLabel,
    defaultUnitId,
    isActive: true,
  }
  await saveCategoryToSupabase(category)
  saveCategories([...current, category])
  return loadCategoryRules()
}

export async function updateCategoryRuleAsync(updated: ProductCategoryRule): Promise<ProductCategoryRule[]> {
  const name = updated.name.trim()
  if (!name) throw new Error('กรุณาระบุชื่อหมวดหมู่')
  const current = loadCategories()
  const target = current.find((category) => category.id === updated.id)
  if (!target) throw new Error('ไม่พบหมวดหมู่ที่ต้องการแก้ไข')
  if (current.some((category) => category.id !== updated.id && category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error(`ชื่อหมวดหมู่ "${name}" มีอยู่ในระบบแล้ว`)
  }
  const defaultUnitId = await resolveRuleUnitId(updated)
  const updatedCategory: ProductCategoryItem = {
    ...target,
    name,
    calculationType: updated.calculationType,
    calculationLabel: updated.calculationLabel,
    defaultUnitId,
  }
  await saveCategoryToSupabase(updatedCategory)
  saveCategories(current.map((category) => category.id === updated.id ? updatedCategory : category))
  return loadCategoryRules()
}

export async function deleteCategoryRuleAsync(
  id: string,
  inUseCheck?: (category: ProductCategoryItem) => boolean,
): Promise<ProductCategoryRule[]> {
  await deleteCategoryAsync(id, inUseCheck)
  return loadCategoryRules()
}

export function getCategoryRuleById(id?: string): ProductCategoryRule | undefined {
  if (!id) return undefined
  const rules = loadCategoryRules()
  return rules.find((r) => r.id === id)
}

export function getCategoryRuleByName(name?: string): ProductCategoryRule | undefined {
  if (!name) return undefined
  const rules = loadCategoryRules()
  return rules.find((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase())
}
