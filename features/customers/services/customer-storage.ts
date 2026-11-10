/**
 * Customer cache for the UI (Master v4.3.1 §5). Supabase is the source of truth; every write
 * goes through the customer RPCs and the cache is refreshed from the database afterwards.
 */
import { Customer } from '@/lib/types/rental-pos'
import {
  fetchCustomersFromSupabase,
  saveCustomerToSupabase,
  setCustomerActive,
  deleteCustomerFromSupabase,
} from '@/features/customers/api/customer-repository'

let _cachedCustomers: Customer[] | null = null

export function setCachedCustomers(customers: Customer[]) {
  _cachedCustomers = customers
}

export function loadCustomers(): Customer[] {
  if (typeof window === 'undefined') return _cachedCustomers || []
  return _cachedCustomers || []
}
export async function syncCustomersFromSupabase(): Promise<Customer[]> {
  _cachedCustomers = await fetchCustomersFromSupabase()
  return _cachedCustomers
}
/** The row was saved but the ID card photo upload failed (see saveCustomerToSupabase). */
export function isIdCardUploadError(err: unknown): err is Error & { saved: Customer } {
  return (err as { tag?: string } | null)?.tag === 'ID_CARD_UPLOAD_FAILED'
}

/** Creates the customer and returns the saved record (with the server id). */
export async function createCustomerAsync(
  incoming: Customer,
  confirmDuplicate?: () => Promise<boolean>
): Promise<Customer> {
  try {
    const saved = await saveCustomerToSupabase(incoming, true, undefined, confirmDuplicate)
    await syncCustomersFromSupabase()
    return saved
  } catch (err) {
    if (isIdCardUploadError(err)) await syncCustomersFromSupabase()
    throw err
  }
}

/** `reason` is the user's reason, kept in the audit log of the update / (de)activation. */
export async function updateCustomerAsync(updated: Customer, reason?: string): Promise<Customer[]> {
  const before = loadCustomers().find((c) => c.id === updated.id)
  try {
    await saveCustomerToSupabase(updated, false, reason)
  } catch (err) {
    if (isIdCardUploadError(err)) await syncCustomersFromSupabase()
    throw err
  }
  const wasActive = before ? !before.isSuspended && before.status !== 'INACTIVE' : true
  const isActive = !updated.isSuspended && updated.status !== 'INACTIVE'
  if (before && wasActive !== isActive) {
    await setCustomerActive(updated.id, isActive, reason?.trim() || (isActive ? 'เปิดใช้งานลูกค้า' : 'ระงับลูกค้า'))
  }
  return syncCustomersFromSupabase()
}

/** ลบถาวร a customer never used (the server refuses a used one with CUSTOMER_IN_USE). */
export async function deleteCustomerAsync(id: string): Promise<Customer[]> {
  await deleteCustomerFromSupabase(id)
  return syncCustomersFromSupabase()
}
