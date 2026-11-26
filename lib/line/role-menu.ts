import { billDesignMessage, cardBubble, cardMessage, carouselMessage, mapUrl, telUrl, type FlexButton, type FlexRow } from './flex'
import { renderTemplate, taskPostbackData, textMessage, type TemplateOverrides } from './templates'
import { type LineMessage } from './types'

/**
 * The buttons of the chat menus by role (owner 2026-11-26, line.html "Dynamic Rich Menu"):
 *   customer: ดูบิล / ยอดค้าง · ชำระเงิน / แนบสลิป · แจ้งนัดส่งคืนสินค้า · ติดต่อเจ้าหน้าที่
 *   staff and driver: คิวส่งของ / รับคืนวันนี้ · ถ่ายรูปส่งมอบสินค้า · เช็กสต็อกสินค้าว่าง · อัปเดตปิดงาน
 *   owner: สรุปยอดรายรับวันนี้ · สั่งงานด่วนพนักงาน · ตรวจสลิปโอนเงิน · อนุมัติลูกค้าใหม่
 * A press is a postback (`kind=menu&a=…`). What it may show is decided by the database from the LINE user id and what
 * the shop confirmed (a press from anyone else gets MENU_NOT_ALLOWED). Approving slips and new customers stays in the
 * app (owner: ก); the chat shows the list and a button to that page.
 */

export const MENU_ACTIONS = ['bills', 'pay', 'return', 'today', 'photo', 'stock', 'close', 'summary', 'order', 'slips', 'approve'] as const
export type MenuActionId = (typeof MENU_ACTIONS)[number]
export type MenuAction = { a: Exclude<MenuActionId, 'stock'> } | { a: 'stock'; c?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function menuData(action: MenuAction): string {
  const params: Record<string, string> = { kind: 'menu', a: action.a }
  if (action.a === 'stock' && action.c) params.c = action.c
  return new URLSearchParams(params).toString()
}

export function parseMenuPostback(data: string | null | undefined): MenuAction | null {
  if (!data) return null
  const q = new URLSearchParams(data)
  if (q.get('kind') !== 'menu') return null
  const a = q.get('a') as MenuActionId | null
  if (!a || !(MENU_ACTIONS as readonly string[]).includes(a)) return null
  if (a === 'stock') {
    const c = q.get('c')
    if (c === null) return { a }
    return UUID.test(c) ? { a, c } : null
  }
  return { a }
}

// ---------------------------------------------------------------------------- what the database answers
export interface MenuBill {
  id: string
  bill_no: string
  status: string
  grand_total: number
  balance_due: number
  due_date: string | null
  return_at: string | null
}
export interface MenuCustomerBills {
  result: 'OK' | 'NOT_ALLOWED'
  customer_name?: string | null
  owed?: number
  rows?: MenuBill[]
}
export interface MenuReturnRequest {
  result: 'OK' | 'NOT_ALLOWED' | 'NO_BILL'
  bill_no?: string
  customer_name?: string | null
}
export interface MenuStaffJobs {
  result: 'OK' | 'NOT_ALLOWED'
  date?: string
  queue?: Array<{ id: string; type: string; title: string; start: string; status: string; place: string | null; contact: string | null; phone: string | null; bill_no: string | null }>
  tasks?: Array<{ id: string; title: string; status: string; appointment_id: string | null; driver: boolean; bill_no: string | null }>
}
export interface MenuStock {
  result: 'OK' | 'NOT_ALLOWED' | 'NOT_FOUND'
  categories?: Array<{ id: string; name: string; count: number }>
  category?: { id: string; name: string }
  total?: number
  items?: Array<{ name: string; unit: string | null; available: number; rented: number; reserved: number }>
}
export interface MenuOwner {
  result: 'OK' | 'NOT_ALLOWED' | 'INVALID_INPUT'
  date?: string
  by_method?: Array<{ method: string; amount: number }>
  income?: number
  new_bills?: number
  owed?: number
  count?: number
  rows?: Array<Record<string, unknown>>
}

export interface MenuStore {
  menuCustomerBills(lineUserId: string): Promise<MenuCustomerBills>
  menuReturnRequest(lineUserId: string, ownerMessages: (name: string, billNo: string) => LineMessage[]): Promise<MenuReturnRequest>
  menuStaffJobs(lineUserId: string): Promise<MenuStaffJobs>
  menuStock(lineUserId: string, categoryId: string | null): Promise<MenuStock>
  menuOwner(lineUserId: string, what: 'SUMMARY' | 'SLIPS' | 'REGISTER'): Promise<MenuOwner>
}

export interface MenuContext {
  shopName: string
  phone: string | null
  templates?: TemplateOverrides
  /** LIFF pay form of a bill, null when LIFF is not set up */
  payUrl: (billId: string) => string | null
  /** LIFF job form of a task (photos at handover), null when LIFF is not set up */
  jobUrl: (taskId: string) => string | null
  /** A page of the app, e.g. /line?tab=settings&view=SLIPS; null when the site address is not set */
  appUrl: (path: string) => string | null
}

// ---------------------------------------------------------------------------- building the answers
const baht = (n: number | undefined | null) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (n: number | undefined | null) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })
const thDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '')
const thTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '')
const BRAND = '#06C755'
const APPOINTMENT_TYPE: Record<string, string> = { DELIVERY: 'ส่งของ', PICKUP: 'รับของ', RETURN: 'รับคืน' }
const METHOD_LABEL: Record<string, string> = { CASH: 'เงินสด', TRANSFER: 'โอน', QR: 'QR พร้อมเพย์', CARD: 'บัตร', OTHER: 'อื่น ๆ' }
const CHECK_LABEL: Record<string, string> = { PASS: 'ตรวจผ่าน', FAIL: 'ตรวจไม่ผ่าน', ERROR: 'ตรวจไม่ได้' }

