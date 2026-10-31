import { verifyLiffIdToken } from '@/lib/line/liff'
import { createSupabaseLineStore } from '@/lib/line/supabase-store'

/**
 * LIFF invite page → link this LINE to the person the invite code was made for. Public (the
 * person has no POS session): the LINE ID token, verified with LINE, proves the LINE account;
 * the single-use code proves which staff member / driver / customer it is. The database keeps
 * what was typed and flags a name / phone that does not match (line_liff_bind).
 */
export const dynamic = 'force-dynamic'

const CODE = /^LINK-[A-HJ-NP-Z2-9]{10}$/
const MESSAGES: Record<string, string> = {
  LINKED_STAFF: 'ผูก LINE กับบัญชีพนักงานเรียบร้อย',
  LINKED_DRIVER: 'ผูก LINE กับรายชื่อคนขับเรียบร้อย',
  LINKED_CUSTOMER: 'ผูก LINE กับร้านเรียบร้อย คุณจะได้รับแจ้งเตือนทาง LINE นี้',
  ALREADY_LINKED: 'LINE นี้ผูกกับร้านไว้แล้ว',
  INVALID: 'ลิงก์ไม่ถูกต้องหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่จากร้าน',
  EXPIRED: 'ลิงก์หมดอายุ กรุณาขอลิงก์ใหม่จากร้าน',
  LOCKED: 'ลองผิดหลายครั้ง กรุณารอสักครู่แล้วขอลิงก์ใหม่จากร้าน',
  TARGET_TAKEN: 'รายชื่อนี้ผูกกับ LINE อื่นแล้ว ให้ร้านยกเลิกก่อน',
  NAME_REQUIRED: 'กรุณากรอกชื่อ',
  PHONE_REQUIRED: 'กรุณากรอกเบอร์โทร',
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function POST(request: Request): Promise<Response> {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID ?? ''
  if (!channelId) return Response.json({ ok: false, message: 'ระบบผูก LINE ยังไม่ได้ตั้งค่า (LINE Login)' }, { status: 503 })
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, message: 'คำขอไม่ถูกต้อง' }, { status: 400 })
  }
  const code = clean(body.code, 20).toUpperCase()
  if (!CODE.test(code)) return Response.json({ ok: false, message: MESSAGES.INVALID }, { status: 400 })

  const verified = await verifyLiffIdToken(clean(body.idToken, 4096), channelId)
  if (!verified.ok) {
    return Response.json(
      { ok: false, message: verified.error === 'NETWORK' ? 'ติดต่อ LINE ไม่ได้ กรุณาลองใหม่' : 'ยืนยันตัวตน LINE ไม่สำเร็จ กรุณาเปิดลิงก์ใหม่ในแอป LINE' },
      { status: verified.error === 'NETWORK' ? 502 : 401 },
    )
  }
  try {
    const r = await createSupabaseLineStore().liffBind({
      lineUserId: verified.lineUserId,
      displayName: verified.name,
      code,
      typedName: clean(body.typedName, 200),
      typedPhone: clean(body.typedPhone, 30) || null,
      lineHandle: clean(body.lineHandle, 60) || null,
      isFriend: typeof body.isFriend === 'boolean' ? body.isFriend : null,
    })
    const ok = r.result.startsWith('LINKED_')
    return Response.json({ ok, result: r.result, kind: r.kind ?? null, message: MESSAGES[r.result] ?? 'ผูก LINE ไม่สำเร็จ' }, { status: ok ? 200 : 409 })
  } catch {
    return Response.json({ ok: false, message: 'ผูก LINE ไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 })
  }
}
