import { beforeAll, describe, expect, it, vi } from 'vitest'

// Quotation check 2026-10-18 + owner decisions of the same day: what the quotation screens save,
// show and print must match the server (per-quotation VAT, document date, no expiry, edit/copy).

const rpcMock = vi.hoisted(() => vi.fn())
const tables = vi.hoisted(() => ({} as Record<string, unknown[]>))
vi.mock('@/lib/db/rpc', async (orig) => {
  const real = await orig<typeof import('@/lib/db/rpc')>()
  return { ...real, rpc: rpcMock, selectRows: async (q: { table: string }) => tables[q.table] || [] }
})
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({ select: () => ({ table, order: () => ({ table }) }) }),
  }),
}))

import { dbErrorMessage } from '@/lib/db/rpc'
import { fetchQuotationsFromSupabase, saveQuotationDraft } from '@/features/quotations/api/quotation-repository'
import {
  addQuotation,
  mapQuotationToPos,
  quotationPeriodOf,
  quotationStatusView,
  setCachedQuotations,
  QUOTATION_WAITING_STATUSES,
} from '@/features/quotations/services/quotation-storage'
import { renderQuotationA4Html, thaiDocDate } from '@/features/documents/utils/transaction-print'
import { thaiBahtText, rentalTermLabel } from '@/features/documents/utils/documentRenderer'
import type { Product, Quotation } from '@/lib/types/rental-pos'

beforeAll(() => {
  process.env.TZ = 'Asia/Bangkok'
})

const quote = (over: Partial<Quotation> = {}): Quotation =>
  ({
    id: 'q1', quotationNo: 'QT-18102569-002', quotationDate: '2026-10-15', customerId: 'c1', customerName: 'ลูกค้า ก',
    phone: '081-000-0001', customerAddress: 'อุตรดิตถ์', siteName: 'ไซต์ B', rentalStartDate: '2026-10-18', rentalEndDate: '2026-10-18',
    items: [
      { id: 'i1', productId: 'p1', productName: 'แบบคาน 40x0.50', rentalType: 'NORMAL', quantity: 4, unitName: 'แผ่น', unitPrice: 10, usageCountOrDays: 3, lineTotal: 110 },
      { id: 'i2', productId: 'p2', productName: 'ตะปู', rentalType: 'SALE', quantity: 3, unitName: 'คู่', unitPrice: 12, usageCountOrDays: 1, lineTotal: 36 },
    ],
    subtotal: 156, discountAmount: 10, shippingFee: 40, depositAmount: 200, taxAmount: 0, vatEnabled: false,
    grandTotal: 186, status: 'SENT', ...over,
  }) as Quotation

describe('rounds / days saved from the POS cart', () => {
  it('a per-round line saves its rounds, not billableDays (which stays 1)', () => {
    expect(quotationPeriodOf({ rentalType: 'NORMAL', itemType: 'RENT', usageCount: 2, billableDays: 1 } as never)).toBe(2)
  })
  it('a daily line saves its billable days; a sale line is 1', () => {
    expect(quotationPeriodOf({ rentalType: 'DAILY', itemType: 'RENT', usageCount: 1, billableDays: 4 } as never)).toBe(4)
    expect(quotationPeriodOf({ rentalType: 'SALE', itemType: 'SALE', usageCount: 3, billableDays: 3 } as never)).toBe(1)
  })
})

