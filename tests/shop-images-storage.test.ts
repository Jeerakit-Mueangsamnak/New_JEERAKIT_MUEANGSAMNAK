// Shop pictures in Storage (owner 2026-11-20, egress items 7–10): pictures inside text are uploaded once by
// content (same picture = one file) and replaced by their address; the rest of the text stays as it was.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const uploads = vi.hoisted(() => ({ paths: [] as string[], fail: null as null | { message: string; statusCode?: string } }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: vi.fn(async (path: string) => {
          uploads.paths.push(path)
          return { error: uploads.fail }
        }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `http://127.0.0.1:54321/storage/v1/object/public/shop-images/${path}` } }),
        remove: vi.fn(async () => ({ error: null })),
      }),
    },
  }),
}))

import { isInlineImage, isShopImageUrl, moveInlineImagesToStorage, shopImagePath, storedImageUrl } from '@/lib/storage/shop-images'
import { sanitizeStyleValue } from '@/features/documents/utils/document-html'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z'

beforeEach(() => {
  uploads.paths = []
  uploads.fail = null
})

describe('shop pictures in Storage', () => {
  it('a form: each different picture is uploaded once and every copy points at its file', async () => {
    const text = `<img src="${PNG}"><div style="background:url(${JPG})"></div><img src="${PNG}"><p>ข้อความเดิม</p>`
    const out = await moveInlineImagesToStorage(text)
    expect(uploads.paths).toHaveLength(2)
    expect(uploads.paths[0]).toMatch(/^forms\/[0-9a-f]{64}\.png$/)
    expect(uploads.paths[1]).toMatch(/^forms\/[0-9a-f]{64}\.jpg$/)
    expect(out).not.toContain('data:image')
    expect(out).toContain('<p>ข้อความเดิม</p>')
    expect(out.match(new RegExp(uploads.paths[0], 'g'))).toHaveLength(2)
  })

  it('a form with no pictures inside is left untouched and nothing is uploaded', async () => {
    expect(await moveInlineImagesToStorage('<p>ไม่มีรูป</p>')).toBe('<p>ไม่มีรูป</p>')
    expect(uploads.paths).toHaveLength(0)
  })

  it('a picture already stored (same name) counts as saved; any other upload error stops the save', async () => {
    uploads.fail = { message: 'The resource already exists', statusCode: '409' }
    expect(isShopImageUrl(await storedImageUrl('logo', PNG))).toBe(true)
    uploads.fail = { message: 'new row violates row-level security policy', statusCode: '403' }
    await expect(storedImageUrl('logo', PNG)).rejects.toThrow('อัปโหลดรูปไม่สำเร็จ')
  })

  it('an address or an empty value is kept as it is', async () => {
    const url = 'http://127.0.0.1:54321/storage/v1/object/public/shop-images/logo/abc.png'
    expect(await storedImageUrl('logo', url)).toBe(url)
    expect(await storedImageUrl('logo', '')).toBe('')
    expect(uploads.paths).toHaveLength(0)
    expect(isInlineImage(url)).toBe(false)
    expect(shopImagePath(url)).toBe('logo/abc.png')
    expect(shopImagePath('https://example.com/logo.png')).toBeNull()
  })

  it('forms may show the shop own Storage pictures (Supabase Local is http)', () => {
    const url = 'http://127.0.0.1:54321/storage/v1/object/public/shop-images/forms/abc.png'
    expect(sanitizeStyleValue(`background-image:url(${url})`)).toContain(url)
    expect(sanitizeStyleValue('background-image:url(http://evil.example/x.png)')).toBe('')
  })
})
