/**
 * "รายการ" (list item) of a product inside its category — owner 2026-11-02.
 * The category is the first dropdown (หมวดหมู่); the รายการ dropdown shows the items of the
 * chosen category. The items of each category are added in สินค้า › ตั้งค่าเสริม › ตารางเพิ่มรายการ
 * and kept with the category defaults (store_settings.policies.category_defaults[categoryId].items).
 * A product keeps its own item in products.list_item.
 */
import { loadCategories } from '@/lib/category-rules-storage'
import { getCategoryDefaults, saveCategoryDefault, type CategoryListItem } from '@/lib/db/policies'

/** Order of the category dropdowns in the POS (owner 2026-11-02); other categories come after. */
export const CATEGORY_DISPLAY_ORDER = ['แบบคาน', 'แบบเสา', 'แบบข้าง', 'นั่งร้าน', 'อื่นๆ']

export function sortCategoryNames(names: readonly string[]): string[] {
  const rank = (name: string) => {
    const i = CATEGORY_DISPLAY_ORDER.indexOf(name.trim())
    return i === -1 ? CATEGORY_DISPLAY_ORDER.length : i
  }
  // Stable: categories outside the list keep the order they came in.
  return names.map((name, i) => ({ name, i })).sort((a, b) => rank(a.name) - rank(b.name) || a.i - b.i).map((x) => x.name)
}

/** Items stored for one category, in the order they were added. */
export function getCategoryListItems(categoryId: string | undefined | null): CategoryListItem[] {
  if (!categoryId) return []
  const items = getCategoryDefaults()[categoryId]?.items
  return Array.isArray(items) ? items.filter((i) => i && typeof i.name === 'string' && i.name.trim()) : []
}

/**
 * Item names for one category (by name): the items added in ตั้งค่าเสริม first, then any other item
 * already saved on a product of that category (so nothing a product uses disappears from the list).
 */
export function listItemOptions(
  categoryName: string | undefined | null,
  products: ReadonlyArray<{ category?: string | null; listItem?: string | null }> = []
): string[] {
  const name = (categoryName || '').trim()
  if (!name) return []
  const category = loadCategories().find((c) => c.name.trim() === name)
  const items = getCategoryListItems(category?.id).map((i) => i.name.trim())
  for (const p of products) {
    const item = (p.listItem || '').trim()
    if (item && (p.category || '').trim() === name && !items.includes(item)) items.push(item)
  }
  return items
}

/** The stored item (with its default pricing type / unit, if any) of a category. */
export function findCategoryListItem(categoryId: string | undefined | null, itemName: string | undefined | null) {
  const name = (itemName || '').trim()
  if (!name) return undefined
  return getCategoryListItems(categoryId).find((i) => i.name.trim() === name)
}

async function saveItems(categoryId: string, items: CategoryListItem[]): Promise<void> {
  await saveCategoryDefault(categoryId, { items })
}

export async function addCategoryListItemAsync(categoryId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!categoryId) throw new Error('กรุณาเลือกหมวดหมู่')
  if (!trimmed) throw new Error('กรุณาระบุชื่อรายการ')
  const items = getCategoryListItems(categoryId)
  if (items.some((i) => i.name.trim().toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`รายการ "${trimmed}" มีอยู่ในหมวดหมู่นี้แล้ว`)
  }
  await saveItems(categoryId, [...items, { name: trimmed }])
}

/** Rename / delete only an item no product uses yet (products keep the item by its name). */
export async function renameCategoryListItemAsync(
  categoryId: string,
  oldName: string,
  newName: string,
  inUse: boolean
): Promise<void> {
  const trimmed = newName.trim()
  if (!trimmed) throw new Error('กรุณาระบุชื่อรายการ')
  if (inUse) throw new Error(`รายการ "${oldName}" มีสินค้าใช้อยู่ แก้ชื่อไม่ได้`)
  const items = getCategoryListItems(categoryId)
  if (items.some((i) => i.name !== oldName && i.name.trim().toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`รายการ "${trimmed}" มีอยู่ในหมวดหมู่นี้แล้ว`)
  }
  await saveItems(categoryId, items.map((i) => (i.name === oldName ? { ...i, name: trimmed } : i)))
}

export async function deleteCategoryListItemAsync(categoryId: string, name: string, inUse: boolean): Promise<void> {
  if (inUse) throw new Error(`รายการ "${name}" มีสินค้าใช้อยู่ ลบไม่ได้`)
  await saveItems(categoryId, getCategoryListItems(categoryId).filter((i) => i.name !== name))
}

/** Default pricing type / unit of one item (ตารางประกอบข้อมูล); only fills the add-product form. */
export async function setCategoryListItemRuleAsync(
  categoryId: string,
  name: string,
  rule: { calculationType?: string; unitId?: string }
): Promise<void> {
  const items = getCategoryListItems(categoryId)
  if (!items.some((i) => i.name === name)) throw new Error(`ไม่พบรายการ "${name}" ในหมวดหมู่นี้`)
  await saveItems(
    categoryId,
    items.map((i) => (i.name === name ? { ...i, calculationType: rule.calculationType, unitId: rule.unitId || undefined } : i))
  )
}
