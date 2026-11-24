import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

describe('public LINE catalog cache', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules() })

  it('collapses concurrent and repeated reads, and a new revision fetches immediately', async () => {
    const { cachedPublicCatalog } = await import('@/lib/line/catalog-cache')
    const load = vi.fn(async () => [{ id: 'public-id', name: 'Public category', count: 43 }])
    const reads = await Promise.all(Array.from({ length: 12 }, () => cachedPublicCatalog('r1', 'categories', load)))
    expect(load).toHaveBeenCalledTimes(1)
    expect(reads.every((r) => r[0].name === 'Public category')).toBe(true)
    await cachedPublicCatalog('r2', 'categories', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('expires after 60 seconds and never caches a failed query', async () => {
    const { cachedPublicCatalog } = await import('@/lib/line/catalog-cache')
    const time = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const load = vi.fn(async () => [{ id: 'public-id', name: 'Public category', count: 1 }])
    await cachedPublicCatalog('ttl', 'categories', load)
    time.mockReturnValue(61001)
    await cachedPublicCatalog('ttl', 'categories', load)
    expect(load).toHaveBeenCalledTimes(2)
    const fail = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce(null)
    await expect(cachedPublicCatalog('fail', 'item:id', fail)).rejects.toThrow('database unavailable')
    expect(await cachedPublicCatalog('fail', 'item:id', fail)).toBeNull()
    expect(fail).toHaveBeenCalledTimes(2)
  })
})