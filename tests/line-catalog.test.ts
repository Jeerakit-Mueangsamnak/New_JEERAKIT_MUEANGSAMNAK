import { describe, expect, it, vi } from 'vitest'
import { assertValidMessages } from '@/lib/line/messages'
import { MockLineProvider } from '@/lib/line/mock-provider'
import { signLineBody } from '@/lib/line/signature'
import { handleLineWebhook, type WebhookStore } from '@/lib/line/webhook'
import { type LineMessage } from '@/lib/line/types'
import {
  CATALOG_PAGE_SIZE,
  catalogData,
  categoriesMessages,
  inquiryReply,
  itemRows,
  itemsMessages,
  mainMenuMessages,
  parseCatalogPostback,
  type CatalogCategory,
  type CatalogContext,
  type CatalogItem,
  type CatalogPage,
} from '@/lib/line/catalog'

/** The product list and chat menu anyone may use after adding the OA (owner 2026-11-21). */

const CAT = '11111111-2222-4333-8444-0000000000a1'
const ITEM = '11111111-2222-4333-8444-0000000000b1'
const SECRET = '0123456789abcdef0123456789abcdef'
const STRANGER = 'U' + 'e'.repeat(32)
const ctx: CatalogContext = { shopName: 'ร้านเอ', phone: '081-234-5678', registerUrl: null }

const flexOf = (m: LineMessage) => (m.type === 'flex' ? m : null)
/** Every postback of a flex message, as the text the person sees → the data LINE will send back. */
function actionsOf(m: LineMessage): Array<{ label: string; data?: string; displayText?: string; uri?: string }> {
  const out: Array<{ label: string; data?: string; displayText?: string; uri?: string }> = []
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>
      if (o.action && typeof o.action === 'object') out.push(o.action as never)
      Object.values(o).forEach(walk)
    }
  }
  walk(flexOf(m)?.contents)
  return out
}

describe('catalog presses', () => {
  it('round-trip and refuse anything that is not a well-formed catalog press', () => {
    for (const a of [{ a: 'main' }, { a: 'home' }, { a: 'contact' }, { a: 'info' }, { a: 'register' }] as const) expect(parseCatalogPostback(catalogData(a))).toEqual(a)
    expect(parseCatalogPostback(catalogData({ a: 'cat', c: CAT, pg: 0 }))).toEqual({ a: 'cat', c: CAT, pg: 0 })
    expect(parseCatalogPostback(catalogData({ a: 'cat', c: CAT, pg: 3 }))).toEqual({ a: 'cat', c: CAT, pg: 3 })
    expect(parseCatalogPostback(catalogData({ a: 'price', p: ITEM }))).toEqual({ a: 'price', p: ITEM })
    expect(parseCatalogPostback(catalogData({ a: 'preorder', p: ITEM }))).toEqual({ a: 'preorder', p: ITEM })
    for (const bad of [null, '', 'kind=task&task=x', 'kind=catalog', 'kind=catalog&a=drop', 'kind=catalog&a=cat&c=nope', 'kind=catalog&a=price&p=1; drop', `kind=catalog&a=cat&c=${CAT}&pg=-1`, `kind=catalog&a=cat&c=${CAT}&pg=1.5`]) {
      expect(parseCatalogPostback(bad as string | null)).toBeNull()
    }
  })
})

describe('categoriesMessages', () => {
  it('nothing ticked: only the "ไม่มีรายการ" text with the shop phone', () => {
    const m = categoriesMessages([], ctx)
    expect(m).toHaveLength(1)
    expect(m[0]).toEqual({ type: 'text', text: expect.stringContaining('081-234-5678') })
  })

  it('a button per category (the name is what the person sees in the chat), then contact and main menu; valid for LINE', () => {
    const cats: CatalogCategory[] = [{ id: CAT, name: 'แบบคาน', count: 3 }, { id: '11111111-2222-4333-8444-0000000000a2', name: 'นั่งร้าน', count: 2 }]
    const m = categoriesMessages(cats, ctx)
    assertValidMessages(m)
    const acts = actionsOf(m[1])
    expect(acts.map((a) => a.label)).toEqual(['แบบคาน', 'นั่งร้าน', 'ติดต่อเจ้าหน้าที่', 'กลับเมนูหลัก'])
    expect(parseCatalogPostback(acts[0].data)).toEqual({ a: 'cat', c: CAT, pg: 0 })
    expect(acts[0].displayText).toBe('แบบคาน')
  })
})

