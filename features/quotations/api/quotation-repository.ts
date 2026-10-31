import { createClient } from '@/lib/supabase/client'
import { rpc, selectRows } from '@/lib/db/rpc'
import { withPinIfRequired } from '@/lib/db/pin-confirm'
import type { Quotation, QuotationItem, QuotationStatus } from '@/lib/types/rental-pos'

/**
 * Quotations (Master v4.3.1 §10) on the v4.3 schema. A quotation is an offer — it does not
 * move stock or money and has no expiry. DRAFT → SENT (number assigned) → ACCEPTED / REJECTED, and
 * CONVERTED when a bill made from it is confirmed (bill_confirm does that on the server).
 */

interface QuotationRow {
  id: string
  quotation_no: string | null
  customer_id: string | null
  status: string
  document_date: string | null
  subtotal: number
  discount_total: number
  vat_amount: number
  grand_total: number
  pricing_snapshot: { vat_enabled?: boolean; vat_rate?: number | null } | null
  converted_bill_id: string | null
  note: string | null
  site_name: string | null
  delivery_fee: number
  deposit_amount: number
  created_at: string
  updated_at: string
}

interface QuotationItemRow {
  id: string
  quotation_id: string
  line_no: number
  product_id: string
  line_mode: 'SALE' | 'RENTAL'
  quantity: number
  unit_price: number
  rental_calculation_type: string | null
  period_count: number | null
  rental_start_at: string | null
  rental_end_at: string | null
  discount_amount: number
  line_total: number
}

