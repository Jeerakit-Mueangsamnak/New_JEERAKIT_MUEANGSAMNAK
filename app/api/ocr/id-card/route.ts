import { createClient } from '@/lib/supabase/server'
import { ocrSpaceConfigured, readWithOcrSpace } from '@/lib/ocr/ocr-space'

/**
 * ID card photo → OCR lines from OCR.space (free, reads Thai, deletes uploads after processing),
 * for signed-in staff only. The browser parses the lines itself (thai-id-parser.ts) and falls
 * back to Tesseract on any non-200. Nothing is stored here: the photo is kept only when the
 * customer is saved (customer-repository).
 *
 * Free plan = 25,000 requests a month. This server never goes past OCRSPACE_MONTHLY_LIMIT
 * (default and ceiling 25,000). The count lives in server memory, so a restart starts it again.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FREE_MONTHLY_REQUESTS = 25_000
/** About 4 MB of base64 — a 1600 px JPEG card photo is far below this. */
const MAX_IMAGE_CHARS = 4_000_000

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

  if (!ocrSpaceConfigured()) return Response.json({ ok: false, reason: 'NOT_CONFIGURED' }, { status: 503 })

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
