/**
 * Customer cache for the UI (Master v4.3.1 §5). Supabase is the source of truth; every write
 * goes through the customer RPCs and the cache is refreshed from the database afterwards.
 */
import { Customer } from '@/lib/types/rental-pos'
import {
  fetchCustomersFromSupabase,
  saveCustomerToSupabase,
  setCustomerActive,
} from '@/features/customers/api/customer-repository'

let _cachedCustomers: Customer[] | null = null

export function setCachedCustomers(customers: Customer[]) {
  _cachedCustomers = customers
}

export function loadCustomers(): Customer[] {
  if (typeof window === 'undefined') return _cachedCustomers || []
  return _cachedCustomers || []
}

/** Cache-only replace (tests / optimistic UI). */
export function saveCustomers(customers: Customer[]): void {
  _cachedCustomers = customers
}

export async function syncCustomersFromSupabase(): Promise<Customer[]> {
  _cachedCustomers = await fetchCustomersFromSupabase()
  return _cachedCustomers
}

/** Creates the customer (server assigns the id) and returns the fresh list. */
export async function addCustomerAsync(incoming: Customer): Promise<Customer[]> {
  const known = loadCustomers().some((c) => c.id === incoming.id)
  await saveCustomerToSupabase(incoming, !known)
  return syncCustomersFromSupabase()
}

/** Creates the customer and returns the saved record (with the server id). */
export async function createCustomerAsync(incoming: Customer): Promise<Customer> {
  const saved = await saveCustomerToSupabase(incoming, true)
  await syncCustomersFromSupabase()
  return saved
}

export async function updateCustomerAsync(updated: Customer): Promise<Customer[]> {
  const before = loadCustomers().find((c) => c.id === updated.id)
  await saveCustomerToSupabase(updated, false)
  const wasActive = before ? !before.isSuspended && before.status !== 'INACTIVE' : true
  const isActive = !updated.isSuspended && updated.status !== 'INACTIVE'
  if (before && wasActive !== isActive) {
    await setCustomerActive(updated.id, isActive, isActive ? 'เปิดใช้งานลูกค้า' : 'ระงับลูกค้า')
  }
  return syncCustomersFromSupabase()
}

/** Soft delete (history is kept): the customer is deactivated. */
export async function deleteCustomerAsync(id: string): Promise<Customer[]> {
  await setCustomerActive(id, false, 'ลบลูกค้าออกจากรายการ')
  return syncCustomersFromSupabase()
}
