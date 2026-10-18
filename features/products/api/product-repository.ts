import { createClient } from '@/lib/supabase/client'
import { rpc, selectRows, newIdempotencyKey } from '@/lib/db/rpc'
import { withPin } from '@/lib/db/pin-confirm'
import type { Product, RentalType } from '@/lib/types/rental-pos'

/**
 * Products / categories / units / stock (Master v4.3.1 §7–§11) on the v4.3 schema.
 * Reads: RLS SELECT on products, product_categories, units, stock_balances, product_costs.
 * Writes: product_* / unit_save / product_category_save / stock_* RPCs only. Stock is never a
 * column — it is the sum of stock_balances per state, moved only by the server ledger.
 */

export function isValidUUID(val?: string | null): boolean {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function isPlaceholderConfig(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  return !url || url.includes('placeholder') || !key || key.includes('placeholder')
}

interface ProductRow {
  id: string
  sku: string
  name: string
  category_id: string | null
  unit_id: string
  item_type: string
  calculation_type: string
  sale_price: number | null
  rental_price: number | null
  reorder_point: number
  can_sell: boolean
  can_rent: boolean
  is_accessory: boolean
  is_rent_chargeable: boolean
  requires_return: boolean
  default_damage_fee: number
  default_loss_fee: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface CategoryRow { id: string; name: string; active: boolean }
export interface UnitRow { id: string; name: string; active: boolean; sort_order: number }

/** calculation_type ↔ app rental type: PER_DAY = รายวัน, PER_PERIOD = ต่อรอบ. */
export function rentalTypeOf(p: Pick<ProductRow, 'calculation_type' | 'can_rent' | 'can_sell'>): RentalType {
  if (!p.can_rent && p.can_sell) return 'SALE'
  return p.calculation_type === 'PER_DAY' ? 'DAILY' : 'NORMAL'
}

export function mapProductRow(
  p: ProductRow,
  lookups: {
    categories: Map<string, string>
    units: Map<string, string>
    balances: Map<string, Record<string, number>>
    costs: Map<string, number>
  }
): Product {
  const b = lookups.balances.get(p.id) || {}
  const q = (state: string) => Number(b[state] ?? 0)
  const available = q('AVAILABLE')
  const reserved = q('RESERVED')
  const rented = q('RENTED_OUT') + q('DELIVERY_PENDING') + q('RETURN_PENDING')
  // Not usable yet: damaged, waiting for inspection, or in repair (one "ชำรุด" figure on every screen,
  // so goods left in REPAIR / INSPECTION never drop out of sight).
  const repair = q('REPAIR')
  const damaged = q('DAMAGED') + q('INSPECTION') + repair
  const lost = q('LOST')
  // Owned and still in the business (excludes LOST / SOLD / WRITTEN_OFF / INACTIVE).
  const total = available + reserved + rented + damaged
  const rentalType = rentalTypeOf(p)
  const rentPrice = p.can_rent ? Number(p.rental_price ?? 0) : null
  const salePrice = p.can_sell ? Number(p.sale_price ?? 0) : null
  const productType = p.can_rent && p.can_sell ? 'BOTH' : p.can_sell ? 'SALE' : 'RENT'
  const calcType = rentalType === 'SALE' ? 'SALE' : rentalType === 'DAILY' ? 'PER_DAY' : 'PER_ROUND'

  return {
    id: p.id,
    code: p.sku,
    name: p.name,
    categoryId: p.category_id || undefined,
    category: (p.category_id && lookups.categories.get(p.category_id)) || '',
    unitId: p.unit_id,
    unit: lookups.units.get(p.unit_id) || '',
    rentalType,
    productType,
    rentPrice,
    salePrice,
    normalPrice: rentPrice ?? salePrice ?? 0,
    dailyPrice: rentalType === 'DAILY' ? rentPrice ?? 0 : 0,
    costPrice: lookups.costs.get(p.id),
    defaultDamageFee: Number(p.default_damage_fee ?? 0),
    defaultLossFee: Number(p.default_loss_fee ?? 0),
    defaultRepairFee: Number(p.default_damage_fee ?? 0),
    defaultReplacementFee: Number(p.default_loss_fee ?? 0),
    totalQuantity: total,
    availableQuantity: available,
    rentedQuantity: rented,
    damagedQuantity: damaged,
    lostQuantity: lost,
    reservedQuantity: reserved,
    inRepairQuantity: repair,
    maintenanceQuantity: repair,
    stockStates: { ...b },
    minimumStock: Number(p.reorder_point ?? 0),
    status: p.active ? 'ACTIVE' : 'INACTIVE',
    calculationType: calcType,
    calculationLabel: calcType === 'PER_DAY' ? 'ต่อวัน' : calcType === 'SALE' ? 'ขาย' : 'ต่อรอบ',
    categoryRuleId: p.category_id || undefined,
    isAccessory: p.is_accessory,
    isChargeable: p.is_rent_chargeable,
    requiresReturn: p.requires_return,
    createdAt: p.created_at,
    // compatibility aliases still read by older components
    product_code: p.sku,
    product_name: p.name,
    unit_name: lookups.units.get(p.unit_id) || '',
    rental_type: rentalType,
    normal_price: rentPrice ?? salePrice ?? 0,
    daily_price: rentalType === 'DAILY' ? rentPrice ?? 0 : 0,
    sale_price: salePrice ?? undefined,
    available_qty: available,
    minimum_quantity: Number(p.reorder_point ?? 0),
  }
}

export async function fetchCategoriesFromSupabase(): Promise<CategoryRow[]> {
  if (isPlaceholderConfig()) return []
  const supabase = createClient()
  return selectRows<CategoryRow>(supabase.from('product_categories').select('id, name, active').order('name'))
}

export async function fetchUnitsFromSupabase(): Promise<UnitRow[]> {
  if (isPlaceholderConfig()) return []
  const supabase = createClient()
  return selectRows<UnitRow>(supabase.from('units').select('id, name, active, sort_order').order('sort_order').order('name'))
}

export async function fetchProductsFromSupabase(): Promise<Product[]> {
  if (isPlaceholderConfig()) return []
  const supabase = createClient()
  const [rows, categories, units, balances, costs] = await Promise.all([
    selectRows<ProductRow>(supabase.from('products').select('*').order('sku')),
    fetchCategoriesFromSupabase(),
    fetchUnitsFromSupabase(),
    selectRows<{ product_id: string; stock_state: string; quantity: number }>(
      supabase.from('stock_balances').select('product_id, stock_state, quantity')
    ),
    // product_costs is readable by OWNER only (RLS); others simply see no cost.
    supabase.from('product_costs').select('product_id, cost_price').then(({ data }) => data ?? []),
  ])
  const balanceMap = new Map<string, Record<string, number>>()
  for (const r of balances) {
    const m = balanceMap.get(r.product_id) || {}
    m[r.stock_state] = Number(r.quantity)
    balanceMap.set(r.product_id, m)
  }
  const lookups = {
    categories: new Map(categories.map((c) => [c.id, c.name])),
    units: new Map(units.map((u) => [u.id, u.name])),
    balances: balanceMap,
    costs: new Map((costs as Array<{ product_id: string; cost_price: number }>).map((c) => [c.product_id, Number(c.cost_price)])),
  }
  return rows.map((p) => mapProductRow(p, lookups))
}

// ─── writes ──────────────────────────────────────────────────────────────────

function productPayload(p: Product, units: UnitRow[]): Record<string, unknown> {
  const rentalType = p.rentalType
  const type = p.productType ?? (rentalType === 'SALE' ? 'SALE' : 'RENT')
  const canSell = type === 'SALE' || type === 'BOTH'
  const canRent = type === 'RENT' || type === 'BOTH'
  // Only a real unit id counts (older screens sometimes pass the category id here).
  const unitId = units.find((u) => u.id === p.unitId)?.id ?? units.find((u) => u.name === p.unit)?.id
  return {
    sku: (p.code || '').trim(),
    name: (p.name || '').trim(),
    category_id: p.categoryId && isValidUUID(p.categoryId) ? p.categoryId : null,
    unit_id: unitId,
    calculation_type: rentalType === 'DAILY' || p.calculationType === 'PER_DAY' ? 'PER_DAY' : canRent ? 'PER_PERIOD' : 'PER_UNIT',
    can_sell: canSell,
    can_rent: canRent,
    reorder_point: Number(p.minimumStock ?? 0),
    is_accessory: Boolean(p.isAccessory),
    is_rent_chargeable: p.isChargeable !== false,
    requires_return: p.requiresReturn !== false,
    default_damage_fee: Number(p.defaultDamageFee ?? 0),
    default_loss_fee: Number(p.defaultLossFee ?? p.defaultLostFee ?? 0),
  }
}

function priceOf(p: Product): { sale: number | null; rent: number | null } {
  const type = p.productType ?? (p.rentalType === 'SALE' ? 'SALE' : 'RENT')
  const rent = type === 'SALE' ? null : Number(p.rentPrice ?? (p.rentalType === 'DAILY' ? p.dailyPrice : p.normalPrice) ?? 0)
  const sale = type === 'RENT' ? null : Number(p.salePrice ?? (type === 'SALE' ? p.normalPrice : 0) ?? 0)
  return { sale, rent }
}

/**
 * Creates or updates one product. New products: product_create (opening stock needs the
 * STOCK_RECEIVE PIN). Existing ones: only the parts that changed — fields, price (PIN, Master
 * §4.4), cost, active flag. `previous` is the cached copy used to see what changed.
 */
export async function saveProductToSupabase(product: Product, previous?: Product | null): Promise<string> {
  const units = await fetchUnitsFromSupabase()
  const payload = productPayload(product, units)
  const prices = priceOf(product)

  if (!previous || !isValidUUID(product.id)) {
    const initialQty = Number(product.totalQuantity ?? product.availableQuantity ?? 0)
    const create = (pinToken?: string) =>
      rpc<{ id: string }>('product_create', {
        p_data: { ...payload, sale_price: prices.sale, rental_price: prices.rent },
        p_cost_price: product.costPrice ?? null,
        p_initial_qty: initialQty,
        p_pin_token: pinToken,
      })
    const created = initialQty > 0
      ? await withPin({ action: 'STOCK_RECEIVE', title: 'ยืนยันรับสินค้าเข้าสต็อก', detail: `${product.name} จำนวน ${initialQty}` }, (t) => create(t))
      : await create()
    return created.id
  }

  const before = productPayload(previous, units)
  const changed = Object.fromEntries(
    Object.entries(payload).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k]))
  )
  if (Object.keys(changed).length > 0) {
    await rpc('product_update', { p_product_id: product.id, p_data: changed, p_reason: 'แก้ไขข้อมูลสินค้า' })
  }

  const oldPrices = priceOf(previous)
  if (prices.sale !== oldPrices.sale || prices.rent !== oldPrices.rent) {
    await withPin(
      { action: 'PRODUCT_PRICE_CHANGE', title: 'ยืนยันแก้ราคาสินค้า', detail: product.name, askReason: true },
      (token, reason) =>
        rpc('product_set_price', {
          p_product_id: product.id,
          p_sale_price: prices.sale,
          p_rental_price: prices.rent,
          p_reason: reason || 'แก้ราคาสินค้า',
          p_pin_token: token,
        })
    )
  }

  if (product.costPrice !== undefined && product.costPrice !== previous.costPrice) {
    await rpc('product_set_cost', { p_product_id: product.id, p_cost_price: product.costPrice, p_reason: 'แก้ต้นทุน' })
  }

  // Quantity typed on the edit form: more = stock receiving, less = stock taken out (both PIN).
  const qtyDelta = Number(product.totalQuantity ?? 0) - Number(previous.totalQuantity ?? 0)
  if (qtyDelta > 0) {
    await receiveStock(product.id, qtyDelta, 'เพิ่มจำนวนจากหน้าแก้ไขสินค้า', product.name)
  } else if (qtyDelta < 0) {
    await adjustStock({
      productId: product.id, productName: product.name, from: 'AVAILABLE', to: null,
      quantity: -qtyDelta, reason: 'ลดจำนวนจากหน้าแก้ไขสินค้า',
    })
  }

  if ((product.status || 'ACTIVE') !== (previous.status || 'ACTIVE')) {
    await rpc('product_set_active', {
      p_product_id: product.id,
      p_active: product.status !== 'INACTIVE',
      p_reason: product.status === 'INACTIVE' ? 'ปิดใช้งานสินค้า' : 'เปิดใช้งานสินค้า',
    })
  }
  return product.id
}

