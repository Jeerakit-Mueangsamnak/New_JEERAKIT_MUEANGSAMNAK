import { liffText, readLiffRequest } from '@/lib/line/liff-request'
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

export async function POST(request: Request): Promise<Response> {
  const req = await readLiffRequest(request)
  if (!req.ok) return req.response
  const { body, lineUserId, name } = req
  const code = liffText(body.code, 20).toUpperCase()
  if (!CODE.test(code)) return Response.json({ ok: false, message: MESSAGES.INVALID }, { status: 400 })

  try {
    const r = await createSupabaseLineStore().liffBind({
      lineUserId,
      displayName: name,
      code,
      typedName: liffText(body.typedName, 200),
      typedPhone: liffText(body.typedPhone, 30) || null,
      lineHandle: liffText(body.lineHandle, 60) || null,
      isFriend: typeof body.isFriend === 'boolean' ? body.isFriend : null,
    })
    const ok = r.result.startsWith('LINKED_')
    return Response.json({ ok, result: r.result, kind: r.kind ?? null, message: MESSAGES[r.result] ?? 'ผูก LINE ไม่สำเร็จ' }, { status: ok ? 200 : 409 })
  } catch {
    return Response.json({ ok: false, message: 'ผูก LINE ไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 })
  }
}