describe('what is sent to quotation_save_draft', () => {
  it('rounds, discount spread, document date and the per-quotation VAT choice; no expiry', async () => {
    rpcMock.mockReset()
    rpcMock.mockResolvedValue({ id: 'q1' })
    await saveQuotationDraft(quote({ id: 'tmp', vatEnabled: true, discountAmount: 16, items: [
      { productId: 'p1', rentalType: 'NORMAL', quantity: 5, unitPrice: 10, usageCountOrDays: 2 },
      { productId: 'p2', rentalType: 'SALE', quantity: 3, unitPrice: 12, usageCountOrDays: 1 },
    ] as never }), false)
    const [fn, args] = rpcMock.mock.calls[0]
    expect(fn).toBe('quotation_save_draft')
    expect(args.p_quotation_id).toBeNull()
    expect(args.p_data).toMatchObject({ document_date: '2026-10-15', vat_enabled: true })
    expect(args.p_data).not.toHaveProperty('valid_until')
    expect(args.p_data.items[0].period_count).toBe(2)
    expect(args.p_data.items[0].discount_amount).toBe(11.76) // 16 × 100 / 136
    expect(args.p_data.items[1].discount_amount).toBe(4.24)
  })

  it('an editable quotation is revised in place (same id → same number); a copy creates a new one', async () => {
    rpcMock.mockReset()
    rpcMock.mockImplementation(async (fn: string) => (fn === 'quotation_save_draft' ? { id: 'q1' } : {}))
    tables.quotations = []
    tables.quotation_items = []
    setCachedQuotations([quote({ status: 'ACCEPTED' })])
    await addQuotation(quote({ status: 'ACCEPTED' }))
    expect(rpcMock.mock.calls[0][1].p_quotation_id).toBe('q1')
    expect(rpcMock.mock.calls[1][0]).toBe('quotation_send')

    rpcMock.mockClear()
    setCachedQuotations([quote({ status: 'ACCEPTED' })])
    await addQuotation(quote({ id: 'qt-copy' }))
    expect(rpcMock.mock.calls[0][1].p_quotation_id).toBeNull()
  })
})

describe('quotations read from the server', () => {
  it('document date, Thai-time rental days, VAT choice + rate from the pricing snapshot', async () => {
    tables.quotations = [{
      id: 'q1', quotation_no: 'QT-1', customer_id: null, status: 'SENT', document_date: '2026-10-15',
      subtotal: 120, discount_total: 16, vat_amount: 7.28, grand_total: 111.28, converted_bill_id: null, note: null,
      pricing_snapshot: { vat_enabled: true, vat_rate: 7, vat_mode: 'EXCLUSIVE' },
      site_name: null, delivery_fee: 0, deposit_amount: 300, created_at: '2026-10-17T18:30:00+00:00', updated_at: '',
    }]
    tables.quotation_items = [{
      id: 'i1', quotation_id: 'q1', line_no: 1, product_id: 'p1', line_mode: 'RENTAL', quantity: 5, unit_price: 10,
      rental_calculation_type: 'PER_PERIOD', period_count: 2, rental_start_at: '2026-10-17T17:00:00+00:00',
      rental_end_at: '2026-10-18T16:59:59+00:00', discount_amount: 16, line_total: 84,
    }]
    const [q] = await fetchQuotationsFromSupabase()
    expect(q.quotationDate).toBe('2026-10-15')
    expect(q.rentalStartDate).toBe('2026-10-18')
    expect(q.rentalEndDate).toBe('2026-10-18')
    expect(q.vatEnabled).toBe(true)
    expect(q.vatRate).toBe(7)
    expect(q.items[0].usageCountOrDays).toBe(2)
  })
})

describe('quotation → POS (bill or edit)', () => {
  const products = [
    { id: 'p1', name: 'แบบคาน', status: 'ACTIVE', rentalType: 'NORMAL', canRent: true, canSell: false, rentPrice: 10, isRentable: true },
    { id: 'p2', name: 'ตะปู', status: 'ACTIVE', rentalType: 'SALE', canRent: false, canSell: true, salePrice: 12, isSellable: true },
  ] as unknown as Product[]

  it('cart lines carry the amount before discount; the discount, VAT choice and document date come back once', () => {
    const { cartItems, values } = mapQuotationToPos(quote({ vatEnabled: true, taxAmount: 0 }), products, [])
    expect(cartItems.map((i) => i.lineTotal)).toEqual([120, 36])
    expect(values).toMatchObject({ discount: 10, vatEnabled: true, documentDate: '2026-10-15' })
  })
})

