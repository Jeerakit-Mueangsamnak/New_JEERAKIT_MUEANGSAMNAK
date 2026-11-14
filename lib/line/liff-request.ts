import 'server-only'
import { verifyLiffIdToken } from './liff'

/**
 * A request from a LIFF form (public: the person has no POS session). The LINE ID token, checked
 * with LINE, proves the LINE account; the page never sends a userId of its own.
 */
export type LiffRequest =
  | { ok: true; lineUserId: string; name: string | null; body: Record<string, unknown> }
  | { ok: false; response: Response }

export const liffText = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function readLiffRequest(request: Request): Promise<LiffRequest> {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID ?? ''
  if (!channelId) return { ok: false, response: Response.json({ ok: false, message: 'ระบบ LINE ยังไม่ได้ตั้งค่า (LINE Login)' }, { status: 503 }) }
  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape')
    body = parsed as Record<string, unknown>
  } catch {
    return { ok: false, response: Response.json({ ok: false, message: 'คำขอไม่ถูกต้อง' }, { status: 400 }) }
  }
  const verified = await verifyLiffIdToken(liffText(body.idToken, 4096), channelId)
  if (!verified.ok) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, message: verified.error === 'NETWORK' ? 'ติดต่อ LINE ไม่ได้ กรุณาลองใหม่' : 'ยืนยันตัวตน LINE ไม่สำเร็จ กรุณาเปิดลิงก์ในแอป LINE อีกครั้ง' },
        { status: verified.error === 'NETWORK' ? 502 : 401 },
      ),
    }
  }
  return { ok: true, lineUserId: verified.lineUserId, name: verified.name, body }
}