describe('itemsMessages', () => {
  const items = (n: number): CatalogItem[] => Array.from({ length: n }, (_, i) => ({ id: `11111111-2222-4333-8444-0000000001${String(i).padStart(2, '0')}`, name: `แบบคาน 40x${i + 1}.00`, unit: 'ชิ้น' }))
  const page = (n: number, total: number): CatalogPage => ({ category: { id: CAT, name: 'แบบคาน' }, show_price: false, total, items: items(n) })

  it('a card per product with the two questions, then a card to move on; the question lines name the product', () => {
    const m = itemsMessages(page(3, 3), 0, ctx)
    assertValidMessages(m)
    expect(m[0]).toEqual({ type: 'text', text: 'รายการในหมวด แบบคาน' })
    const carousel = flexOf(m[1])!.contents as { type: string; contents: unknown[] }
    expect(carousel.type).toBe('carousel')
    expect(carousel.contents).toHaveLength(4) // 3 products + the last card
    const acts = actionsOf(m[1])
    const price = acts.find((a) => a.label === 'สอบถามราคา')!
    expect(price.displayText).toBe('สอบถามราคา: แบบคาน 40x1.00')
    expect(parseCatalogPostback(price.data)).toEqual({ a: 'price', p: items(3)[0].id })
    expect(acts.find((a) => a.label === 'สอบถามสั่งล่วงหน้า')?.displayText).toBe('สอบถามสั่งสินค้าล่วงหน้า: แบบคาน 40x1.00')
    // everything the spec asks for is on the last card
    for (const label of ['ติดต่อเจ้าหน้าที่', 'กลับหมวดหมู่สินค้า', 'กลับเมนูหลัก']) expect(acts.some((a) => a.label === label)).toBe(true)
    expect(acts.some((a) => a.label === 'ดูรายการถัดไป')).toBe(false) // nothing more
  })

  it('a full page offers the next page, and the page range is told', () => {
    const m = itemsMessages(page(CATALOG_PAGE_SIZE, 13), 0, ctx)
    assertValidMessages(m)
    const next = actionsOf(m[1]).find((a) => a.label === 'ดูรายการถัดไป')!
    expect(parseCatalogPostback(next.data)).toEqual({ a: 'cat', c: CAT, pg: 1 })
    expect(JSON.stringify(flexOf(m[1])!.contents)).toContain('แสดง 1–10 จาก 13 รายการ')
    // a 12-card carousel is LINE's limit: 10 products + the last card stays under it
    expect((flexOf(m[1])!.contents as unknown as { contents: unknown[] }).contents).toHaveLength(11)
  })

  it('prices only when the database sent them: rental with its period word, sale; never anything else', () => {
    expect(itemRows({ id: ITEM, name: 'ก', unit: 'ชิ้น' })).toEqual([{ label: 'หน่วย', value: 'ชิ้น' }])
    expect(itemRows({ id: ITEM, name: 'ก', rental_price: 12.5, per: 'PER_DAY', sale_price: 300 })).toEqual([
      { label: 'ราคาเช่า', value: '12.5 บาท ต่อวัน' },
      { label: 'ราคาขาย', value: '300 บาท' },
    ])
    expect(itemRows({ id: ITEM, name: 'ก', rental_price: 40, per: 'PER_PERIOD' })[0].value).toBe('40 บาท ต่อรอบ')
    expect(itemRows({ id: ITEM, name: 'ก', rental_price: 8, per: 'PER_UNIT' })[0].value).toBe('8 บาท')
  })

  it('an empty page falls back to the "nothing to show" text', () => {
    expect(itemsMessages(page(0, 0), 0, ctx)).toHaveLength(1)
  })
})

