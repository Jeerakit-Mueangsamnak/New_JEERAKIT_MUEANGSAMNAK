// The shop's forms are a few MB: prints and bill windows reuse the last read for 5 minutes (2026-11-12 smoothness).
import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  fetchDocumentTemplates: vi.fn(async () => [{ id: 't1', name: 'ใบส่งของ', category: 'บิล', templateSchema: '<p/>', targetGroup: 'BILL' }]),
  fetchDocumentNames: vi.fn(async () => []),
}))
vi.mock('@/features/documents/api/template-library-repository', () => ({
  ...api,
  addDocumentName: vi.fn(),
  createDocumentTemplate: vi.fn(),
  deleteDocumentName: vi.fn(),
  deleteDocumentTemplates: vi.fn(),
}))

describe('getSharedTemplates', () => {
  afterEach(() => vi.useRealTimers())

  it('calls made together share one read; later calls reuse it until 5 minutes pass', async () => {
    vi.useFakeTimers()
    const storage = await import('@/features/documents/services/template-library-storage')
    const [a, b] = await Promise.all([storage.getSharedTemplates(), storage.getSharedTemplates()])
    expect(a.map((t) => t.id)).toEqual(['t1'])
    expect(b).toEqual(a)
    expect(api.fetchDocumentTemplates).toHaveBeenCalledTimes(1)

    await storage.getSharedTemplates()
    expect(api.fetchDocumentTemplates).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(storage.SHARED_TEMPLATES_MAX_AGE_MS)
    await storage.getSharedTemplates()
    expect(api.fetchDocumentTemplates).toHaveBeenCalledTimes(2)

    // The form library page still reads fresh every time
    await storage.refreshSharedTemplates()
    expect(api.fetchDocumentTemplates).toHaveBeenCalledTimes(3)
  })
})