const nothing = (ctx: MenuContext): LineMessage[] => [textMessage('MENU_NOTHING', {}, ctx.templates)]
const notAllowed = (ctx: MenuContext): LineMessage[] => [textMessage('MENU_NOT_ALLOWED', {}, ctx.templates)]

/** ดูบิล / ยอดค้าง and ชำระเงิน / แนบสลิป: one card per open bill (pay: only bills still owing, with the pay form). */
export function customerBillsMessages(r: MenuCustomerBills, payOnly: boolean, ctx: MenuContext): LineMessage[] {
  if (r.result !== 'OK') return notAllowed(ctx)
  const rows = (r.rows ?? []).filter((b) => !payOnly || b.balance_due > 0)
  if (rows.length === 0) return nothing(ctx)
  const bubbles = rows.map((b) => {
    const fields: FlexRow[] = [
      { label: 'ยอดบิล', value: `${baht(b.grand_total)} บาท` },
      { label: 'ยอดค้าง', value: `${baht(b.balance_due)} บาท` },
      { label: 'กำหนดคืน', value: thDate(b.return_at) },
      { label: 'ครบกำหนดชำระ', value: thDate(b.due_date) },
    ]
    const pay = b.balance_due > 0 ? ctx.payUrl(b.id) : null
    const buttons: FlexButton[] = pay ? [{ label: 'ชำระเงิน / แนบสลิป', uri: pay, primary: true }] : []
    return cardBubble({ altText: `บิล ${b.bill_no}`, title: `บิล ${b.bill_no}`, rows: fields, buttons })
  })
  const head = `${r.customer_name ? `คุณ${r.customer_name} ` : ''}บิลที่ยังเปิดอยู่ ${rows.length} ใบ · ยอดค้างรวม ${baht(r.owed)} บาท`
  const out: LineMessage[] = [{ type: 'text', text: head }, carouselMessage(head, bubbles)]
  // the pay form needs LIFF: without it the customer is told to contact the shop
  if (payOnly && rows.every((b) => !ctx.payUrl(b.id))) out.push({ type: 'text', text: `ตอนนี้ยังแนบสลิปผ่าน LINE ไม่ได้ กรุณาติดต่อร้าน${ctx.phone ? ` โทร ${ctx.phone}` : ''}` })
  return out
}