describe('quotation list status', () => {
  it('cancelled / converted are final: no accept, no edit, no cancel; old EXPIRED rows count as cancelled', () => {
    expect(quotationStatusView('REJECTED')).toMatchObject({ label: 'ยกเลิกแล้ว', actionable: false, editable: false, cancellable: false })
    expect(quotationStatusView('EXPIRED')).toMatchObject({ label: 'ยกเลิกแล้ว', editable: false })
    expect(quotationStatusView('CONVERTED')).toMatchObject({ actionable: false, editable: false, cancellable: false })
  })
  it('waiting and accepted quotations can be edited and cancelled; the wording is "ตอบรับ", not reserve', () => {
    expect(quotationStatusView('SENT')).toMatchObject({ label: 'รอยืนยัน', actionable: true, editable: true, cancellable: true })
    expect(quotationStatusView('ACCEPTED')).toMatchObject({ label: 'ตอบรับแล้ว', editable: true, cancellable: true })
    expect(QUOTATION_WAITING_STATUSES).toEqual(expect.arrayContaining(['DRAFT', 'SENT']))
  })
  it('server refusals for quotations are shown in Thai', () => {
    expect(dbErrorMessage('QUOTATION_STATUS_TRANSITION: REJECTED -> ACCEPTED')).toContain('สถานะใบเสนอราคานี้เปลี่ยนแบบนี้ไม่ได้')
    expect(dbErrorMessage('QUOTATION_NOT_EDITABLE')).toContain('แก้ไขไม่ได้')
    expect(dbErrorMessage('DOCUMENT_DATE_IN_FUTURE')).toBe('วันที่เอกสารต้องไม่อยู่ในอนาคต')
  })
})

describe('A4 quotation print', () => {
  it('fills the form: number, date, customer, rows before discount, totals, delivery fee, deposit, amount in words', () => {
    const html = renderQuotationA4Html(quote(), {})
    expect(html).toContain('QT-18102569-002')
    expect(html).toContain('15/10/2569')
    expect(html).toContain('ลูกค้า ก')
    expect(html).toContain('081-000-0001')
    expect(html).toContain('ไซต์ B')
    expect(html).toContain('แบบคาน 40x0.50')
    expect(html).toContain('3 รอบ')
    expect(html).toContain('120.00') // 4 × 10 × 3 before discount
    expect(html).toContain('ค่าขนส่ง (Delivery)')
    expect(html).toContain('มัดจำ (ไม่รวมยอด)')
    expect(html).toContain('186.00')
    expect(html).toContain('หนึ่งร้อยแปดสิบหกบาทถ้วน')
    expect(html).not.toMatch(/\{\{/)
  })
  it('VAT label follows the quotation: the saved rate, or "ไม่คิด" — never a fixed 7%', () => {
    expect(renderQuotationA4Html(quote({ vatEnabled: false }), {})).toContain('>ไม่คิด<')
    expect(renderQuotationA4Html(quote({ vatEnabled: true, vatRate: 10, taxAmount: 18.6 }), {})).toContain('>10%<')
  })
  it('the printed terms no longer promise a validity period', () => {
    expect(renderQuotationA4Html(quote(), {})).not.toContain('กำหนดยืนราคา')
  })
  it('helpers: Thai baht words, rental term, Buddhist-year date', () => {
    expect(thaiBahtText(0)).toBe('ศูนย์บาทถ้วน')
    expect(thaiBahtText(21)).toBe('ยี่สิบเอ็ดบาทถ้วน')
    expect(thaiBahtText(1250.5)).toBe('หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์')
    expect(thaiBahtText(2_011_000)).toBe('สองล้านหนึ่งหมื่นหนึ่งพันบาทถ้วน')
    expect(rentalTermLabel('DAILY', 2)).toBe('2 วัน')
    expect(rentalTermLabel('SALE', 5)).toBe('ขาย')
    expect(thaiDocDate('2026-10-18')).toBe('18/10/2569')
  })
})
