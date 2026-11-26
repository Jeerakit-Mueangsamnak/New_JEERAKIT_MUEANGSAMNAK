import labels from './rich-menu.labels.json'
import { catalogData } from './catalog'
import { menuData } from './role-menu'

/**
 * The chat menus (LINE "rich menu", owner 2026-11-21): four menus, one per kind of person. The names on the buttons and
 * the grid are in rich-menu.labels.json (the picture is drawn from the same file); this file turns them into what LINE
 * asks for and reads LINE's rules (image size, number of areas) from the official documentation:
 * https://developers.line.biz/en/docs/messaging-api/using-rich-menus/
 *   - image JPEG / PNG, width 800–2500 px, height at least 250 px, width/height at least 1.45, at most 1 MB
 *   - at most 20 areas, chat bar text at most 14 characters, one menu per person (a personal menu wins over the default)
 */

export type RichMenuKind = 'GENERAL' | 'CUSTOMER' | 'STAFF' | 'DRIVER' | 'OWNER'
export const RICH_MENU_KINDS: readonly RichMenuKind[] = ['GENERAL', 'CUSTOMER', 'STAFF', 'DRIVER', 'OWNER']

export const RICH_MENU_WIDTH = 2500
export const RICH_MENU_ROW_HEIGHT = 843
export const RICH_MENU_CHAT_BAR = 'เมนู'

export const RICH_MENU_IMAGE = { minWidth: 800, maxWidth: 2500, minHeight: 250, maxBytes: 1_000_000, minRatio: 1.45 } as const

interface MenuFile {
  kind: RichMenuKind
  label: string
  cols: number
  rows: number
  colour: string
  items: Array<{ id: string; label: string }>
}
const MENUS = (labels as { menus: MenuFile[] }).menus

export type RichMenuAction = { type: 'postback'; data: string; displayText: string } | { type: 'uri'; uri: string }
export interface RichMenuItem {
  id: string
  label: string
  action: RichMenuAction
}
export interface RichMenuContext {
  phone: string | null
  /** https://liff.line.me/<id>/register when the form is set up */
  registerUrl: string | null
}

export const richMenuLabel = (kind: RichMenuKind): string => MENUS.find((m) => m.kind === kind)?.label ?? kind
export const richMenuColour = (kind: RichMenuKind): string => MENUS.find((m) => m.kind === kind)?.colour ?? '#047857'
const file = (kind: RichMenuKind): MenuFile => {
  const m = MENUS.find((x) => x.kind === kind)
  if (!m) throw new Error(`RICH_MENU_UNKNOWN:${kind}`)
  return m
}

/** What a press does. Everything is a press the webhook already answers (catalog.ts), a link, or a phone call. */
function actionOf(id: string, label: string, ctx: RichMenuContext): RichMenuAction {
  const press = (a: Parameters<typeof catalogData>[0]): RichMenuAction => ({ type: 'postback', data: catalogData(a), displayText: label })
  switch (id) {
    case 'catalog':
    case 'price':
    case 'preorder':
      return press({ a: 'home' })
    case 'register':
      return ctx.registerUrl ? { type: 'uri', uri: ctx.registerUrl } : press({ a: 'register' })
    case 'contact':
      return press({ a: 'contact' })
    case 'info':
      return press({ a: 'info' })
    // the menus by role (owner 2026-11-26): lib/line/role-menu.ts answers them
    case 'bills':
    case 'pay':
    case 'return':
    case 'today':
    case 'photo':
    case 'stock':
    case 'close':
    case 'summary':
    case 'order':
    case 'slips':
    case 'approve':
      return { type: 'postback', data: menuData({ a: id }), displayText: label }
    default:
      throw new Error(`RICH_MENU_ITEM_UNKNOWN:${id}`)
  }
}

export function richMenuItems(kind: RichMenuKind, ctx: RichMenuContext): RichMenuItem[] {
  return file(kind).items.map((it) => ({ id: it.id, label: it.label, action: actionOf(it.id, it.label, ctx) }))
}

export function richMenuSize(kind: RichMenuKind): { width: number; height: number } {
  return { width: RICH_MENU_WIDTH, height: RICH_MENU_ROW_HEIGHT * file(kind).rows }
}

/** The cells of the grid, left to right then top to bottom; the last column / row takes the leftover pixel. */
export function richMenuCells(kind: RichMenuKind): Array<{ x: number; y: number; width: number; height: number }> {
  const { cols, rows } = file(kind)
  const { width } = richMenuSize(kind)
  const cellW = Math.floor(width / cols)
  const cells: Array<{ x: number; y: number; width: number; height: number }> = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: c * cellW, y: r * RICH_MENU_ROW_HEIGHT, width: c === cols - 1 ? width - c * cellW : cellW, height: RICH_MENU_ROW_HEIGHT })
    }
  }
  return cells
}

/** The body of "create rich menu". */
export function richMenuBody(kind: RichMenuKind, ctx: RichMenuContext) {
  const items = richMenuItems(kind, ctx)
  const cells = richMenuCells(kind)
  if (items.length !== cells.length) throw new Error(`RICH_MENU_GRID:${kind}`)
  return {
    size: richMenuSize(kind),
    selected: true,
    name: `jjk-${kind.toLowerCase()}-v1`,
    chatBarText: RICH_MENU_CHAT_BAR,
    areas: items.map((it, i) => ({
      bounds: cells[i],
      action: it.action.type === 'postback' ? { type: 'postback', label: it.label.slice(0, 20), data: it.action.data, displayText: it.action.displayText } : { type: 'uri', label: it.label.slice(0, 20), uri: it.action.uri },
    })),
  }
}

/** The picture must be what LINE accepts; null = fine, else the reason in Thai. */
export function validateRichMenuImage(img: { width: number; height: number; bytes: number; type: string }): string | null {
  if (img.type !== 'image/png' && img.type !== 'image/jpeg') return 'รูปเมนูต้องเป็นไฟล์ PNG หรือ JPEG'
  if (img.width < RICH_MENU_IMAGE.minWidth || img.width > RICH_MENU_IMAGE.maxWidth) return 'รูปเมนูต้องกว้าง 800–2500 พิกเซล'
  if (img.height < RICH_MENU_IMAGE.minHeight) return 'รูปเมนูต้องสูงอย่างน้อย 250 พิกเซล'
  if (img.width / img.height < RICH_MENU_IMAGE.minRatio) return 'รูปเมนูต้องกว้างกว่าสูงอย่างน้อย 1.45 เท่า'
  if (img.bytes > RICH_MENU_IMAGE.maxBytes) return 'รูปเมนูต้องมีขนาดไม่เกิน 1 MB'
  return null
}

/** Width / height of a PNG from its header (no image library needed). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: v.getUint32(16), height: v.getUint32(20) }
}

/** Who a person is for the menu: only what the shop has confirmed (a linked customer / owner / staff / driver), else general. */
export function richMenuKindOf(c: { status: string; customer_id?: string | null; profile_id?: string | null; driver_code?: string | null; role?: string | null }): RichMenuKind {
  if (c.status === 'LINKED') {
    if (c.customer_id) return 'CUSTOMER'
    if (c.profile_id) return c.role === 'OWNER' ? 'OWNER' : 'STAFF'
    if (c.driver_code) return 'DRIVER'
  }
  return 'GENERAL'
}