/** Local calendar day (yyyy-mm-dd) of a timestamp — a slice of the UTC text would show the day before for Thai midnight. */
const day = (ts: string | null | undefined) => {
  if (!ts) return ''
  const d = new Date(ts)
  if (!Number.isFinite(d.getTime())) return ts.slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function fetchQuotationsFromSupabase(): Promise<Quotation[]> {
  const supabase = createClient()
  const [quotes, items, customers, products, units] = await Promise.all([
    selectRows<QuotationRow>(supabase.from('quotations').select('*').order('created_at', { ascending: false })),
    selectRows<QuotationItemRow>(supabase.from('quotation_items').select('*')),
    selectRows<{ id: string; name: string; phone: string; address: string; tax_id: string | null }>(
      supabase.from('customers').select('id, name, phone, address, tax_id')
    ),
    selectRows<{ id: string; name: string; unit_id: string; is_accessory: boolean; is_rent_chargeable: boolean; requires_return: boolean }>(
      supabase.from('products').select('id, name, unit_id, is_accessory, is_rent_chargeable, requires_return')
    ),
    selectRows<{ id: string; name: string }>(supabase.from('units').select('id, name')),
  ])
  const customerMap = new Map(customers.map((c) => [c.id, c]))
  const productMap = new Map(products.map((p) => [p.id, p]))
  const unitMap = new Map(units.map((u) => [u.id, u.name]))
  const itemsByQuote = new Map<string, QuotationItemRow[]>()
  for (const it of items) {
    const list = itemsByQuote.get(it.quotation_id) || []
    list.push(it)
    itemsByQuote.set(it.quotation_id, list)
  }

  return quotes.map((q) => {
    const c = q.customer_id ? customerMap.get(q.customer_id) : undefined
    const rows = (itemsByQuote.get(q.id) || []).sort((a, b) => a.line_no - b.line_no)
    const starts = rows.map((r) => r.rental_start_at).filter(Boolean) as string[]
    const ends = rows.map((r) => r.rental_end_at).filter(Boolean) as string[]
    const qItems: QuotationItem[] = rows.map((r) => {
      const p = productMap.get(r.product_id)
      return {
        id: r.id,
        productId: r.product_id,
        productName: p?.name || '',
        rentalType: r.line_mode === 'SALE' ? 'SALE' : r.rental_calculation_type === 'PER_DAY' ? 'DAILY' : 'NORMAL',
        quantity: Number(r.quantity),
        unitName: p ? unitMap.get(p.unit_id) : undefined,
        unitPrice: Number(r.unit_price),
        usageCountOrDays: Number(r.period_count ?? 1),
        lineTotal: Number(r.line_total),
        dailyStartDate: r.rental_calculation_type === 'PER_DAY' ? day(r.rental_start_at) : undefined,
        dailyEndDate: r.rental_calculation_type === 'PER_DAY' ? day(r.rental_end_at) : undefined,
        isAccessory: p?.is_accessory,
        isChargeable: p?.is_rent_chargeable,
        requiresReturn: r.line_mode === 'RENTAL' && (p?.requires_return ?? true),
      }
    })
    return {
      id: q.id,
      quotationNo: q.quotation_no || `ร่าง-${q.id.slice(0, 8)}`,
      quotationDate: q.document_date || day(q.created_at),
      customerId: q.customer_id || '',
      customerName: c?.name || 'ลูกค้าทั่วไป',
      phone: c?.phone,
      customerAddress: c?.address,
      customerTaxId: c?.tax_id || undefined,
      siteName: q.site_name || undefined,
      rentalStartDate: starts.length ? day(starts.sort()[0]) : day(q.created_at),
      rentalEndDate: ends.length ? day(ends.sort()[ends.length - 1]) : day(q.created_at),
      items: qItems,
      subtotal: Number(q.subtotal) + Number(q.discount_total),
      discountAmount: Number(q.discount_total),
      shippingFee: Number(q.delivery_fee),
      depositAmount: Number(q.deposit_amount),
      taxAmount: Number(q.vat_amount),
      vatEnabled: Boolean(q.pricing_snapshot?.vat_enabled),
      vatRate: q.pricing_snapshot?.vat_enabled && q.pricing_snapshot.vat_rate != null ? Number(q.pricing_snapshot.vat_rate) : undefined,
      grandTotal: Number(q.grand_total),
      status: q.status as QuotationStatus,
      remark: q.note || undefined,
      convertedBillId: q.converted_bill_id || undefined,
      createdAt: q.created_at,
    }
  })
}

const startOfDay = (d?: string) => {
  const dt = d ? new Date(`${d.slice(0, 10)}T00:00:00`) : new Date()
  return dt.toISOString()
}
const endOfDay = (d?: string) => {
  const dt = d ? new Date(`${d.slice(0, 10)}T23:59:59`) : new Date()
  return dt.toISOString()
}

/**
 * Saves a quotation; returns its id. A new one is created, an existing DRAFT / SENT / ACCEPTED one
 * is revised in place (same number, back to waiting — the server refuses CONVERTED / REJECTED).
 * The bill-level discount is spread over the item lines (quotations price per line). A price
 * different from the list asks PIN + reason. VAT is chosen per quotation, like a bill.
 */
export async function saveQuotationDraft(q: Quotation, isExistingDraft: boolean): Promise<string> {
  const gross = q.items.map((it) => Number(it.unitPrice) * Number(it.quantity) * (it.rentalType === 'SALE' ? 1 : Math.max(1, Number(it.usageCountOrDays) || 1)))
  const totalGross = gross.reduce((s, g) => s + g, 0)
  let left = Math.min(Number(q.discountAmount) || 0, totalGross)
  const items = q.items.map((it, i) => {
    const share = i === q.items.length - 1 ? left : totalGross > 0 ? Math.round(((Number(q.discountAmount) || 0) * gross[i] / totalGross) * 100) / 100 : 0
    const disc = Math.min(share, left, gross[i])
    left = Math.round((left - disc) * 100) / 100
    const rental = it.rentalType !== 'SALE'
    const daily = it.rentalType === 'DAILY'
    return {
      product_id: it.productId,
      line_mode: rental ? 'RENTAL' : 'SALE',
      quantity: it.quantity,
      unit_price: it.unitPrice,
      rental_calculation_type: rental ? (daily ? 'PER_DAY' : 'PER_PERIOD') : null,
      period_count: rental ? Math.max(1, Number(it.usageCountOrDays) || 1) : null,
      rental_start_at: rental ? startOfDay(daily ? it.dailyStartDate || q.rentalStartDate : q.rentalStartDate) : null,
      rental_end_at: rental ? endOfDay(daily ? it.dailyEndDate || it.dailyStartDate || q.rentalEndDate : q.rentalEndDate || q.rentalStartDate) : null,
      discount_amount: disc,
    }
  })
  const data = {
    customer_id: q.customerId || null,
    document_date: q.quotationDate ? q.quotationDate.slice(0, 10) : null,
    vat_enabled: Boolean(q.vatEnabled),
    note: q.remark || null,
    site_name: q.siteName || null,
    delivery_fee: Number(q.shippingFee) || 0,
    deposit_amount: Number(q.depositAmount) || 0,
    items,
  }
  const saved = await withPinIfRequired(
    { action: 'PRICE_OVERRIDE', title: 'ยืนยันราคาในใบเสนอราคาที่ต่างจากราคาตั้ง', askReason: true },
    (token, reason) =>
      rpc<{ id: string }>('quotation_save_draft', {
        p_quotation_id: isExistingDraft ? q.id : null,
        p_data: reason ? { ...data, override_reason: reason } : data,
        p_pin_token: token,
      })
  )
  return saved.id
}

/** DRAFT → SENT: the quotation number is assigned. */
export async function sendQuotation(id: string): Promise<void> {
  await rpc('quotation_send', { p_quotation_id: id })
}

/** SENT → ACCEPTED; DRAFT / SENT / ACCEPTED → REJECTED (cancelled). Quotations do not expire. */
export async function setQuotationStatus(id: string, status: 'ACCEPTED' | 'REJECTED', reason?: string): Promise<void> {
  await rpc('quotation_set_status', { p_quotation_id: id, p_status: status, p_reason: reason ?? null })
}