describe('chat menu and answers', () => {
  it('the main menu has every choice of the spec, valid for LINE; the register button is the form when there is one', () => {
    const noForm = mainMenuMessages(ctx)
    assertValidMessages(noForm)
    const labels = actionsOf(noForm[0]).map((a) => a.label)
    for (const l of ['ดูรายการสินค้า', 'สอบถามราคา', 'สอบถามสั่งล่วงหน้า', 'ลงทะเบียน / ผูกบัญชี', 'ติดต่อร้าน', 'ข้อมูลร้าน/เวลาทำการ']) expect(labels).toContain(l)
    expect(actionsOf(noForm[0]).find((a) => a.label === 'ลงทะเบียน / ผูกบัญชี')?.data).toBeTruthy()
    const withForm = mainMenuMessages({ ...ctx, registerUrl: 'https://liff.line.me/123/register' })
    expect(actionsOf(withForm[0]).find((a) => a.label === 'ลงทะเบียน / ผูกบัญชี')?.uri).toBe('https://liff.line.me/123/register')
  })

  it('a price question is only an answer; a pre-order question says plainly it is not an order or a reservation', () => {
    expect(inquiryReply('price', 'แบบคาน 40x1.00', ctx)).toEqual({ type: 'text', text: 'รับเรื่องสอบถามราคา: แบบคาน 40x1.00 เจ้าหน้าที่จะตอบกลับในแชตนี้' })
    const pre = inquiryReply('preorder', 'แบบคาน 40x1.00', ctx) as { text: string }
    expect(pre.text).toContain('ยังไม่ใช่การยืนยันคำสั่งซื้อหรือการจองสินค้า')
    expect(pre.text).not.toMatch(/พร้อมส่ง|มีสินค้า|ชำระ/)
  })
})

