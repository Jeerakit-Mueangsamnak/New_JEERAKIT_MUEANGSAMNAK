import type { OcrLine } from '@/lib/ocr/thai-id-parser'

/**
 * OCR.space (Engine 2, reads Thai) → the same OcrLine[] the other engines give, so
 * thai-id-parser.ts reads them alike. Server only: OCRSPACE_API_KEY never reaches the browser.
 * Free plan: 25,000 requests a month, images up to 1 MB. Their privacy policy: uploaded files
 * are deleted after processing (https://ocr.space/privacypolicy).
 */

const OCR_SPACE_URL = 'https://api.ocr.space/parse/image'
/** Free plan limit on one image. */
export const OCR_SPACE_MAX_BYTES = 1024 * 1024
/**
 * Engine 2 reports no confidence per line. The parser's own checks still decide every field
 * (check digit, name prefix/label, address against the province list, real dates).
 */
export const OCR_SPACE_LINE_CONFIDENCE = 90

interface OcrSpaceResponse {
  IsErroredOnProcessing?: boolean
  ErrorMessage?: string | string[]
  ParsedResults?: { FileParseExitCode?: number; ErrorMessage?: string; TextOverlay?: { Lines?: { LineText?: string }[] } }[]
}

export function ocrSpaceConfigured(): boolean {
  return Boolean(process.env.OCRSPACE_API_KEY)
}

/** Lines in the order OCR.space reads them (top to bottom, column by column). */
export function ocrSpaceLines(body: OcrSpaceResponse | null | undefined): OcrLine[] {
  return (body?.ParsedResults?.[0]?.TextOverlay?.Lines ?? [])
    .map((line) => (line.LineText ?? '').trim())
    .filter(Boolean)
    .map((text) => ({ text, confidence: OCR_SPACE_LINE_CONFIDENCE }))
}

/** Reads the card photo (base64 JPEG/PNG without the data: prefix). Throws on any failure. */
export async function readWithOcrSpace(imageBase64: string): Promise<OcrLine[]> {
  const apiKey = process.env.OCRSPACE_API_KEY
  if (!apiKey) throw new Error('OCR.space is not configured')
  if (Math.floor((imageBase64.length * 3) / 4) > OCR_SPACE_MAX_BYTES) throw new Error('OCR.space: image over 1 MB')

  const mime = imageBase64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg'
  const form = new FormData()
  form.set('base64Image', `data:${mime};base64,${imageBase64}`)
  form.set('OCREngine', '2')
  form.set('language', 'auto')
  form.set('isOverlayRequired', 'true')
  form.set('scale', 'true')
  form.set('detectOrientation', 'true')

  const res = await fetch(OCR_SPACE_URL, {
    method: 'POST',
    headers: { apikey: apiKey },
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
  const body = (await res.json().catch(() => null)) as OcrSpaceResponse | null
  const first = body?.ParsedResults?.[0]
  if (!res.ok || !body || body.IsErroredOnProcessing || !first || first.FileParseExitCode !== 1) {
    const message = [body?.ErrorMessage, first?.ErrorMessage].flat().filter(Boolean).join(' ')
    throw new Error(`OCR.space ${res.status}: ${message || 'no result'}`)
  }
  return ocrSpaceLines(body)
}
