import { createSupabaseLineStore } from '@/lib/line/supabase-store'
import { lineOaMessageUrl } from '@/lib/line/oa-link'

/**
 * Staff QR scan (owner 2026-11-25). Public: the QR on the OWNER's screen points here with a single-use scan token.
 * The first scan kills the QR in the database and opens the shop chat with the code typed in; any later scan,
 * an expired or cancelled QR, or a made-up token gets only a page saying to ask for a new QR at the shop.
 */
export const dynamic = 'force-dynamic'

const TOKEN = /^[A-HJ-NP-Z2-9]{32}$/
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

function deadPage(): Response {
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR หมดอายุ</title></head><body style="font-family:sans-serif;padding:24px;color:#0f172a">
<h1 style="font-size:18px">QR นี้ใช้ไม่ได้แล้ว</h1>
<p style="font-size:14px">QR ถูกสแกนไปแล้ว หมดอายุ หรือถูกยกเลิก กรุณาขอ QR ใหม่ที่ร้าน</p></body></html>`
  return new Response(html, { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } })
}

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('t') ?? ''
  if (!TOKEN.test(token)) return deadPage()
  try {
    const store = createSupabaseLineStore()
    const r = await store.staffQrScan(token)
    if (r.result !== 'OK' || !r.code) return deadPage()
    const profile = await store.shopProfile()
    const url = lineOaMessageUrl(profile.lineId, r.code)
    if (!url) return deadPage()
    return new Response(null, { status: 302, headers: { Location: url, ...NO_STORE } })
  } catch {
    return deadPage()
  }
}