describe('webhook: the product list for someone nobody has confirmed', () => {
  const category: CatalogCategory = { id: CAT, name: 'แบบคาน', count: 2 }
  const page: CatalogPage = { category: { id: CAT, name: 'แบบคาน' }, show_price: false, total: 1, items: [{ id: ITEM, name: 'แบบคาน 40x1.00', unit: 'ชิ้น' }] }

  const store = (over: Partial<WebhookStore> = {}) =>
    ({
      recordEvent: vi.fn(async () => ({ duplicate: false, contactId: 'c', status: 'UNLINKED' as const })),
      consumeLinkCode: vi.fn(async () => ({ result: 'INVALID' as const })),
      taskPostback: vi.fn(async () => ({ result: 'NOT_FOUND' as const })),
      taskStep: vi.fn(async () => ({ result: 'NOT_FOUND' as const })),
      catalogCategories: vi.fn(async () => [category]),
      catalogItems: vi.fn(async (id: string) => (id === CAT ? page : null)),
      catalogItem: vi.fn(async (id: string) => (id === ITEM ? { id: ITEM, name: 'แบบคาน 40x1.00' } : null)),
      ...over,
    }) as WebhookStore

  async function press(data: string, s: WebhookStore, provider = new MockLineProvider()) {
    const event = { type: 'postback', webhookEventId: `pb-${Math.random()}`, timestamp: 1791475200000, replyToken: 'rt-1', source: { type: 'user', userId: STRANGER }, postback: { data } }
    const rawBody = JSON.stringify({ destination: 'Uxxx', events: [event] })
    await handleLineWebhook({ rawBody, signature: await signLineBody(SECRET, rawBody), channelSecret: SECRET, store: s, provider, shopName: 'ร้านเอ', shopPhone: '081-234-5678' })
    return provider
  }

  it('ดูรายการสินค้า: a stranger gets the ticked categories in the free reply (no push)', async () => {
    const s = store()
    const provider = await press(catalogData({ a: 'home' }), s)
    expect(s.catalogCategories).toHaveBeenCalled()
    expect(provider.pushed).toHaveLength(0)
    expect(provider.replied).toHaveLength(1)
    expect(actionsOf(provider.replied[0].messages[1]).map((a) => a.label)).toContain('แบบคาน')
  })

  it.each(['DUPLICATE', 'RATE_LIMITED', 'SUSPENDED'] as const)('%s stops before any product query or chat reply', async (result) => {
    const checkInteraction = vi.fn(async () => ({ allowed: false, result }))
    const s = store({ checkInteraction })
    const provider = await press(catalogData({ a: 'price', p: ITEM }), s)
    expect(checkInteraction).toHaveBeenCalledWith(STRANGER, 'INQUIRY', catalogData({ a: 'price', p: ITEM }))
    expect(s.catalogItem).not.toHaveBeenCalled()
    expect(s.catalogItems).not.toHaveBeenCalled()
    expect(s.catalogCategories).not.toHaveBeenCalled()
    expect(provider.replied).toHaveLength(0)
  })

  it('a category opens its first page; a category the owner un-ticked meanwhile goes back to the categories', async () => {
    const s = store()
    const ok = await press(catalogData({ a: 'cat', c: CAT, pg: 0 }), s)
    expect(s.catalogItems).toHaveBeenCalledWith(CAT, 0)
    expect(actionsOf(ok.replied[0].messages[1]).some((a) => a.label === 'สอบถามราคา')).toBe(true)
    const gone = await press(catalogData({ a: 'cat', c: '11111111-2222-4333-8444-0000000000a9', pg: 0 }), s)
    expect(actionsOf(gone.replied[0].messages[1]).map((a) => a.label)).toContain('แบบคาน')
  })

  it('สอบถามราคา / สอบถามสั่งล่วงหน้า: answered in the chat with the product name; nothing is ordered (no store call but the name lookup)', async () => {
    const s = store()
    const price = await press(catalogData({ a: 'price', p: ITEM }), s)
    expect(price.replied[0].messages).toEqual([{ type: 'text', text: 'รับเรื่องสอบถามราคา: แบบคาน 40x1.00 เจ้าหน้าที่จะตอบกลับในแชตนี้' }])
    const pre = await press(catalogData({ a: 'preorder', p: ITEM }), s)
    expect((pre.replied[0].messages[0] as { text: string }).text).toContain('ไม่ใช่การยืนยันคำสั่งซื้อ')
    expect(s.catalogItem).toHaveBeenCalledWith(ITEM)
    expect(s.taskPostback).not.toHaveBeenCalled()
  })

  it('a product that is not shown (or never was) gets the categories, never its name', async () => {
    const s = store()
    const provider = await press(catalogData({ a: 'price', p: '11111111-2222-4333-8444-0000000000ff' }), s)
    expect(JSON.stringify(provider.replied[0].messages)).not.toContain('รับเรื่องสอบถามราคา')
    expect(actionsOf(provider.replied[0].messages[1]).map((a) => a.label)).toContain('แบบคาน')
  })

  it('ติดต่อร้าน / ข้อมูลร้าน / ลงทะเบียน / เมนูหลัก all answer', async () => {
    const s = store()
    expect(((await press(catalogData({ a: 'contact' }), s)).replied[0].messages[0] as { text: string }).text).toContain('081-234-5678')
    expect(((await press(catalogData({ a: 'info' }), s)).replied[0].messages[0] as { text: string }).text).toContain('ร้านเอ')
    expect(((await press(catalogData({ a: 'register' }), s)).replied[0].messages[0] as { text: string }).text).toContain('เบอร์โทร')
    expect(actionsOf((await press(catalogData({ a: 'main' }), s)).replied[0].messages[0]).length).toBeGreaterThanOrEqual(6)
  })

  it('a store without a product list (an old database) still answers instead of failing', async () => {
    const s = store({ catalogCategories: undefined })
    const provider = await press(catalogData({ a: 'home' }), s)
    expect(provider.replied[0].messages[0]).toEqual({ type: 'text', text: expect.stringContaining('ยังไม่มีรายการสินค้า') })
  })
})
