import type { Customer } from '@/lib/types/rental-pos'

/** Customer fields used in compact references across bills, appointments and documents. */
export interface CustomerDisplay {
  id: string
  name: string
  phone: string
  phone2?: string | null
  address: string
  taxId?: string | null
}

export function customerDisplayFromCustomer(customer: Customer): CustomerDisplay {
  return {
    id: customer.id,
    name: customer.customerName,
    phone: customer.phone || '',
    phone2: customer.phone2 || null,
    address: customer.address || '',
    taxId: customer.taxId || null,
  }
}

/** Both saved contact numbers, without blanks or accidental duplicates. */
export function customerDisplayPhones(customer?: { phone?: string | null; phone2?: string | null } | null): string {
  return [...new Set([customer?.phone, customer?.phone2].map((p) => (p || '').trim()).filter(Boolean))].join(', ')
}

/** Format the Thai 13-digit tax/ID number for display; keep storage values digits-only. */
export function formatCustomerTaxId(value?: string | null): string {
  const digits = (value || '').replace(/\D/g, '')
  if (digits.length !== 13) return value || ''
  return `${digits[0]}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits[12]}`
}