/** Products are never hard-deleted (Master §3.3): "delete" = deactivate. */
export async function deleteProductFromSupabase(id: string): Promise<void> {
  await rpc('product_set_active', { p_product_id: id, p_active: false, p_reason: 'ลบสินค้าออกจากรายการขาย/เช่า' })
}

export async function saveCategoryToSupabase(category: { id?: string; name: string; isActive?: boolean }): Promise<string> {
  const r = await rpc<{ id: string }>('product_category_save', {
    p_category_id: category.id && isValidUUID(category.id) ? category.id : null,
    p_name: category.name,
    p_active: category.isActive !== false,
  })
  return r.id
}

/** Categories in use cannot disappear: "delete" = deactivate. */
export async function deleteCategoryFromSupabase(id: string, name: string): Promise<void> {
  await rpc('product_category_save', { p_category_id: id, p_name: name, p_active: false })
}

export async function saveUnitToSupabase(unit: { id?: string; name: string; isActive?: boolean; sortOrder?: number }): Promise<string> {
  const r = await rpc<{ id: string }>('unit_save', {
    p_unit_id: unit.id && isValidUUID(unit.id) ? unit.id : null,
    p_name: unit.name,
    p_active: unit.isActive !== false,
    p_sort_order: unit.sortOrder,
  })
  return r.id
}

