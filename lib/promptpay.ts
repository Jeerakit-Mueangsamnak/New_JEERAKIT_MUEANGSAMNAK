import { formatPhoneNumber } from '@/lib/utils/format'
import { formatThaiNationalId } from '@/lib/ocr/thai-id-parser'

/**
 * Thai PromptPay QR payload (EMVCo "Thai QR Payment"). The shop's PromptPay number comes from
 * ตั้งค่าระบบ › ข้อมูลร้าน; the amount is written into the QR so the customer's app fills it in.
 *   mobile 10 digits (0xxxxxxxxx) → tag 01, "0066" + the number without its leading 0
 *   ID / tax ID 13 digits        → tag 02
 *   e-wallet 15 digits           → tag 03
 */
const PROMPTPAY_AID = 'A000000677010111'

/** Kinds of PromptPay number the shop can give (ตั้งค่า › การชำระเงิน) and how many digits each has. */
export const PROMPTPAY_TYPES = [
  { value: 'PHONE', label: 'เบอร์โทรศัพท์', digits: 10 },
  { value: 'ID_CARD', label: 'เลขบัตรประชาชน', digits: 13 },
  { value: 'TAX_ID', label: 'เลขผู้เสียภาษี', digits: 13 },
] as const

/** Digits a PromptPay number of this kind has (13 when the kind is not set). */
export function promptPayDigits(type: string | null | undefined): number {
  return PROMPTPAY_TYPES.find((t) => t.value === type)?.digits ?? 13
}

/**
 * A PromptPay number with dashes, as people write it (owner 2026-11-11): phone 081-234-5678,
 * ID card / tax ID 1-2345-67890-12-3. Only the digits are stored and put in the QR.
 */
export function formatPromptPayNumber(value: string | null | undefined, type?: string | null): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, type ? promptPayDigits(type) : 15)
  const phone = type === 'PHONE' || (!type && digits.length === 10 && digits.startsWith('0'))
  if (phone) return formatPhoneNumber(digits)
  if (digits.length > 13) return digits
  return formatThaiNationalId(digits)
}

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as the Thai QR standard requires. */
export function crc16(text: string): string {
  let crc = 0xffff
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** null when the PromptPay number is not 10, 13 or 15 digits. */
export function promptPayPayload(promptPayId: string, amount?: number): string | null {
  const digits = (promptPayId || '').replace(/\D/g, '')
  let target: string
  if (digits.length === 10 && digits.startsWith('0')) target = field('01', `0066${digits.slice(1)}`)
  else if (digits.length === 13) target = field('02', digits)
  else if (digits.length === 15) target = field('03', digits)
  else return null

  const hasAmount = typeof amount === 'number' && isFinite(amount) && amount > 0
  const body =
    field('00', '01') +
    field('01', hasAmount ? '12' : '11') +
    field('29', field('00', PROMPTPAY_AID) + target) +
    field('58', 'TH') +
    field('53', '764') +
    (hasAmount ? field('54', (Math.round(amount * 100) / 100).toFixed(2)) : '') +
    '6304'
  return body + crc16(body)
}
