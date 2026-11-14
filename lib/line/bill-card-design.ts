/**
 * การ์ดบิล LINE (owner 2026-11-12): the shop designs bill cards in Settings › LINE และการแจ้งเตือน
 * and picks one when sending a bill on LINE. Stored in store_settings.policies.line_bill_cards.
 * The card shows only the stored bill's own numbers; nothing is recalculated.
 * No button: the database refuses links/actions in a bill sent from a screen.
 */
import type { FlexRow } from './flex'

export const LINE_CARD_COLORS = {
  green: { label: 'เขียว', hex: '#06C755' },
  blue: { label: 'น้ำเงิน', hex: '#2563EB' },
  orange: { label: 'ส้ม', hex: '#EA580C' },
  red: { label: 'แดง', hex: '#DC2626' },
  slate: { label: 'เทา', hex: '#475569' },
} as const
export type LineCardColor = keyof typeof LINE_CARD_COLORS
export const isLineCardColor = (v: unknown): v is LineCardColor => typeof v === 'string' && v in LINE_CARD_COLORS

export type LineCardType = 'CLOSED' | 'CANCELLED' | 'OUTSTANDING'
/** Each type starts with its own heading, label and colour. */
export const LINE_CARD_TYPES: ReadonlyArray<{ id: LineCardType; label: string; title: string; badge: string; color: LineCardColor }> = [
  { id: 'CLOSED', label: 'บิลเสร็จ / ปิดยอด', title: 'บิลเสร็จเรียบร้อย', badge: 'ชำระครบแล้ว', color: 'green' },
  { id: 'CANCELLED', label: 'ยกเลิกบิล', title: 'ยกเลิกบิล', badge: 'ยกเลิกแล้ว', color: 'red' },
  { id: 'OUTSTANDING', label: 'ยอดค้างชำระ', title: 'แจ้งยอดค้างชำระ', badge: 'ค้างชำระ', color: 'orange' },
]

export type LineCardField = 'billNo' | 'customer' | 'total' | 'outstanding' | 'due' | 'note'
export const LINE_CARD_FIELDS: ReadonlyArray<{ id: LineCardField; label: string }> = [
  { id: 'billNo', label: 'เลขที่บิล' },
  { id: 'customer', label: 'ชื่อลูกค้า' },
  { id: 'total', label: 'ยอดรวม' },
  { id: 'outstanding', label: 'ยอดค้างชำระ' },
  { id: 'due', label: 'กำหนดคืน / ชำระ' },
  { id: 'note', label: 'หมายเหตุ' },
]

export interface LineBillCardDesign {
  id: string
  name: string
  type: LineCardType
  title: string
  badge: string
  color: LineCardColor
  fields: LineCardField[]
  /** {ร้าน} = the shop name */
  footer: string
}

export const LINE_CARD_LIMITS = { cards: 20, name: 40, title: 60, badge: 20, footer: 300 } as const
export const SHOP_NAME_TOKEN = '{ร้าน}'

export function newLineCardDesign(type: LineCardType = 'CLOSED'): LineBillCardDesign {
  const t = LINE_CARD_TYPES.find((x) => x.id === type) ?? LINE_CARD_TYPES[0]
  return {
    id: '',
    name: '',
    type: t.id,
    title: t.title,
    badge: t.badge,
    color: t.color,
    fields: ['billNo', 'customer', 'total', 'due'],
    footer: `ขอบคุณที่ใช้บริการร้าน ${SHOP_NAME_TOKEN}`,
  }
}

/** The bill numbers a card can show (as stored on the bill). */
export interface LineCardBill {
  billNo: string
  customerName: string
  grandTotal: number
  outstandingAmount: number
  returnDate?: string
  note?: string | null
}

const money = (n: number) => `${(Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`

export function lineCardRows(design: Pick<LineBillCardDesign, 'fields'>, bill: LineCardBill): FlexRow[] {
  const value: Record<LineCardField, string> = {
    billNo: bill.billNo,
    customer: bill.customerName,
    total: money(bill.grandTotal),
    outstanding: money(bill.outstandingAmount),
    due: bill.returnDate || '',
    note: (bill.note || '').trim(),
  }
  return LINE_CARD_FIELDS.filter((f) => design.fields.includes(f.id))
    .map((f) => ({ label: f.label, value: value[f.id] }))
    .filter((r) => r.value !== '')
}

export const lineCardFooter = (design: Pick<LineBillCardDesign, 'footer'>, shopName: string) =>
  design.footer.split(SHOP_NAME_TOKEN).join(shopName.trim() || 'ร้าน').trim()

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Saved cards from store_settings.policies (anything malformed is dropped). */
export function parseLineCardDesigns(v: unknown): LineBillCardDesign[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object' && typeof (d as { id?: unknown }).id === 'string')
    .slice(0, LINE_CARD_LIMITS.cards)
    .map((d) => ({
      id: String(d.id),
      name: str(d.name, LINE_CARD_LIMITS.name),
      type: LINE_CARD_TYPES.some((t) => t.id === d.type) ? (d.type as LineCardType) : 'CLOSED',
      title: str(d.title, LINE_CARD_LIMITS.title),
      badge: str(d.badge, LINE_CARD_LIMITS.badge),
      color: isLineCardColor(d.color) ? d.color : 'green',
      fields: Array.isArray(d.fields) ? LINE_CARD_FIELDS.map((f) => f.id).filter((id) => (d.fields as unknown[]).includes(id)) : [],
      footer: str(d.footer, LINE_CARD_LIMITS.footer),
    }))
}

export function validateLineCardDesign(d: LineBillCardDesign): string | null {
  if (!d.name.trim()) return 'กรุณาตั้งชื่อการ์ด'
  if (d.name.trim().length > LINE_CARD_LIMITS.name) return `ชื่อการ์ดยาวได้ไม่เกิน ${LINE_CARD_LIMITS.name} ตัวอักษร`
  if (!d.title.trim()) return 'กรุณาระบุหัวการ์ด'
  if (d.title.trim().length > LINE_CARD_LIMITS.title) return `หัวการ์ดยาวได้ไม่เกิน ${LINE_CARD_LIMITS.title} ตัวอักษร`
  if (d.badge.trim().length > LINE_CARD_LIMITS.badge) return `ป้ายสถานะยาวได้ไม่เกิน ${LINE_CARD_LIMITS.badge} ตัวอักษร`
  if (d.footer.trim().length > LINE_CARD_LIMITS.footer) return `ข้อความท้ายการ์ดยาวได้ไม่เกิน ${LINE_CARD_LIMITS.footer} ตัวอักษร`
  if (d.fields.length === 0) return 'เลือกข้อมูลที่แสดงบนการ์ดอย่างน้อย 1 อย่าง'
  if (!isLineCardColor(d.color)) return 'สีหัวการ์ดไม่ถูกต้อง'
  return null
}