export async function deleteUnitFromSupabase(id: string, name: string): Promise<void> {
  await rpc('unit_save', { p_unit_id: id, p_name: name, p_active: false })
}

// ─── stock (all PIN + audit, Master §4.4 / §11) ─────────────────────────────

export interface StockMovementRow {
  id: string
  product_id: string
  stock_state: string
  quantity_delta: number
  movement_type: string
  source_type: string
  source_id: string
  reason: string | null
  created_at: string
  created_by: string
}

export async function fetchStockMovementsFromSupabase(productId?: string): Promise<StockMovementRow[]> {
  if (isPlaceholderConfig()) return []
  const supabase = createClient()
  let q = supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(2000)
  if (productId) q = q.eq('product_id', productId)
  return selectRows<StockMovementRow>(q)
}

/** รับสินค้าเข้าสต็อก — PIN + audit (owner decision 2026-10-04). */
export async function receiveStock(productId: string, quantity: number, reason: string, productName?: string): Promise<void> {
  const key = newIdempotencyKey()
  await withPin(
    { action: 'STOCK_RECEIVE', title: 'ยืนยันรับสินค้าเข้าสต็อก', detail: `${productName ?? ''} จำนวน ${quantity}` },
    (token) => rpc('stock_receive', {
      p_product_id: productId, p_quantity: quantity, p_reason: reason, p_idempotency_key: key, p_pin_token: token,
    })
  )
}