/** คิวส่งของ / รับคืนวันนี้: today's queue, then this person's own open tasks. */
export function staffTodayMessages(r: MenuStaffJobs, ctx: MenuContext): LineMessage[] {
  if (r.result !== 'OK') return notAllowed(ctx)
  const queue = r.queue ?? []
  const tasks = r.tasks ?? []
  if (queue.length === 0 && tasks.length === 0) return nothing(ctx)
  const bubbles = queue.map((q) => {
    const buttons: FlexButton[] = []
    const map = mapUrl(q.place)
    const tel = telUrl(q.phone)
    if (map) buttons.push({ label: 'เปิดแผนที่', uri: map, primary: true })
    if (tel) buttons.push({ label: 'โทรหาลูกค้า', uri: tel })
    return cardBubble({
      altText: q.title,
      title: `${thTime(q.start)} ${APPOINTMENT_TYPE[q.type] ?? ''} · ${q.title}`,
      rows: [
        { label: 'ลูกค้า', value: q.contact ?? '' },
        { label: 'บิล', value: q.bill_no ?? '' },
        { label: 'สถานที่', value: q.place ?? '' },
      ],
      buttons,
    })
  })
  const out: LineMessage[] = [{ type: 'text', text: `คิววันนี้ ${queue.length} งาน${tasks.length ? ` · งานของคุณที่ยังไม่ปิด ${tasks.length} งาน` : ''}` }]
  if (bubbles.length) out.push(carouselMessage('คิวส่งของ / รับคืนวันนี้', bubbles))
  if (tasks.length) out.push(...closeTasksMessages(r, ctx))
  return out.slice(0, 5)
}

/** อัปเดตปิดงาน: this person's open tasks, each with the button of its next step (the task buttons the webhook knows). */
export function closeTasksMessages(r: MenuStaffJobs, ctx: MenuContext): LineMessage[] {
  if (r.result !== 'OK') return notAllowed(ctx)
  const tasks = r.tasks ?? []
  if (tasks.length === 0) return nothing(ctx)
  const bubbles = tasks.map((t) => {
    const button: FlexButton =
      t.status === 'SENT'
        ? { label: 'รับงาน', postback: taskPostbackData(t.id, 'ACCEPT'), displayText: 'รับงาน', primary: true }
        : { label: 'เสร็จแล้ว', postback: taskPostbackData(t.id, 'DONE'), displayText: 'เสร็จแล้ว', primary: true }
    return cardBubble({
      altText: t.title,
      title: t.title,
      rows: [
        { label: 'สถานะ', value: t.status === 'SENT' ? 'ยังไม่รับงาน' : t.status === 'ISSUE' ? 'มีปัญหา' : 'รับงานแล้ว' },
        { label: 'บิล', value: t.bill_no ?? '' },
      ],
      // a driver's job goes step by step: its form has the steps
      buttons: t.driver && t.status !== 'SENT' && ctx.jobUrl(t.id) ? [{ label: 'เปิดฟอร์มงาน', uri: ctx.jobUrl(t.id) as string, primary: true }] : [button],
    })
  })
  return [carouselMessage('งานที่ยังไม่ปิด', bubbles)]
}

/** ถ่ายรูปส่งมอบสินค้า: the job form (where the photos go) of each open job; needs LIFF. */
export function photoMessages(r: MenuStaffJobs, ctx: MenuContext): LineMessage[] {
  if (r.result !== 'OK') return notAllowed(ctx)
  const jobs = (r.tasks ?? []).filter((t) => t.driver && t.status !== 'SENT')
  if (jobs.length === 0) return [{ type: 'text', text: 'ไม่มีงานส่งของที่รับไว้ กด "รับงาน" ในข้อความงานก่อน แล้วจึงถ่ายรูปส่งมอบ' }]
  if (!ctx.jobUrl(jobs[0].id)) return [{ type: 'text', text: 'ฟอร์มถ่ายรูปใน LINE ยังไม่ได้ตั้งค่า กรุณาแจ้งเจ้าของร้าน' }]
  const bubbles = jobs.map((t) =>
    cardBubble({ altText: t.title, title: t.title, rows: [{ label: 'บิล', value: t.bill_no ?? '' }], buttons: [{ label: 'ถ่ายรูปส่งมอบ', uri: ctx.jobUrl(t.id) as string, primary: true }] }),
  )
  return [carouselMessage('ถ่ายรูปส่งมอบสินค้า', bubbles)]
}

