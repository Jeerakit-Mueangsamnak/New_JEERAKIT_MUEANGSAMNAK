import { liffText, readLiffRequest } from '@/lib/line/liff-request'
import { createSupabaseLineStore, type LiffPayForm } from '@/lib/line/supabase-store'
import { decodeJobPhoto } from '@/lib/line/job-photos'
import { textMessage } from '@/lib/line/templates'
import { processOutbox } from '@/lib/line/outbox'
import { createLineProvider, lineDeliveryMode } from '@/lib/line/provider'

/**
 * Pay form in LINE (LIFF, owner 2026-11-25), from the bill card's ชำระเงิน / แนบสลิป buttons. LOAD = the bill, the
 * shop's PromptPay / account and the slips sent; SLIP = one slip picture + the amount. Public: the LINE ID token
 * (checked with LINE) proves the person, and the database answers only for that bill's own checked customer.
 * A slip never takes money by itself: the shop checks it on สลิปรอตรวจ.
 */
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MESSAGES: Record<string, string> = {
  SUSPENDED: 'สิทธิ์การใช้งานนี้ถูกระงับ กรุณาติดต่อร้าน',
  NOT_FOUND: 'ไม่พบบิลนี้ หรือ LINE นี้ยังไม่ได้ผูกกับลูกค้าของบิลนี้',
  NOT_PAYABLE: 'บิลนี้ไม่มียอดค้างชำระแล้ว',
  INVALID_INPUT: 'กรุณาแนบรูปสลิป (ไม่เกิน 2 MB) และใส่ยอดที่โอนไม่เกินยอดค้าง',
  TOO_MANY: 'มีสลิปรอร้านตรวจหลายใบแล้ว กรุณารอร้านตรวจก่อน',
}
const fail = (result: string, status: number) => Response.json({ ok: false, result, message: MESSAGES[result] ?? 'ทำรายการไม่สำเร็จ' }, { status })
const answer = (form: LiffPayForm, extra: Record<string, unknown> = {}) =>
  Response.json({ ok: true, bill: form.bill, customer: form.customer ?? null, shop: form.shop, slips: form.slips ?? [], ...extra })
const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function POST(request: Request): Promise<Response> {
  const req = await readLiffRequest(request)
  if (!req.ok) return req.response
  const { body, lineUserId } = req
  const billId = liffText(body.billId, 40)
  const action = liffText(body.action, 10).toUpperCase()
  if (!UUID.test(billId) || !['LOAD', 'SLIP'].includes(action)) return fail('NOT_FOUND', 400)

  const store = createSupabaseLineStore()
  let path: string | null = null
  try {
    const form = await store.payForm(lineUserId, billId)
    if (form.result !== 'OK' || !form.bill) return fail(form.result, form.result === 'NOT_FOUND' ? 404 : 403)
    if (action === 'LOAD') return answer(form)

    const amount = typeof body.amount === 'number' ? Math.round(body.amount * 100) / 100 : Number.NaN
    const photo = decodeJobPhoto(body.photo)
    if (!photo || !Number.isFinite(amount) || amount <= 0) return fail('INVALID_INPUT', 400)
    if (!form.bill.payable) return fail('NOT_PAYABLE', 409)

    path = `${billId}/${crypto.randomUUID()}.${photo.ext}`
    await store.uploadSlip(path, photo.bytes, photo.type)
    const profile = await store.shopProfile()
    let ownerMessages: unknown[] | null
    try {
      ownerMessages = [textMessage('SLIP_OWNER_NEW', { ชื่อลูกค้า: form.customer || '-', เลขบิล: form.bill.bill_no || '-', ยอดเงิน: money(amount) }, profile.templates)]
    } catch {
      ownerMessages = null
    }
    const r = await store.slipSubmit({ lineUserId, billId, amount, path, ownerMessages })
    if (r.result !== 'OK') {
      await store.removeSlip(path).catch(() => undefined)
      return fail(r.result, r.result === 'INVALID_INPUT' ? 400 : 409)
    }
    // saved: the picture belongs to the slip now, whatever happens below
    path = null
    // the owner's notice goes out now with real LINE (a failed push waits in the outbox)
    if (lineDeliveryMode() === 'live') {
      try {
        const { accessToken } = await store.credentials()
        if (accessToken) await processOutbox({ store, provider: createLineProvider(accessToken), limit: 5 })
      } catch {
        // the slip is saved; the next outbox round sends the notice
      }
    }
    return answer(await store.payForm(lineUserId, billId), { message: 'ส่งสลิปแล้ว ร้านจะตรวจและแจ้งผลทาง LINE นี้' })
  } catch {
    if (path) await store.removeSlip(path).catch(() => undefined)
    return Response.json({ ok: false, message: 'ทำรายการไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 })
  }
}
