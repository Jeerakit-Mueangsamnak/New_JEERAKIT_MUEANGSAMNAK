import { createClient } from '@/lib/supabase/client'
import { Quotation, QuotationItem, QuotationStatus, RentalType } from '@/lib/types/rental-pos'

/**
 * Canonical Supabase persistence adapter for Quotation data.
 *
 * Stage 2 rule:
 * - Quotation is the canonical application contract.
 * - public.quotations.items (JSONB) is the canonical persisted item payload for runtime.
 * - public.quotation_items is retained only as a compatibility mirror/fallback until a later migration removes it.
 * - This repository is the only module that performs direct CRUD against quotation tables.
 * - Cache management and quotation workflow rules stay outside this repository.
 */

type DbQuotationRow = Record<string, unknown>
type DbQuotationItemRow = Record<string, unknown>

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asQuotationStatus(value: unknown): QuotationStatus {
  return (typeof value === 'string' ? value : 'DRAFT') as QuotationStatus
}

function asRentalType(value: unknown): RentalType {
  return (typeof value === 'string' ? value : 'NORMAL') as RentalType
}

function datePart(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.slice(0, 10)
}

export function dbQuotationItemToQuotationItem(row: DbQuotationItemRow): QuotationItem {
  return {
    id: asOptionalString(row.id),
    productId: asString(row.product_id),
    productName: asString(row.product_name),
    rentalType: asRentalType(row.rental_type),
    quantity: asNumber(row.quantity, 1),
    unitName: asOptionalString(row.unit_name),
    unitPrice: asNumber(row.unit_price),
    usageCountOrDays: asNumber(row.usage_count_or_days, 1),
    dailyStartDate: asOptionalString(row.daily_start_date),
    dailyEndDate: asOptionalString(row.daily_end_date),
    lineTotal: asNumber(row.line_total),
  }
}

function embeddedItems(row: DbQuotationRow): QuotationItem[] {
  return Array.isArray(row.items) ? (row.items as QuotationItem[]) : []
}

export function dbQuotationToQuotation(
  row: DbQuotationRow,
  legacyItems: QuotationItem[] = []
): Quotation {
  const canonicalItems = embeddedItems(row)
  const items = canonicalItems.length > 0 ? canonicalItems : legacyItems
  const createdDate = datePart(row.created_at) || new Date().toISOString().slice(0, 10)
  const subtotalFromItems = items.reduce((sum, item) => sum + asNumber(item.lineTotal), 0)

  return {
    id: asString(row.id),
    quotationNo: asString(row.quotation_no),
    quotationDate: asString(row.quotation_date, createdDate),
    expiryDate: asString(row.expiry_date, asString(row.rental_start_date, createdDate)),
    customerId: asString(row.customer_id),
    customerName: asString(row.customer_name),
    phone: asOptionalString(row.customer_phone),
    customerAddress: asOptionalString(row.customer_address),
    customerTaxId: asOptionalString(row.customer_tax_id),
    siteName: asOptionalString(row.site_name),
    rentalStartDate: asString(row.rental_start_date),
    rentalEndDate: asString(row.rental_end_date),
    items,
    subtotal: row.subtotal !== undefined && row.subtotal !== null
      ? asNumber(row.subtotal)
      : subtotalFromItems,
    discountAmount: asNumber(row.discount_amount),
    shippingFee: asNumber(row.shipping_fee),
    depositAmount: asNumber(row.deposit_amount),
    taxAmount: asNumber(row.tax_amount),
    grandTotal: asNumber(row.grand_total),
    status: asQuotationStatus(row.status),
    remark: asOptionalString(row.remark),
    cancelReason: asOptionalString(row.cancel_reason),
    cancelledAt: asOptionalString(row.cancelled_at),
    acceptedAt: asOptionalString(row.accepted_at),
    reservationId: asOptionalString(row.reservation_id),
    convertedBillId: asOptionalString(row.converted_bill_id),
    createdAt: asOptionalString(row.created_at),
  }
}

export function quotationToDbQuotation(quotation: Quotation): Record<string, unknown> {
  return {
    id: quotation.id,
    quotation_no: quotation.quotationNo,
    customer_id: quotation.customerId || null,
    customer_name: quotation.customerName,
    customer_phone: quotation.phone || null,
    customer_address: quotation.customerAddress || null,
    customer_tax_id: quotation.customerTaxId || null,
    site_name: quotation.siteName || null,
    rental_start_date: quotation.rentalStartDate || null,
    rental_end_date: quotation.rentalEndDate || null,
    discount_amount: quotation.discountAmount || 0,
    shipping_fee: quotation.shippingFee || 0,
    tax_amount: quotation.taxAmount || 0,
    deposit_amount: quotation.depositAmount || 0,
    grand_total: quotation.grandTotal || 0,
    status: quotation.status,
    remark: quotation.remark || null,
    cancel_reason: quotation.cancelReason || null,
    converted_bill_id: quotation.convertedBillId || null,
    items: quotation.items || [],
    updated_at: new Date().toISOString(),
    accepted_at: quotation.acceptedAt || null,
    cancelled_at: quotation.cancelledAt || null,
  }
}

