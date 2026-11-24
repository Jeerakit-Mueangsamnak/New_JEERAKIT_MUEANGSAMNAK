import { LINE_REGISTER_FIELD_LABELS, LINE_REGISTER_FIELDS, type LineRegisterField } from '@/lib/line/config'
import { liffText, readLiffRequest } from '@/lib/line/liff-request'
import { createSupabaseLineStore } from '@/lib/line/supabase-store'

/**
 * Registration form opened in LINE (LIFF, owner 2026-11-21).
 * GET  → what the form asks (which address parts are a must, the shop's privacy text); public and not secret.
 * POST → the LINE ID token, verified with LINE, proves the LINE account; the database files a REQUEST for the
 *        shop to check (line_register_submit). No customer is made and no LINE is linked here, and the answer
 *        never tells whether the phone is already a customer's.
 */
export const dynamic = 'force-dynamic'

const MESSAGES: Record<string, string> = {
  SUSPENDED: 'สิทธิ์การใช้งานนี้ถูกระงับ กรุณาติดต่อเจ้าของร้าน',
  RATE_LIMITED: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  DUPLICATE: 'รับคำขอนี้แล้ว กรุณารอสักครู่',
  PENDING: 'ส่งคำขอลงทะเบียนแล้ว ร้านจะตรวจสอบข้อมูลก่อน และแจ้งผลทาง LINE',
  INVALID: 'กรุณาใส่ชื่อและเบอร์โทร 10 หลัก (ขึ้นต้นด้วย 0)',
  CONSENT_REQUIRED: 'กรุณาติ๊กรับทราบการเก็บข้อมูลก่อนส่ง',
  ALREADY_LINKED: 'LINE นี้ผูกกับร้านไว้แล้ว ไม่ต้องลงทะเบียนอีก',
  REJECTED: 'ร้านยังไม่สามารถรับลงทะเบียนจาก LINE นี้ได้ กรุณาติดต่อร้านโดยตรง',
}

export async function GET(): Promise<Response> {
  try {
    const cfg = await createSupabaseLineStore().registerConfig()
    return Response.json({ ok: true, required: cfg.required, privacy: cfg.privacy, shopName: cfg.shopName })
  } catch {
    return Response.json({ ok: false, message: 'โหลดแบบฟอร์มไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<Response> {
  const req = await readLiffRequest(request)
  if (!req.ok) return req.response
  const { body, lineUserId, name } = req

  const address: Record<string, string> = {}
  const rawAddress = body.address && typeof body.address === 'object' && !Array.isArray(body.address) ? (body.address as Record<string, unknown>) : {}
  for (const field of LINE_REGISTER_FIELDS) {
    const value = liffText(rawAddress[field], field === 'address' ? 300 : 100)
    if (value) address[field] = value
  }

  try {
    const r = await createSupabaseLineStore().registerSubmit({
      lineUserId,
      name: liffText(body.name, 200),
      phone: liffText(body.phone, 30).replace(/\D/g, ''),
      address,
      consent: body.consent === true,
      displayName: name,
      isFriend: typeof body.isFriend === 'boolean' ? body.isFriend : null,
    })
    if (r.result === 'MISSING') {
      const labels = (r.fields ?? []).filter((f): f is LineRegisterField => (LINE_REGISTER_FIELDS as readonly string[]).includes(f)).map((f) => LINE_REGISTER_FIELD_LABELS[f])
      return Response.json({ ok: false, result: r.result, fields: r.fields ?? [], message: `กรุณากรอก: ${labels.join(', ')}` }, { status: 400 })
    }
    const ok = r.result === 'PENDING'
    return Response.json({ ok, result: r.result, message: MESSAGES[r.result] ?? 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่' }, { status: ok ? 200 : r.result === 'SUSPENDED' ? 403 : r.result === 'RATE_LIMITED' || r.result === 'DUPLICATE' ? 429 : 409 })
  } catch {
    return Response.json({ ok: false, message: 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 })
  }
}
