import { liffText, readLiffRequest } from '@/lib/line/liff-request'
import { createSupabaseLineStore } from '@/lib/line/supabase-store'

/**
 * Income / expense form in LINE (LIFF, owner 2026-11-13): the OWNER's own LINE only, saved
 * straight into finance (no review step). LOAD = who is it + the income quick items; SAVE = one entry.
 */
export const dynamic = 'force-dynamic'

const CHANNELS = ['CASH', 'TRANSFER', 'QR', 'OTHER']
const MESSAGES: Record<string, string> = {
  SUSPENDED: 'สิทธิ์การใช้งานนี้ถูกระงับ กรุณาติดต่อเจ้าของร้าน',
  NOT_OWNER: 'ฟอร์มนี้ใช้ได้เฉพาะ LINE ของเจ้าของร้านที่ผูกกับระบบแล้ว',
  INVALID_INPUT: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจหมวด จำนวนเงิน และช่องทาง',
}
const fail = (result: string, status: number) => Response.json({ ok: false, result, message: MESSAGES[result] ?? 'ทำรายการไม่สำเร็จ' }, { status })

export async function POST(request: Request): Promise<Response> {
  const req = await readLiffRequest(request)
  if (!req.ok) return req.response
  const { body, lineUserId } = req
  const action = liffText(body.action, 10).toUpperCase()
  const store = createSupabaseLineStore()
  try {
    if (action === 'LOAD') {
      const r = await store.ownerFinanceForm(lineUserId)
      if (r.result !== 'OK') return fail(r.result, 403)
      return Response.json({ ok: true, name: r.name ?? '', incomeItems: (r.income_items ?? []).filter((x) => typeof x === 'string' && x.trim()) })
    }
    if (action !== 'SAVE') return fail('INVALID_INPUT', 400)
    const kind = liffText(body.kind, 10).toUpperCase()
    const amount = typeof body.amount === 'number' ? body.amount : Number.NaN
    const channel = liffText(body.channel, 10).toUpperCase()
    const category = liffText(body.category, 101)
    const note = liffText(body.note, 501) || null
    if ((kind !== 'INCOME' && kind !== 'EXPENSE') || !Number.isFinite(amount) || amount <= 0 || !CHANNELS.includes(channel) || !category) {
      return fail('INVALID_INPUT', 400)
    }
    const r = await store.financeEntry(lineUserId, { kind, category, amount: Math.round(amount * 100) / 100, channel, note })
    if (r.result !== 'OK') return fail(r.result, r.result === 'NOT_OWNER' || r.result === 'SUSPENDED' ? 403 : 400)
    return Response.json({ ok: true, docNo: r.doc_no ?? '', amount: r.amount ?? amount, message: 'บันทึกเข้าการเงินแล้ว' })
  } catch {
    return Response.json({ ok: false, message: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 })
  }
}
