import { cardBubble, cardMessage, carouselMessage, type FlexButton, type FlexRow } from './flex'
import { textMessage, type TemplateOverrides } from './templates'
import { type LineMessage } from './types'

/**
 * The product list a person sees in the OA chat (owner 2026-11-21): text and buttons only, no pictures. What is shown
 * comes from the database (only what the owner ticked, price only when the owner allows it); this file builds the
 * messages and reads the button presses. A press is a postback (`kind=catalog&a=…`), so it also works for someone who has
 * not registered. "สอบถามราคา" / "สอบถามสั่งสินค้าล่วงหน้า" put a line in the chat for the shop to read (displayText) and
 * answer in the chat: they never make a bill, never touch stock and never take payment.
 */

export interface CatalogCategory {
  id: string
  name: string
  count: number
}
export interface CatalogItem {
  id: string
  name: string
  unit?: string
  rental_price?: number
  sale_price?: number
  /** products.calculation_type of a rental price: PER_UNIT / PER_DAY / PER_PERIOD */
  per?: string
}
export interface CatalogPage {
  category: { id: string; name: string }
  show_price: boolean
  total: number
  items: CatalogItem[]
}

export const CATALOG_PAGE_SIZE = 10
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CatalogAction =
  | { a: 'main' }
  | { a: 'home' }
  | { a: 'cat'; c: string; pg: number }
  | { a: 'price' | 'preorder'; p: string }
  | { a: 'contact' }
  | { a: 'info' }
  | { a: 'register' }

export function catalogData(action: CatalogAction): string {
  const params: Record<string, string> = { kind: 'catalog', a: action.a }
  if (action.a === 'cat') {
    params.c = action.c
    if (action.pg > 0) params.pg = String(action.pg)
  }
  if (action.a === 'price' || action.a === 'preorder') params.p = action.p
  return new URLSearchParams(params).toString()
}

/** The press as the webhook reads it; anything that is not a well-formed catalog press is null. */
export function parseCatalogPostback(data: string | null | undefined): CatalogAction | null {
  if (!data) return null
  const q = new URLSearchParams(data)
  if (q.get('kind') !== 'catalog') return null
  const a = q.get('a')
  if (a === 'main' || a === 'home' || a === 'contact' || a === 'info' || a === 'register') return { a }
  if (a === 'cat') {
    const c = q.get('c') ?? ''
    const pg = Number(q.get('pg') ?? '0')
    return UUID.test(c) && Number.isInteger(pg) && pg >= 0 && pg < 1000 ? { a, c, pg } : null
  }
  if (a === 'price' || a === 'preorder') {
    const p = q.get('p') ?? ''
    return UUID.test(p) ? { a, p } : null
  }
  return null
}

export interface CatalogContext {
  shopName: string
  phone: string | null
  templates?: TemplateOverrides
  /** https://liff.line.me/<id>/register when the registration form is set up; else the typed way is explained */
  registerUrl?: string | null
}

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const ctxVars = (ctx: CatalogContext) => ({ ชื่อร้าน: ctx.shopName, เบอร์โทรร้าน: ctx.phone || '-' })

/** Price lines of one product. Only what the database sent (it sends none unless the owner switched prices on). */
export function itemRows(item: CatalogItem): FlexRow[] {
  const rows: FlexRow[] = []
  if (item.unit) rows.push({ label: 'หน่วย', value: item.unit })
  if (item.rental_price !== undefined) {
    const per = item.per === 'PER_DAY' ? ' ต่อวัน' : item.per === 'PER_PERIOD' ? ' ต่อรอบ' : ''
    rows.push({ label: 'ราคาเช่า', value: `${baht(item.rental_price)} บาท${per}` })
  }
  if (item.sale_price !== undefined) rows.push({ label: 'ราคาขาย', value: `${baht(item.sale_price)} บาท` })
  return rows
}

const nav = (action: CatalogAction, label: string, displayText?: string): FlexButton => ({ label, postback: catalogData(action), ...(displayText ? { displayText } : {}) })

