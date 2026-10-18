/**
 * Product cache for the UI (Master v4.3.1 §7, §11).
 *
 * Supabase is the only source of truth. This module keeps a synchronous in-memory copy so
 * screens can read instantly; every write goes through the product / stock RPCs and then
 * reloads the copy from the database. Stock quantities are never computed or changed in the
 * browser — they come from public.stock_balances, moved only by the server ledger.
 */

import { Product, ProductType } from '@/lib/types/rental-pos'
import {
  fetchProductsFromSupabase,
  saveProductToSupabase,
  deleteProductFromSupabase,
  confirmStockCount,
  adjustStock,
} from '@/features/products/api/product-repository'

export type { ProductType }

/** Determine the master product type (RENT, SALE, or BOTH). */
export function getProductType(p: Product): ProductType {
  if (p.productType) return p.productType
  if (p.product_type) return p.product_type
  if (p.rentalType === 'SALE') return 'SALE'
  return 'RENT'
}

/** Validate that product is allowed for the chosen POS mode (RENT or SALE). */
export function validateProductMode(p: Product, mode: 'RENT' | 'SALE'): void {
  const pType = getProductType(p)
  if (mode === 'RENT' && pType === 'SALE') {
    throw new Error(`สินค้า "${p.name}" (รหัส: ${p.code || p.id}) เป็นประเภท SALE ไม่สามารถใช้ในโหมดเช่าได้`)
  }
  if (mode === 'SALE' && pType === 'RENT') {
    throw new Error(`สินค้า "${p.name}" (รหัส: ${p.code || p.id}) เป็นประเภท RENT ไม่สามารถใช้ในโหมดขายได้`)
  }
}

let _cachedProducts: Product[] | null = null

export function setCachedProducts(products: Product[]) {
  _cachedProducts = products
}

export function loadProducts(): Product[] {
  if (typeof window === 'undefined') return _cachedProducts || []
  return _cachedProducts || []
}

function notifyProductsChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new Event('products_updated'))
  } catch {
    // event dispatch is best-effort
  }
}

/** Reload products from Supabase into the cache (after any write). */
export async function syncProductsFromSupabase(): Promise<Product[]> {
  const remoteProducts = await fetchProductsFromSupabase()
  _cachedProducts = remoteProducts
  notifyProductsChanged()
  return remoteProducts
}

/** Cache-only replace (no database write) — used by tests and optimistic UI. */
export function saveProducts(products: Product[]): void {
  _cachedProducts = products
}

/** Create one or more new products on the server, then reload. */
export async function addProductsAsync(incoming: Product | Product[]): Promise<Product[]> {
  const arr = Array.isArray(incoming) ? incoming : [incoming]
  for (const p of arr) await saveProductToSupabase(p, null)
  return syncProductsFromSupabase()
}

/** Create or update (by id) on the server, then reload. */
export async function upsertProductsAsync(incoming: Product | Product[]): Promise<Product[]> {
  const arr = Array.isArray(incoming) ? incoming : [incoming]
  const current = loadProducts()
  for (const p of arr) await saveProductToSupabase(p, current.find((c) => c.id === p.id) ?? null)
  return syncProductsFromSupabase()
}

export async function updateProductAsync(updated: Product): Promise<Product[]> {
  const previous = loadProducts().find((p) => p.id === updated.id) ?? null
  await saveProductToSupabase(updated, previous)
  return syncProductsFromSupabase()
}

/** Products are never hard-deleted (history): this deactivates. */
export async function deleteProductAsync(id: string): Promise<Product[]> {
  await deleteProductFromSupabase(id)
  return syncProductsFromSupabase()
}

export interface ProductAvailabilityResult {
  total: number
  usable: number
  available: number
  availableForRange: number
  reserved: number
  rented: number
  damaged: number
  lost: number
  inRepair: number
}

/** Read-only view of the server balances (the server re-checks stock at confirm time). */
export function getProductAvailability(productId: string): ProductAvailabilityResult {
  const p = loadProducts().find((prod) => prod.id === productId)
  if (!p) {
    return { total: 0, usable: 0, available: 0, availableForRange: 0, reserved: 0, rented: 0, damaged: 0, lost: 0, inRepair: 0 }
  }
  const available = Math.max(0, p.availableQuantity || 0)
  return {
    total: p.totalQuantity || 0,
    usable: available + (p.rentedQuantity || 0) + (p.reservedQuantity || 0),
    available,
    availableForRange: available,
    reserved: p.reservedQuantity || 0,
    rented: p.rentedQuantity || 0,
    damaged: p.damagedQuantity || 0,
    lost: p.lostQuantity || 0,
    inRepair: p.inRepairQuantity || 0,
  }
}

