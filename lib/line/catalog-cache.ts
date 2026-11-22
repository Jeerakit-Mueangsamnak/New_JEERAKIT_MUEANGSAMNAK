import 'server-only'
import type { CatalogCategory, CatalogPage } from './catalog'

// Server memory only. Values come only from the allowlisted public catalog RPCs, never from customers or shop settings.
// The database changes the revision on every product/category/unit/published-price change; the webhook guard returns it
// in the same round trip that records the event. A new revision cannot reuse an older entry, on any server instance.
type PublicCatalog = CatalogCategory[] | CatalogPage | { id: string; name: string } | null
const entries = new Map<string, { expires: number; value: Promise<PublicCatalog> }>()
const TTL_MS = 60_000
const MAX_ENTRIES = 128

export async function cachedPublicCatalog<T extends PublicCatalog>(revision: string, key: string, load: () => Promise<T>): Promise<T> {
  const cacheKey = `${revision}:${key}`
  const now = Date.now()
  const found = entries.get(cacheKey)
  if (found && found.expires > now) return found.value as Promise<T>
  for (const [k, row] of entries) if (row.expires <= now) entries.delete(k)
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string)
  const value = load().catch((error) => {
    if (entries.get(cacheKey)?.value === value) entries.delete(cacheKey)
    throw error
  })
  entries.set(cacheKey, { expires: now + TTL_MS, value })
  return value
}