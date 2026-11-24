// 2026-11-19 speed: the forms' page images (~6 MB) are kept on the device and downloaded only when new.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const listRow = (id: string, version = 1) => ({
    id,
    name: `ฟอร์ม ${id}`,
    category: 'บิล',
    target_group: 'BILL',
    source: 'UPLOAD',
    file_type: 'pdf',
    file_name: null,
    paper_size: 'A4',
    orientation: 'portrait',
    page_count: 1,
    version,
    is_default: false,
    description: null,
    default_terms: null,
    status: 'ACTIVE',
    status_reason: null,
    created_at: '2026-11-01T00:00:00Z',
    created_by: 'u1',
    updated_at: '2026-11-01T00:00:00Z',
    updated_by: null,
  })
  return {
    list: [] as ReturnType<typeof listRow>[],
    listRow,
    schemaReads: [] as string[][],
    selects: [] as string[],
    saved: new Map<string, unknown>(),
  }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: (columns: string) => {
        db.selects.push(columns)
        return {
          eq: () => ({ order: async () => ({ data: db.list, error: null }) }),
          in: async (_col: string, ids: string[]) => {
            db.schemaReads.push(ids)
            return { data: ids.map((id) => ({ id, template_schema: `<page ${id}>` })), error: null }
          },
        }
      },
    }),
  }),
}))
vi.mock('@/lib/db/device-cache', () => ({
  readDeviceCache: vi.fn(async (key: string) => db.saved.get(key)),
  writeDeviceCache: vi.fn(async (key: string, value: unknown) => {
    db.saved.set(key, structuredClone(value))
  }),
}))

describe('fetchDocumentTemplates › page images kept on the device', () => {
  beforeEach(() => {
    db.saved.clear()
    db.schemaReads.length = 0
    db.selects.length = 0
  })

  it('the list never asks for the page images; only forms not on the device are downloaded', async () => {
    const { fetchDocumentTemplates } = await import('@/features/documents/api/template-library-repository')
    db.list = [db.listRow('a'), db.listRow('b')]

    const first = await fetchDocumentTemplates()
    expect(first.map((t) => [t.id, t.templateSchema])).toEqual([['a', '<page a>'], ['b', '<page b>']])
    expect(db.selects[0]).not.toContain('template_schema')
    expect(db.schemaReads).toEqual([['a', 'b']])

    // Next start: nothing new, no image download, same forms
    const second = await fetchDocumentTemplates()
    expect(second).toEqual(first)
    expect(db.schemaReads).toHaveLength(1)

    // A new form downloads only itself; a deleted form drops out
    db.list = [db.listRow('c'), db.listRow('a')]
    const third = await fetchDocumentTemplates()
    expect(third.map((t) => t.id)).toEqual(['c', 'a'])
    expect(db.schemaReads[1]).toEqual(['c'])
    expect(Object.keys(db.saved.get('document-template-schemas:v1') as object).sort()).toEqual(['a', 'c'])
  })

  it('a form whose version changed is downloaded again', async () => {
    const { fetchDocumentTemplates } = await import('@/features/documents/api/template-library-repository')
    db.list = [db.listRow('a')]
    await fetchDocumentTemplates()
    db.list = [db.listRow('a', 2)]
    await fetchDocumentTemplates()
    expect(db.schemaReads).toEqual([['a'], ['a']])
  })

  it('without device storage every read downloads the images, as before', async () => {
    const cache = await import('@/lib/db/device-cache')
    vi.mocked(cache.readDeviceCache).mockResolvedValue(undefined)
    const { fetchDocumentTemplates } = await import('@/features/documents/api/template-library-repository')
    db.list = [db.listRow('a')]
    expect((await fetchDocumentTemplates())[0].templateSchema).toBe('<page a>')
    expect((await fetchDocumentTemplates())[0].templateSchema).toBe('<page a>')
    expect(db.schemaReads).toEqual([['a'], ['a']])
  })
})
