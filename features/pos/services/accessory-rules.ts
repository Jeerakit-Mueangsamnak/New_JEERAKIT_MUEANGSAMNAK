/**
 * Accessory windows (owner 2026-11-09): column nuts and scaffold parts are added to a bill by formula.
 * The lines are ordinary rental lines: no rental charge (the products are "ไม่คิดเงิน"), stock is held and
 * returned through the normal bill flow, and loss / damage is charged at return from each product's own
 * fees.
 *
 * Shop set-up (สินค้า › หมวด อื่นๆ): one "รายการ" per window — every nut size sits in รายการ "น็อต" (the size is in
 * the product name, e.g. "น็อต 16นิ้ว"); every scaffold part sits in รายการ "อุปกรณ์นั่งร้าน" (the part is the
 * start of the name: กากบาท / ครอบนั่งร้าน / ข้อต่อ). The POS shows each of these รายการ as ONE card.
 */
import type { Product } from '@/lib/types/rental-pos'

export const ACCESSORY_CATEGORY = 'อื่นๆ'
export const NUT_LIST_ITEM = 'น็อต'
export const SCAFFOLD_LIST_ITEM = 'อุปกรณ์นั่งร้าน'

/** Column section → nut length (inches). */
export const NUT_SECTIONS = [
  { label: 'เสา 15×15', inch: 12 },
  { label: 'เสา 20×20', inch: 14 },
  { label: 'เสา 25×25', inch: 16 },
] as const

/** Column height → nuts per column. */
export const NUT_HEIGHTS = [
  { label: '1.00 ม.', perColumn: 4 },
  { label: '1.50 ม.', perColumn: 6 },
  { label: '2.00 ม.', perColumn: 8 },
  { label: '3.00 ม.', perColumn: 12 },
  { label: '3.50 ม.', perColumn: 14 },
] as const

/** One scaffold set uses these parts (owner 2026-11-09: joints are counted in pieces). */
export const SCAFFOLD_PARTS = [
  { key: 'CROSS', label: 'กากบาท', perSet: 1 },
  { key: 'CAP', label: 'ครอบนั่งร้าน', perSet: 1 },
  { key: 'JOINT', label: 'ข้อต่อ', perSet: 4 },
] as const
export type ScaffoldPartKey = (typeof SCAFFOLD_PARTS)[number]['key']
export type AccessoryWindow = 'NUT' | 'SCAFFOLD'

const squash = (s: string | null | undefined) => (s || '').replace(/\s+/g, '')

export const nutTotal = (perColumn: number, columns: number) => Math.max(0, perColumn) * Math.max(0, Math.floor(columns))

export function scaffoldPartQuantities(sets: number): Record<ScaffoldPartKey, number> {
  const n = Math.max(0, Math.floor(sets))
  return Object.fromEntries(SCAFFOLD_PARTS.map((p) => [p.key, p.perSet * n])) as Record<ScaffoldPartKey, number>
}

/**
 * The POS หมวด whose cards the accessory card follows, always last (owner 2026-11-11): น็อต → แบบเสา,
 * อุปกรณ์นั่งร้าน → นั่งร้าน. The products themselves stay in หมวด อื่นๆ.
 */
export const ACCESSORY_HOST_CATEGORY: Record<AccessoryWindow, string> = { NUT: 'แบบเสา', SCAFFOLD: 'นั่งร้าน' }

/** The name among `categoryNames` that hosts this window's card (spaces ignored); null = not on screen. */
export function accessoryHostCategory(window: AccessoryWindow, categoryNames: readonly string[]): string | null {
  return categoryNames.find((name) => squash(name) === squash(ACCESSORY_HOST_CATEGORY[window])) ?? null
}

/** Which accessory window a product belongs to (by its หมวด อื่นๆ › รายการ); null = an ordinary product. */
export function accessoryWindowFor(product: Pick<Product, 'category' | 'listItem'>): AccessoryWindow | null {
  if (squash(product.category) !== squash(ACCESSORY_CATEGORY)) return null
  const item = squash(product.listItem)
  if (item === squash(NUT_LIST_ITEM)) return 'NUT'
  if (item === squash(SCAFFOLD_LIST_ITEM)) return 'SCAFFOLD'
  return null
}

const inGroup = (products: Product[], window: AccessoryWindow) =>
  products.filter((p) => p.status === 'ACTIVE' && accessoryWindowFor(p) === window)

/** Inches written in a nut's name ("น็อต 16นิ้ว" → 16). */
export function nutInches(name: string | null | undefined): number | null {
  const m = /(\d+)\s*นิ้ว/.exec(name || '')
  return m ? Number(m[1]) : null
}

/** The active nut of this length in รายการ "น็อต" (null when none is set up). */
export function findNutProduct(products: Product[], inch: number): Product | null {
  return inGroup(products, 'NUT').find((p) => nutInches(p.name) === inch) ?? null
}

/** The active scaffold part in รายการ "อุปกรณ์นั่งร้าน" whose name starts with the part's name. */
export function findScaffoldPart(products: Product[], key: ScaffoldPartKey): Product | null {
  const label = squash(SCAFFOLD_PARTS.find((p) => p.key === key)!.label)
  return inGroup(products, 'SCAFFOLD').find((p) => squash(p.name).startsWith(label)) ?? null
}

/** A rental product the shop does not charge rent for (shown as "ไม่คิดเงิน"). */
export const isNoChargeRental = (p: Pick<Product, 'isChargeable'>) => p.isChargeable === false

/**
 * A RENTAL line of the shop's "ไม่คิดเงิน" (already "-" where a line carries no charge) that is still
 * waiting for its flag: price 0 and not a sale. Only pass products whose price is not editable.
 */
export const isUnchargedRental = (line: { rentalType?: string | null; price?: number | null; isNoCharge?: boolean }) =>
  line.isNoCharge ?? (line.rentalType !== 'SALE' && Number(line.price ?? 0) === 0)

/**
 * A bill line of a "ไม่คิดเงิน" rental (owner 2026-11-09): only จำนวน and หน่วย are shown, the money
 * columns are "-". The product's flag decides; a line whose flag is not known counts only when it
 * carries no money at all (never a line whose price was overridden to 0).
 */
export const isNoChargeBillLine = (line: { rentalType?: string | null; isNoCharge?: boolean; isChargeable?: boolean; dailyRate?: number | null; lineTotal?: number | null }) => {
  if (line.isNoCharge !== undefined) return line.isNoCharge
  if (line.rentalType === 'SALE') return false
  if (line.isChargeable !== undefined) return line.isChargeable === false
  return Number(line.dailyRate ?? 0) === 0 && Number(line.lineTotal ?? 0) === 0
}