/** กลับเมนูหลัก: the same choices as the chat menu, for the person who is deep in the list. */
export function mainMenuMessages(ctx: CatalogContext): LineMessage[] {
  const buttons: FlexButton[] = [
    { ...nav({ a: 'home' }, 'ดูรายการสินค้า', 'ดูรายการสินค้า'), primary: true },
    nav({ a: 'home' }, 'สอบถามราคา', 'สอบถามราคา'),
    nav({ a: 'home' }, 'สอบถามสั่งล่วงหน้า', 'สอบถามสั่งสินค้าล่วงหน้า'),
    ctx.registerUrl ? { label: 'ลงทะเบียน / ผูกบัญชี', uri: ctx.registerUrl } : nav({ a: 'register' }, 'ลงทะเบียน / ผูกบัญชี', 'ลงทะเบียน / ผูกบัญชี'),
    nav({ a: 'contact' }, 'ติดต่อร้าน', 'ติดต่อร้าน'),
    nav({ a: 'info' }, 'ข้อมูลร้าน/เวลาทำการ', 'ข้อมูลร้านและเวลาทำการ'),
  ]
  return [cardMessage({ altText: `เมนูหลัก ${ctx.shopName}`, title: ctx.shopName, text: 'เมนูหลัก', buttons, maxButtons: 6 })]
}

/** Category choices (or the "nothing to show" text). Up to 8 categories in one card. */
export function categoriesMessages(categories: CatalogCategory[], ctx: CatalogContext): LineMessage[] {
  if (categories.length === 0) return [textMessage('CATALOG_EMPTY', ctx.phone ? { เบอร์โทรร้าน: ctx.phone } : { เบอร์โทรร้าน: '-' }, ctx.templates)]
  const buttons = categories.slice(0, 8).map((c, i) => ({ ...nav({ a: 'cat', c: c.id, pg: 0 }, c.name, c.name), primary: i === 0 }))
  return [
    textMessage('CATALOG_INTRO', {}, ctx.templates),
    cardMessage({ altText: 'หมวดหมู่สินค้า', title: 'หมวดหมู่สินค้า', buttons: [...buttons, nav({ a: 'contact' }, 'ติดต่อเจ้าหน้าที่', 'ติดต่อเจ้าหน้าที่'), nav({ a: 'main' }, 'กลับเมนูหลัก', 'กลับเมนูหลัก')], maxButtons: 10 }),
  ]
}

/** One page of a category: a card per product (ask the price / ask to pre-order) and a last card to move on. */
export function itemsMessages(page: CatalogPage, pg: number, ctx: CatalogContext): LineMessage[] {
  if (page.items.length === 0) return categoriesMessages([], ctx)
  const bubbles = page.items.map((item) =>
    cardBubble({
      altText: item.name,
      title: item.name,
      rows: itemRows(item),
      buttons: [
        { ...nav({ a: 'price', p: item.id }, 'สอบถามราคา', `สอบถามราคา: ${item.name}`), primary: true },
        nav({ a: 'preorder', p: item.id }, 'สอบถามสั่งล่วงหน้า', `สอบถามสั่งสินค้าล่วงหน้า: ${item.name}`),
      ],
    }),
  )
  const more = (pg + 1) * CATALOG_PAGE_SIZE < page.total
  bubbles.push(
    cardBubble({
      altText: 'เมนู',
      title: page.category.name,
      text: `แสดง ${pg * CATALOG_PAGE_SIZE + 1}–${pg * CATALOG_PAGE_SIZE + page.items.length} จาก ${page.total} รายการ`,
      buttons: [
        ...(more ? [{ ...nav({ a: 'cat', c: page.category.id, pg: pg + 1 }, 'ดูรายการถัดไป', 'ดูรายการถัดไป'), primary: true }] : []),
        nav({ a: 'contact' }, 'ติดต่อเจ้าหน้าที่', 'ติดต่อเจ้าหน้าที่'),
        nav({ a: 'home' }, 'กลับหมวดหมู่สินค้า', 'กลับหมวดหมู่สินค้า'),
        nav({ a: 'main' }, 'กลับเมนูหลัก', 'กลับเมนูหลัก'),
      ],
    }),
  )
  return [textMessage('CATALOG_ITEMS_INTRO', { หมวด: page.category.name }, ctx.templates), carouselMessage(page.category.name, bubbles)]
}

/** The answer to "สอบถามราคา" / "สอบถามสั่งสินค้าล่วงหน้า": the shop answers in this chat; nothing is ordered or reserved. */
export function inquiryReply(kind: 'price' | 'preorder', itemName: string, ctx: CatalogContext): LineMessage {
  return textMessage(kind === 'price' ? 'PRICE_INQUIRY_REPLY' : 'PREORDER_INQUIRY_REPLY', { รายการ: itemName }, ctx.templates)
}

export const contactReply = (ctx: CatalogContext): LineMessage => textMessage('CONTACT_SHOP', ctxVars(ctx), ctx.templates)
export const shopInfoReply = (ctx: CatalogContext): LineMessage => textMessage('SHOP_INFO', ctxVars(ctx), ctx.templates)
export const registerHowtoReply = (ctx: CatalogContext): LineMessage => textMessage('REGISTER_HOWTO', {}, ctx.templates)