/** เช็กสต็อกสินค้าว่าง: categories first, then the products of one with available / out on bills / reserved. */
export function stockMessages(r: MenuStock, ctx: MenuContext): LineMessage[] {
  if (r.result !== 'OK') return r.result === 'NOT_ALLOWED' ? notAllowed(ctx) : nothing(ctx)
  if (!r.category) {
    const cats = r.categories ?? []
    if (cats.length === 0) return nothing(ctx)
    const buttons: FlexButton[] = cats.slice(0, 10).map((c, i) => ({ label: `${c.name} (${c.count})`, postback: menuData({ a: 'stock', c: c.id }), displayText: c.name, primary: i === 0 }))
    return [cardMessage({ altText: 'เช็กสต็อกสินค้าว่าง', title: 'เช็กสต็อกสินค้าว่าง', text: 'เลือกหมวดสินค้า', buttons, maxButtons: 10 })]
  }
  const items = r.items ?? []
  if (items.length === 0) return nothing(ctx)
  const rows: FlexRow[] = items.map((it) => ({
    label: it.name,
    value: `ว่าง ${qty(it.available)}${it.unit ? ` ${it.unit}` : ''} · ออกบิล ${qty(it.rented)}${it.reserved ? ` · จอง ${qty(it.reserved)}` : ''}`,
  }))
  const more = (r.total ?? items.length) > items.length ? `แสดง ${items.length} จาก ${r.total} รายการ` : undefined
  return [billDesignMessage({ altText: `สต็อก ${r.category.name}`, title: `สต็อก ${r.category.name}`, color: BRAND, rows, footer: more, buttons: [{ label: 'เลือกหมวดอื่น', postback: menuData({ a: 'stock' }), displayText: 'เช็กสต็อกสินค้าว่าง' }] })]
}
/** สรุปยอดรายรับวันนี้ (same words as #สรุปยอดวันนี้). */
export function ownerSummaryMessages(r: MenuOwner, ctx: MenuContext): LineMessage[] {
  if (r.result !== 'OK') return notAllowed(ctx)
  const by = (r.by_method ?? []).map((m) => `${METHOD_LABEL[m.method] ?? m.method} ${baht(m.amount)}`).join(' · ') || 'ยังไม่มีรายรับ'
  return [
    textMessage(
      'OWNER_SUMMARY',
      { วันที่: thDate(r.date) || '-', รายรับรวม: baht(r.income), รายรับแยกช่องทาง: by, บิลใหม่: String(r.new_bills ?? 0), ยอดค้างรวม: baht(r.owed) },
      ctx.templates,
    ),
  ]
}

/** สั่งงานด่วนพนักงาน: how to give a task from the chat, and the page in the app. */
export function ownerOrderMessages(ctx: MenuContext): LineMessage[] {
  const url = ctx.appUrl('/line?tab=settings&view=TASKS')
  const text = renderTemplate('OWNER_ORDER_HOWTO', {}, ctx.templates)
  return [billDesignMessage({ altText: text, title: 'สั่งงานด่วนพนักงาน', color: BRAND, text, rows: [], buttons: url ? [{ label: 'เปิดหน้าสั่งงาน', uri: url, primary: true }] : [] })]
}

/** ตรวจสลิปโอนเงิน / อนุมัติลูกค้าใหม่: what is waiting, and the page in the app where it is decided. */
export function ownerQueueMessages(what: 'SLIPS' | 'REGISTER', r: MenuOwner, ctx: MenuContext): LineMessage[] {
  if (r.result !== 'OK') return notAllowed(ctx)
  const rowsIn = r.rows ?? []
  if (!r.count) return nothing(ctx)
  const rows: FlexRow[] =
    what === 'SLIPS'
      ? rowsIn.map((s) => ({
          label: `บิล ${String(s.bill_no ?? '-')}`,
          value: `${String(s.customer_name ?? '-')} · ${baht(Number(s.amount))} บาท${s.check_status ? ` · ${CHECK_LABEL[String(s.check_status)] ?? ''}` : ''}`,
        }))
      : rowsIn.map((p) => ({ label: String(p.name ?? '-'), value: `${String(p.phone ?? '-')} · ${thDate(String(p.at ?? ''))}` }))
  const title = what === 'SLIPS' ? `สลิปรอตรวจ ${r.count} รายการ` : `ลูกค้าใหม่รออนุมัติ ${r.count} คน`
  const url = ctx.appUrl(`/line?tab=settings&view=${what === 'SLIPS' ? 'SLIPS' : 'PENDING'}`)
  const more = r.count > rowsIn.length ? `แสดง ${rowsIn.length} จาก ${r.count} รายการ` : undefined
  return [billDesignMessage({ altText: title, title, color: what === 'SLIPS' ? '#F59E0B' : '#2563EB', rows, footer: more, buttons: url ? [{ label: 'เปิดในแอปเพื่ออนุมัติ', uri: url, primary: true }] : [] })]
}
