import { createClient } from '@/lib/supabase/server'
import { ocrSpaceConfigured, readWithOcrSpace } from '@/lib/ocr/ocr-space'
import { THAI_ID_CLAIRIC_FIELDS } from '@/lib/ocr/clairic-fields'
import { parseClairicThaiIdCard, type ClairicAnswers } from '@/lib/ocr/clairic-id-card'
import { THAI_ADDRESS_DATA } from '@/lib/thai-address-data'

/**
 * Signed-in POS staff only: Cloudflare Clairic structured extraction on the existing
 * Worker first; OCR.space second; browser Tesseract is the final fallback.
 * No images or customer records are stored by this route. Photos are saved only via
 * the existing private Supabase customer-document flow when the owner confirms.
 * OCRSPACE_MONTHLY_LIMIT only controls the OCR.space fallback, not Clairic usage.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FREE_MONTHLY_REQUESTS = 25_000
/** 4 MiB JPEG represented as base64 (Clairic media limit). */
const MAX_IMAGE_CHARS = 5_600_000 // up to 4 MiB of decoded JPEG

const usage = { month: '', count: 0 }

function monthlyLimit(): number {
  const set = Number(process.env.OCRSPACE_MONTHLY_LIMIT)
  return Number.isFinite(set) && set >= 0 ? Math.min(set, FREE_MONTHLY_REQUESTS) : FREE_MONTHLY_REQUESTS
}

/** Takes one request of this month's allowance; false once it is used up. */
function takeUnit(): boolean {
  const month = new Date().toISOString().slice(0, 7)
  if (usage.month !== month) {
    usage.month = month
    usage.count = 0
  }
  if (usage.count >= monthlyLimit()) return false
  usage.count += 1
  return true
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return Response.json({ ok: false, reason: 'UNAUTHORIZED' }, { status: 401 })

  let image = ''
  try {
    const body = (await request.json()) as { image?: unknown }
    image = typeof body.image === 'string' ? body.image.replace(/^data:image\/[a-z]+;base64,/, '') : ''
  } catch {
    // falls through to the check below
  }
  if (!image || image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    return Response.json({ ok: false, reason: 'BAD_IMAGE' }, { status: 400 })
  }

  // First: structured extraction through the AI binding on the EXISTING POS Worker.
  // Local Next.js development may not provide a Workers AI binding: fall back gracefully.
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const context = getCloudflareContext()
    const ai = (context.env as { AI?: { run: (model: string, input: unknown) => Promise<unknown> } }).AI
    if (ai) {
      const output = await ai.run('@cf/cloudflare/clairic', {
        state: 'Read ONLY data visibly printed on the front of this Thai national ID card. Do not infer or invent missing text.',
        images: [image],
        fields: THAI_ID_CLAIRIC_FIELDS,
        reference_date: new Date().toISOString().slice(0, 10),
      }) as { answers?: ClairicAnswers; truncated?: boolean }
      if (output?.answers && !output.truncated) {
        const fields = parseClairicThaiIdCard(output.answers, THAI_ADDRESS_DATA)
        if (Object.values(fields).some(Boolean)) return Response.json({ ok: true, provider: 'clairic', fields })
      }
    }
  } catch {
    // Do not log identity-card contents, images or provider output.
    console.warn('[ocr/id-card] Cloudflare AI unavailable; falling back to existing OCR')
  }

  if (!ocrSpaceConfigured()) return Response.json({ ok: false, reason: 'NOT_CONFIGURED' }, { status: 503 })
  if (!takeUnit()) return Response.json({ ok: false, reason: 'QUOTA_REACHED' }, { status: 429 })

  try {
    const lines = await readWithOcrSpace(image)
    return Response.json({ ok: true, lines })
  } catch (err) {
    // The error text never holds the key or the photo; keep the card data out of the log.
    console.warn('[ocr/id-card] OCR.space failed:', err instanceof Error ? err.message : err)
    return Response.json({ ok: false, reason: 'OCR_FAILED' }, { status: 502 })
  }
}
