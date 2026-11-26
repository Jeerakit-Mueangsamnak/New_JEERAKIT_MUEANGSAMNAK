/**
 * Automatic slip check (owner 2026-11-26: ก, check and label, the shop still approves). A slip sent from the LINE pay
 * form is read by EasySlip (https://document.easyslip.com/en/v2/verify/bank): the bank reference, the amount and the
 * receiving account. Here it is compared with the amount the customer typed and the shop's receiving account names
 * (policies.line.slipCheck.receiverNames); the database adds "the same reference was already sent" (line_slip_check_save).
 * The result is only a label on สลิปรอตรวจ: it never takes money by itself. The service key is in Vault.
 */

export const EASYSLIP_VERIFY_URL = 'https://api.easyslip.com/v2/verify/bank'
const TIMEOUT_MS = 10_000

export interface SlipCheckSettings {
  enabled: boolean
  receiverNames: string[]
}

export function parseSlipCheck(v: unknown): SlipCheckSettings {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const names = Array.isArray(o.receiverNames) ? o.receiverNames.filter((n): n is string => typeof n === 'string' && n.trim() !== '').slice(0, 5) : []
  return { enabled: o.enabled === true, receiverNames: names }
}

export type SlipCheckStatus = 'PASS' | 'FAIL' | 'ERROR'
export type SlipCheckReason = 'AMOUNT' | 'RECEIVER' | 'DUPLICATE' | 'NO_QR' | 'PENDING' | 'SERVICE'

export interface SlipCheckOutcome {
  status: SlipCheckStatus
  ref: string | null
  detail: {
    provider: 'EASYSLIP'
    reasons: SlipCheckReason[]
    amount_slip?: number
    amount_ok?: boolean
    receiver?: string
    receiver_ok?: boolean | null
    paid_at?: string
    error?: string
  }
}

/** Thai labels for the reasons (สลิปรอตรวจ). */
export const SLIP_CHECK_REASON_LABEL: Record<SlipCheckReason, string> = {
  AMOUNT: 'ยอดในสลิปไม่ตรงกับยอดที่ลูกค้าใส่',
  RECEIVER: 'บัญชีผู้รับไม่ตรงกับบัญชีของร้าน',
  DUPLICATE: 'สลิปนี้เคยส่งมาแล้ว',
  NO_QR: 'อ่าน QR บนสลิปไม่ได้ อาจไม่ใช่สลิปจริง',
  PENDING: 'ธนาคารยังไม่ยืนยันรายการ (โอนไม่ถึง 5 นาที)',
  SERVICE: 'บริการตรวจสลิปตอบไม่ได้',
}

const TITLES = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|บจก\.?|หจก\.?|บริษัท|ห้างหุ้นส่วนจำกัด|mr\.?|mrs\.?|ms\.?|miss)\s*/i
const norm = (s: string) => s.toLowerCase().replace(TITLES, '').replace(/[\s.\-*_x]/g, '')
const digits = (s: string) => s.replace(/\D/g, '')

/**
 * Whether the receiver shown on the slip is one of the shop's. Banks mask names and numbers (นาย จีรกิตติ์ ม, xxx-x-x5678-x),
 * so a name matches on its first word and a number on the digits the bank left visible.
 */
export function receiverMatches(configured: string[], shown: string[]): boolean | null {
  const names = configured.map((n) => n.trim()).filter(Boolean)
  const seen = shown.map((s) => s.trim()).filter(Boolean)
  if (names.length === 0 || seen.length === 0) return null
  return names.some((name) => {
    if (/^[\d\s-]+$/.test(name)) {
      const want = digits(name)
      return seen.some((s) => {
        const got = digits(s)
        return got.length >= 3 && want.length >= 3 && (want.includes(got) || got.includes(want))
      })
    }
    const first = norm(name.replace(TITLES, '').split(/\s+/)[0] ?? '')
    if (first.length < 2) return false
    return seen.some((s) => {
      const got = norm(s)
      return got.length >= 2 && (got.includes(first) || first.startsWith(got))
    })
  })
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Reads EasySlip's answer (v2; the image example and the type list differ, so both shapes are read). */
export function evaluateEasySlip(body: unknown, httpStatus: number, typedAmount: number, receiverNames: string[]): SlipCheckOutcome {
  const b = obj(body)
  if (b.success !== true) {
    const code = str(obj(b.error).code) || `HTTP_${httpStatus}`
    if (code === 'SLIP_NOT_FOUND') return { status: 'FAIL', ref: null, detail: { provider: 'EASYSLIP', reasons: ['NO_QR'], error: code } }
    if (code === 'SLIP_PENDING') return { status: 'ERROR', ref: null, detail: { provider: 'EASYSLIP', reasons: ['PENDING'], error: code } }
    return { status: 'ERROR', ref: null, detail: { provider: 'EASYSLIP', reasons: ['SERVICE'], error: code.slice(0, 60) } }
  }
  const data = obj(b.data)
  const raw = obj(data.rawSlip ?? data)
  const ref = str(raw.transRef).trim().slice(0, 100) || null
  const amountSlip = Number(data.amountInSlip ?? obj(raw.amount).amount)
  const amountOk = Number.isFinite(amountSlip) && Math.abs(amountSlip - typedAmount) < 0.005
  const account = obj(obj(raw.receiver).account)
  const name = obj(account.name)
  const shown = [str(name.th), str(name.en), str(obj(account.bank).account), str(obj(account.proxy).account)]
  const receiverOk = receiverMatches(receiverNames, shown)
  const reasons: SlipCheckReason[] = []
  if (!amountOk) reasons.push('AMOUNT')
  if (receiverOk === false) reasons.push('RECEIVER')
  if (data.isDuplicate === true) reasons.push('DUPLICATE')
  return {
    status: reasons.length ? 'FAIL' : 'PASS',
    ref,
    detail: {
      provider: 'EASYSLIP',
      reasons,
      amount_slip: Number.isFinite(amountSlip) ? amountSlip : undefined,
      amount_ok: amountOk,
      receiver: shown.filter(Boolean).join(' · ').slice(0, 200) || undefined,
      receiver_ok: receiverOk,
      paid_at: str(raw.date).slice(0, 40) || undefined,
    },
  }
}

/** Sends the slip picture to EasySlip; any failure is an ERROR result, never an exception. */
export async function checkSlipWithEasySlip(input: {
  apiKey: string
  bytes: Uint8Array
  type: string
  amount: number
  receiverNames: string[]
  fetchImpl?: typeof fetch
}): Promise<SlipCheckOutcome> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await (input.fetchImpl ?? fetch)(EASYSLIP_VERIFY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base64: `data:${input.type};base64,${Buffer.from(input.bytes).toString('base64')}`,
        matchAmount: input.amount,
        checkDuplicate: true,
      }),
      signal: ctrl.signal,
    })
    const body = await res.json().catch(() => null)
    return evaluateEasySlip(body, res.status, input.amount, input.receiverNames)
  } catch {
    return { status: 'ERROR', ref: null, detail: { provider: 'EASYSLIP', reasons: ['SERVICE'], error: 'NETWORK' } }
  } finally {
    clearTimeout(timer)
  }
}
