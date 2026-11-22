import { EMPTY_PARSED_ID_CARD, parseThaiIdCardLines, type OcrLine, type ParsedThaiIdCard } from '@/lib/ocr/thai-id-parser'
import { logger } from '@/lib/utils/logger'

/** A read card: only values the parser could prove (anything unread is '') plus the photo kept. */
export interface ScannedIdCard extends ParsedThaiIdCard {
  croppedImageDataUrl: string
  /** The OCR itself failed (not just an unreadable field): the photo is kept, nothing is filled. */
  ocrFailed?: boolean
}

/** Card photos the upload button and the camera hand to the OCR. */
export const ID_CARD_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
const ID_CARD_PHOTO_MAX_BYTES = 8 * 1024 * 1024

/** The chosen file as a data URL, or null when it is not a JPG / PNG / WebP up to 8 MB. */
export function readIdCardPhotoFile(file: File): Promise<string | null> {
  if (!ID_CARD_PHOTO_ACCEPT.split(',').includes(file.type) || !file.size || file.size > ID_CARD_PHOTO_MAX_BYTES) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

/** One path for both buttons (camera snapshot, uploaded photo): read the card, keep the photo. */
export async function scanIdCardPhoto(imageDataUrl: string, onProgress?: (percent: number) => void): Promise<ScannedIdCard> {
  try {
    return { ...(await readThaiIdCard(imageDataUrl, onProgress)), croppedImageDataUrl: imageDataUrl }
  } catch (err) {
    logger.warn('ID card OCR failed:', err)
    return { ...EMPTY_PARSED_ID_CARD, croppedImageDataUrl: imageDataUrl, ocrFailed: true }
  }
}

/**
 * Read the front of a Thai ID card: Cloudflare Clairic structured extraction,
 * OCR.space text extraction, then browser Tesseract (Thai + English).
 * Every extracted field is validated before autofill; untrusted data stays blank.
 */
export async function readThaiIdCard(imageDataUrl: string, onProgress?: (percent: number) => void): Promise<ParsedThaiIdCard> {
  const [{ THAI_ADDRESS_DATA }, response] = await Promise.all([
    import('@/lib/thai-address-data'),
    readWithServer(imageDataUrl),
  ])
  if (response?.fields) {
    // Structured fields have already passed checks on the server. Fill gaps with
    // the existing local OCR only when required; never overwrite a trusted value.
    const structured = response.fields
    if (structured.name && structured.idCardNumber && structured.province && structured.district && structured.subDistrict) return structured
    try {
      const fallback = parseThaiIdCardLines(await readWithTesseract(imageDataUrl, onProgress), THAI_ADDRESS_DATA)
      const filled = { ...structured }
      // Never combine a district or sub-district from one province with a
      // different OCR result's province/district.
      for (const key of Object.keys(filled) as (keyof ParsedThaiIdCard)[]) {
        if (key === 'province' || key === 'district' || key === 'subDistrict') continue
        if (!filled[key]) filled[key] = fallback[key]
      }
      if (!filled.province && fallback.province) filled.province = fallback.province
      if (!filled.district && filled.province === fallback.province && fallback.district) filled.district = fallback.district
      if (!filled.subDistrict && filled.province === fallback.province && filled.district === fallback.district) {
        filled.subDistrict = fallback.subDistrict
      }
      return filled
    } catch {
      return structured
    }
  }
  const lines = response?.lines ?? await readWithTesseract(imageDataUrl, onProgress)
  return parseThaiIdCardLines(lines, THAI_ADDRESS_DATA)
}

/** null = use browser Tesseract fallback (Cloudflare AI and OCR.space unavailable). */
async function readWithServer(imageDataUrl: string): Promise<{ fields?: ParsedThaiIdCard; lines?: OcrLine[] } | null> {
  try {
    const res = await fetch('/api/ocr/id-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: await shrinkForUpload(imageDataUrl) }),
    })
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean; fields?: ParsedThaiIdCard; lines?: OcrLine[]; reason?: string
    } | null
    if (res.ok && body?.ok) {
      if (body.fields && typeof body.fields === 'object') return { fields: body.fields }
      if (Array.isArray(body.lines)) return { lines: body.lines }
    }
    logger.warn('Server OCR unavailable, using Tesseract:', body?.reason ?? res.status)
  } catch (err) {
    logger.warn('Server OCR request failed, using Tesseract:', err)
  }
  return null
}

async function readWithTesseract(imageDataUrl: string, onProgress?: (percent: number) => void): Promise<OcrLine[]> {
  const [{ createWorker }, image] = await Promise.all([import('tesseract.js'), prepareImage(imageDataUrl)])
  const worker = await createWorker(['tha', 'eng'], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100))
    },
  })
  try {
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
    return ocrLines(data.blocks)
  } finally {
    await worker.terminate()
  }
}

type Blocks = { paragraphs: { lines: { text: string; confidence: number }[] }[] }[] | null

function ocrLines(blocks: Blocks): OcrLine[] {
  return (blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => ({ text: l.text, confidence: l.confidence }))))
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('เปิดรูปบัตรไม่ได้'))
    el.src = dataUrl
  })
}

/** OCR.space free plan takes images up to 1 MB: about 1.37 million base64 characters. */
const MAX_UPLOAD_CHARS = 1_300_000

/** Colour JPEG, at most 1600 px wide and under 1 MB: read well, and the upload stays small. */
async function shrinkForUpload(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, 1600 / img.naturalWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  let out = canvas.toDataURL('image/jpeg', 0.9)
  for (const quality of [0.8, 0.7, 0.6]) {
    if (out.length <= MAX_UPLOAD_CHARS) break
    out = canvas.toDataURL('image/jpeg', quality)
  }
  return out
}

/** Grey-scale and enlarge to about 2000 px wide: small, coloured card photos read poorly. */
async function prepareImage(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)
  const scale = Math.min(3, Math.max(1, 2000 / img.naturalWidth))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.filter = 'grayscale(1) contrast(1.3)'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}