export type AdjustableState = 'AVAILABLE' | 'INSPECTION' | 'REPAIR' | 'DAMAGED' | 'LOST' | 'WRITTEN_OFF' | 'INACTIVE'

/** ปรับสต็อก: move quantity between states, or in/out of stock (from/to null). PIN + reason. */
export async function adjustStock(opts: {
  productId: string
  productName?: string
  from: AdjustableState | null
  to: AdjustableState | null
  quantity: number
  reason: string
}): Promise<void> {
  const key = newIdempotencyKey()
  await withPin(
    { action: 'STOCK_ADJUST', title: 'ยืนยันปรับสต็อก', detail: `${opts.productName ?? ''} จำนวน ${opts.quantity}` },
    (token) => rpc('stock_adjust', {
      p_product_id: opts.productId, p_from_state: opts.from, p_to_state: opts.to, p_quantity: opts.quantity,
      p_reason: opts.reason, p_idempotency_key: key, p_pin_token: token,
    })
  )
}

/** แปลงของชำรุด A → B ในรายการเดียว (atomic, Master §11.5). */
export async function convertDamagedStock(opts: {
  fromProductId: string
  toProductId: string
  fromQuantity: number
  toQuantity: number
  reason: string
}): Promise<void> {
  const key = newIdempotencyKey()
  await withPin(
    { action: 'STOCK_CONVERT', title: 'ยืนยันแปลงของชำรุด', detail: `${opts.fromQuantity} → ${opts.toQuantity}` },
    (token) => rpc('convert_damaged_stock', {
      p_from_product_id: opts.fromProductId, p_to_product_id: opts.toProductId, p_from_quantity: opts.fromQuantity,
      p_to_quantity: opts.toQuantity, p_reason: opts.reason, p_idempotency_key: key, p_pin_token: token,
    })
  )
}

/** Stock count: open → record counted lines → confirm with PIN (creates the adjustments). */
export async function confirmStockCount(
  lines: Array<{ productId: string; countedQty: number }>,
  note?: string
): Promise<void> {
  // PIN first: cancelling it opens no count round at all. After the PIN the round is opened,
  // recorded and confirmed straight away; if a step fails the round stays a draft (OPEN /
  // COUNTED) and stock is unchanged — only stock_count_confirm moves stock.
  await withPin({ action: 'STOCK_COUNT_CONFIRM', title: 'ยืนยันผลนับสต็อก', detail: `${lines.length} รายการ` }, async (token) => {
    const count = await rpc<{ id: string }>('stock_count_open', { p_note: note ?? null })
    // The server opens a line for every active product and confirms only when all are counted:
    // products not counted on screen keep their snapshot (no change).
    const snapshot = await selectRows<{ product_id: string; snapshot_qty: number }>(
      createClient().from('stock_count_lines').select('product_id, snapshot_qty').eq('stock_count_id', count.id)
    )
    const counted = new Map(lines.map((l) => [l.productId, l.countedQty]))
    const missing = lines.filter((l) => !snapshot.some((s) => s.product_id === l.productId))
    if (missing.length > 0) {
      throw new Error(`นับสต็อกไม่ได้: มีสินค้าที่ปิดใช้งานหรือไม่อยู่ในรอบนับ ${missing.length} รายการ`)
    }
    await rpc('stock_count_record', {
      p_count_id: count.id,
      // Every line that changes stock needs a reason (stock_count_confirm rejects it otherwise);
      // the round's note serves as that reason.
      p_lines: snapshot.map((s) => ({
        product_id: s.product_id,
        counted_qty: counted.get(s.product_id) ?? Number(s.snapshot_qty),
        reason: note || 'ตรวจนับสต็อก',
      })),
    })
    return rpc('stock_count_confirm', { p_count_id: count.id, p_pin_token: token })
  })
}
