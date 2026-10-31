// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'staff-1' } } }) } })),
}))

import { POST } from '@/app/api/ocr/id-card/route'
import { createClient } from '@/lib/supabase/server'
import { OCR_SPACE_LINE_CONFIDENCE, ocrSpaceLines, readWithOcrSpace } from '@/lib/ocr/ocr-space'

const IMAGE = 'QUJD' // tiny valid base64
const ok = (lines: string[]) => ({
  IsErroredOnProcessing: false,
  ParsedResults: [{ FileParseExitCode: 1, TextOverlay: { Lines: lines.map((LineText) => ({ LineText })) } }],
})
const post = (image = IMAGE) =>
  POST(new Request('http://localhost/api/ocr/id-card', { method: 'POST', body: JSON.stringify({ image }) }))

beforeEach(() => {
  process.env.OCRSPACE_API_KEY = 'test-ocrspace-key'
  delete process.env.OCRSPACE_MONTHLY_LIMIT
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OCRSPACE_API_KEY
})

describe('OCR.space reader', () => {
  it('sends the photo with the server key to Engine 2 and returns its lines in order', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json(ok(['ชื่อตัวและชื่อสกุล นาย ก ข', '  ', 'ที่อยู่ 1'])))
    vi.stubGlobal('fetch', fetchMock)

    const lines = await readWithOcrSpace(IMAGE)
    expect(lines).toEqual([
      { text: 'ชื่อตัวและชื่อสกุล นาย ก ข', confidence: OCR_SPACE_LINE_CONFIDENCE },
      { text: 'ที่อยู่ 1', confidence: OCR_SPACE_LINE_CONFIDENCE },
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.ocr.space/parse/image')
    expect((init.headers as Record<string, string>).apikey).toBe('test-ocrspace-key')
    const form = init.body as FormData
    expect(form.get('OCREngine')).toBe('2')
    expect(form.get('base64Image')).toBe(`data:image/jpeg;base64,${IMAGE}`)
  })

  it('a processing error is thrown, never returned as empty lines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ IsErroredOnProcessing: true, ErrorMessage: ['E101: Timed out'] })))
    await expect(readWithOcrSpace(IMAGE)).rejects.toThrow('E101')
  })

  it('an image over the 1 MB free limit is not sent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(readWithOcrSpace('A'.repeat(1_500_000))).rejects.toThrow('1 MB')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no result at all reads as no lines', () => {
    expect(ocrSpaceLines(null)).toEqual([])
  })
})

describe('/api/ocr/id-card', () => {
  it('answers with OCR.space lines when it is set up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(ok(['ที่อยู่ 145']))))
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, lines: [{ text: 'ที่อยู่ 145' }] })
  })

  it('OCR.space failing answers 502, so the browser reads with Tesseract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    const res = await post()
    expect(res.status).toBe(502)
  })

  it('no OCR.space key answers 503 without reading the photo', async () => {
    delete process.env.OCRSPACE_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await post()).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a signed-out request is refused', async () => {
    vi.mocked(createClient).mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null } }) } } as never)
    expect((await post()).status).toBe(401)
  })

  it('a monthly limit of 0 stops OCR.space before any call', async () => {
    process.env.OCRSPACE_MONTHLY_LIMIT = '0'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await post()).status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