function quotationItemToLegacyDbRow(
  quotationId: string,
  item: QuotationItem
): Record<string, unknown> {
  return {
    quotation_id: quotationId,
    product_id: item.productId,
    product_name: item.productName,
    product_code: item.productId,
    unit_name: item.unitName || 'ชิ้น',
    rental_type: item.rentalType,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    usage_count_or_days: item.usageCountOrDays || 1,
    daily_start_date: item.dailyStartDate || null,
    daily_end_date: item.dailyEndDate || null,
    line_total: item.lineTotal,
  }
}

async function fetchLegacyItemsForQuotationIds(ids: string[]): Promise<Map<string, QuotationItem[]>> {
  const grouped = new Map<string, QuotationItem[]>()
  if (ids.length === 0) return grouped

  const supabase = createClient()
  const { data, error } = await supabase
    .from('quotation_items')
    .select('*')
    .in('quotation_id', ids)

  if (error) {
    throw new Error(`ไม่สามารถดึงข้อมูลรายการใบเสนอราคาจาก Supabase ได้: ${error.message}`)
  }

  for (const raw of data || []) {
    const row = raw as DbQuotationItemRow
    const quotationId = asString(row.quotation_id)
    if (!quotationId) continue
    const list = grouped.get(quotationId) || []
    list.push(dbQuotationItemToQuotationItem(row))
    grouped.set(quotationId, list)
  }

  return grouped
}

export async function fetchQuotationsFromSupabase(): Promise<Quotation[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('quotations')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`ไม่สามารถดึงข้อมูลใบเสนอราคาจาก Supabase ได้: ${error.message}`)
  }

  const rows = (data || []) as DbQuotationRow[]
  const legacyIds = rows
    .filter((row) => embeddedItems(row).length === 0)
    .map((row) => asString(row.id))
    .filter(Boolean)
  const legacyByQuotationId = await fetchLegacyItemsForQuotationIds(legacyIds)

  return rows.map((row) =>
    dbQuotationToQuotation(row, legacyByQuotationId.get(asString(row.id)) || [])
  )
}

export async function fetchQuotationByIdFromSupabase(id: string): Promise<Quotation | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('quotations')
    .select('*')
    .or(`id.eq.${id},quotation_no.eq.${id}`)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`ไม่สามารถดึงข้อมูลใบเสนอราคา ${id} ได้: ${error.message}`)
  }

  if (!data) return null

  const row = data as DbQuotationRow
  let legacyItems: QuotationItem[] = []
  if (embeddedItems(row).length === 0) {
    const legacyByQuotationId = await fetchLegacyItemsForQuotationIds([asString(row.id)])
    legacyItems = legacyByQuotationId.get(asString(row.id)) || []
  }

  return dbQuotationToQuotation(row, legacyItems)
}

export async function saveQuotationToSupabase(quotation: Quotation): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('quotations')
    .upsert(quotationToDbQuotation(quotation))

  if (error) {
    throw new Error(`ไม่สามารถบันทึกใบเสนอราคา ${quotation.quotationNo} ลง Supabase ได้: ${error.message}`)
  }

  // Compatibility mirror only. public.quotations.items is the canonical item payload.
  const { error: deleteItemsError } = await supabase
    .from('quotation_items')
    .delete()
    .eq('quotation_id', quotation.id)

  if (deleteItemsError) {
    console.warn('[Supabase] Failed to refresh quotation_items compatibility mirror:', deleteItemsError.message)
    return
  }

  if (quotation.items.length > 0) {
    const { error: itemsError } = await supabase
      .from('quotation_items')
      .insert(quotation.items.map((item) => quotationItemToLegacyDbRow(quotation.id, item)))

    if (itemsError) {
      console.warn('[Supabase] Failed to sync quotation_items compatibility mirror:', itemsError.message)
    }
  }
}

export async function deleteQuotationFromSupabase(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('quotations')
    .delete()
    .or(`id.eq.${id},quotation_no.eq.${id}`)

  if (error) {
    throw new Error(`ไม่สามารถลบใบเสนอราคาจาก Supabase ได้: ${error.message}`)
  }
}