export interface StockCountAdjustmentInput {
  normalQty?: number
  damagedQty?: number
  lostQty?: number
  soldQty?: number
}

/**
 * Stock count from the count screen (Master §11): counted "normal" quantities go through one
 * stock count (one PIN). Corrections to damaged / lost quantities are stock adjustments
 * (PIN each). Sales are recorded through sale bills, never through a count.
 * One note per count round; it is also the reason on every changed line.
 */
export async function applyStockCount(
  items: Array<{ productId: string; productName: string; counts: StockCountAdjustmentInput }>,
  note?: string
): Promise<Product[]> {
  const roundNote = note?.trim() || 'ตรวจนับสต็อก'
  if (items.some((i) => i.counts.soldQty !== undefined && i.counts.soldQty !== 0)) {
    throw new Error('การขายต้องออกบิลขาย — ไม่บันทึกผ่านการนับสต็อก')
  }
  const current = loadProducts()
  // A lower damaged count cannot be written here: the shown damaged figure includes items
  // waiting for inspection, and damaged stock goes back to use only through repair/inspection.
  const damagedDown = items.filter((i) => {
    const p = current.find((c) => c.id === i.productId)
    return p && i.counts.damagedQty !== undefined && Math.max(0, i.counts.damagedQty) < (p.damagedQuantity || 0)
  })
  if (damagedDown.length > 0) {
    throw new Error(
      `ยอดชำรุดที่นับได้น้อยกว่าในระบบ (${damagedDown.map((i) => i.productName).join(', ')}) — ` +
        'ลดยอดชำรุดด้วยปุ่ม "นำกลับมาใช้" หรือ "แปลงสินค้า" ในรายการสินค้าชำรุด'
    )
  }

  // Each stock change is its own PIN-confirmed adjustment. Cancelling the first PIN changes
  // nothing; if a later one is cancelled or fails, the ones already confirmed stay (each with
  // its audit) and StockCountPartialError says exactly which — nothing is left half-done.
  const done: string[] = []
  try {
    // Damaged / lost moves first, so the count's snapshot of AVAILABLE already excludes them and
    // the counted "normal" quantity becomes the final AVAILABLE (no double deduction).
    for (const item of items) {
      const p = current.find((c) => c.id === item.productId)
      if (!p) continue
      for (const [field, state] of [['damagedQty', 'DAMAGED'], ['lostQty', 'LOST']] as const) {
        const target = item.counts[field]
        if (target === undefined) continue
        const now = field === 'damagedQty' ? p.damagedQuantity || 0 : p.lostQuantity || 0
        const delta = Math.max(0, target) - now
        if (delta === 0) continue
        await adjustStock({
          productId: p.id,
          productName: item.productName,
          from: delta > 0 ? 'AVAILABLE' : state,
          // Found lost items go to inspection first (server rule: never straight to AVAILABLE)
          to: delta > 0 ? state : 'INSPECTION',
          quantity: Math.abs(delta),
          reason: roundNote,
        })
        done.push(`${item.productName} (${field === 'damagedQty' ? 'ชำรุด' : 'สูญหาย'})`)
      }
    }

    const counted = items.filter((i) => i.counts.normalQty !== undefined)
    if (counted.length > 0) {
      await confirmStockCount(
        counted.map((i) => ({
          productId: i.productId,
          countedQty: Math.max(0, Number(i.counts.normalQty)),
        })),
        roundNote
      )
    }
  } catch (err) {
    if (done.length === 0) throw err
    const fresh = await syncProductsFromSupabase().catch(() => loadProducts())
    throw new StockCountPartialError(done, err, fresh)
  }
  return syncProductsFromSupabase()
}

/** A stock count stopped after some PIN-confirmed adjustments were already saved. */
export class StockCountPartialError extends Error {
  constructor(
    public readonly saved: string[],
    public readonly failure: unknown,
    public readonly products: Product[]
  ) {
    super(
      `บันทึกแล้ว: ${saved.join(', ')} — รายการที่เหลือยังไม่ได้ปรับยอด ` +
        '(ตรวจยอดล่าสุดในตาราง แล้วกรอกเฉพาะรายการที่เหลือเพื่อบันทึกอีกครั้ง)'
    )
    this.name = 'StockCountPartialError'
  }
}
