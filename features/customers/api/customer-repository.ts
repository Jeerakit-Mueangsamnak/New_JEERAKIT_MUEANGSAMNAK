import { createClient } from '@/lib/supabase/client'
import { rpc, selectRows, isDbError } from '@/lib/db/rpc'
import type { Customer } from '@/lib/types/rental-pos'
import { uploadCustomerImage, fetchCustomerDocuments, getDocumentFileUrl } from '@/features/documents/api/customer-document-repository'

/**
 * Customers (Master v4.3.1 §5) on the v4.3 schema. Reads: RLS SELECT on public.customers.
 * Writes: customer_create / customer_update / customer_set_active RPCs (never hard delete).
 * Structured contact parts the app collects (house no, sub-district, LINE, ID card no. …) are
 * kept in customers.contact_details; `address` holds the full printable address.
 */

interface CustomerRow {
  id: string
  customer_code: string | null
  name: string
  phone: string
  address: string
  customer_type: string | null
  tax_id: string | null
  email: string | null
  contact_person: string | null
  note: string | null
  active: boolean
  account_status: string
  contact_details: Record<string, string | undefined> | null
  created_at: string
}

const DETAIL_KEYS = [
  'companyName', 'phone2', 'lineId', 'houseNo', 'moo', 'soi', 'road', 'subDistrict', 'district', 'province',
  'postalCode', 'idCardNumber', 'idCardExpiry',
] as const

export function mapCustomerRow(c: CustomerRow): Customer {
  const d = c.contact_details || {}
  return {
    id: c.id,
    customerCode: c.customer_code || undefined,
    customerName: c.name,
    customerType: c.customer_type === 'COMPANY' ? 'CORPORATE' : 'INDIVIDUAL',
    taxId: c.tax_id || undefined,
    phone: c.phone,
    email: c.email || undefined,
    address: c.address,
    note: c.note || undefined,
    status: c.active ? 'ACTIVE' : 'INACTIVE',
    isSuspended: !c.active,
    createdAt: c.created_at,
    companyName: d.companyName,
    phone2: d.phone2,
    lineId: d.lineId,
    houseNo: d.houseNo,
    moo: d.moo,
    soi: d.soi,
    road: d.road,
    subDistrict: d.subDistrict,
    district: d.district,
    province: d.province,
    postalCode: d.postalCode,
    idCardNumber: d.idCardNumber,
    idCardImageUrl: d.idCardImageUrl,
    idCardExpiry: d.idCardExpiry,
  }
}

/** Full printable address: typed address, else built from the structured parts. */
export function composeAddress(c: Customer): string {
  if (c.address && c.address.trim()) return c.address.trim()
  const parts = [
    c.houseNo,
    c.moo && `หมู่ ${c.moo}`,
    c.soi && `ซ.${c.soi}`,
    c.road && `ถ.${c.road}`,
    c.subDistrict && `ต.${c.subDistrict}`,
    c.district && `อ.${c.district}`,
    c.province && `จ.${c.province}`,
    c.postalCode,
  ].filter(Boolean)
  return parts.join(' ')
}

function customerPayload(c: Customer): Record<string, unknown> {
  const details: Record<string, string> = {}
  for (const k of DETAIL_KEYS) {
    const v = c[k]
    if (typeof v === 'string' && v.trim()) details[k] = v.trim()
  }
  return {
    customer_code: c.customerCode || null,
    name: (c.customerName || '').trim(),
    phone: (c.phone || '').trim(),
    address: composeAddress(c),
    customer_type: c.customerType === 'CORPORATE' ? 'COMPANY' : 'INDIVIDUAL',
    tax_id: c.taxId || null,
    email: c.email || null,
    note: c.note || null,
    contact_details: details,
  }
}

export async function fetchCustomersFromSupabase(): Promise<Customer[]> {
  const supabase = createClient()
  const rows = await selectRows<CustomerRow>(supabase.from('customers').select('*').order('created_at', { ascending: false }))
  return rows.map(mapCustomerRow)
}

/**
 * Creates (no id / unknown id) or updates a customer; returns the saved row.
 * A possible duplicate (same phone or name, Master §5) asks the user before saving anyway.
 */
/** `confirmDuplicate` asks the user when the server reports a possible duplicate; without it the save stops. */
export async function saveCustomerToSupabase(
  customer: Customer,
  isNew: boolean,
  reason?: string,
  confirmDuplicate?: () => Promise<boolean>
): Promise<Customer> {
  const payload = customerPayload(customer)
  let saved: Customer
  if (isNew) {
    try {
      saved = mapCustomerRow(await rpc<CustomerRow>('customer_create', { p_data: payload }))
    } catch (err) {
      if (!isDbError(err, 'DUPLICATE_CUSTOMER')) throw err
      const ok = confirmDuplicate ? await confirmDuplicate() : false
      if (!ok) throw err
      saved = mapCustomerRow(await rpc<CustomerRow>('customer_create', { p_data: payload, p_confirm_duplicate: true }))
    }
  } else {
    saved = mapCustomerRow(
      await rpc<CustomerRow>('customer_update', { p_customer_id: customer.id, p_data: payload, p_reason: reason?.trim() || 'แก้ไขข้อมูลลูกค้า' })
    )
  }
  // A newly scanned ID card photo (data URL) goes to private Storage as an ID_CARD document;
  // the customer row never holds the image itself (Master §6).
  if (customer.idCardImageUrl?.startsWith('data:')) {
    try {
      const blob = await (await fetch(customer.idCardImageUrl)).blob()
      await uploadCustomerImage(saved.id, blob, 'ID_CARD', 'สแกนบัตรประชาชน')
    } catch (err) {
      // The customer row is already saved: report the photo on its own so the form is not
      // submitted again (which would create a duplicate customer).
      throw Object.assign(new Error('บันทึกข้อมูลลูกค้าแล้ว แต่อัปโหลดรูปบัตรประชาชนไม่สำเร็จ กรุณาแก้ไขลูกค้าแล้วแนบรูปอีกครั้ง'), {
        tag: 'ID_CARD_UPLOAD_FAILED',
        saved,
        cause: err,
      })
    }
  }
  return saved
}

/** Signed link to the customer's latest ID card image, or null. */
export async function getLatestIdCardUrl(customerId: string): Promise<string | null> {
  const docs = await fetchCustomerDocuments(customerId)
  const latest = docs.find((d) => d.doc_type === 'ID_CARD' && d.status === 'ACTIVE' && d.storage_path)
  return latest?.storage_path ? getDocumentFileUrl(latest.storage_path) : null
}

/** Customers are never hard-deleted (history): deactivate / reactivate. */
export async function setCustomerActive(id: string, active: boolean, reason: string): Promise<void> {
  await rpc('customer_set_active', { p_customer_id: id, p_active: active, p_reason: reason })
}
