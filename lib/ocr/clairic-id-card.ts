import type { ThaiProvince } from '@/lib/thai-address-data'
import {
  EMPTY_PARSED_ID_CARD,
  formatThaiNationalId,
  parseThaiIdCardLines,
  validateThaiNationalId,
  type ParsedThaiIdCard,
} from '@/lib/ocr/thai-id-parser'

/** The Cloudflare model returns confidence in [0, 1], not Tesseract's 0–100. */
export type ClairicAnswer = { value?: unknown; confidence?: unknown; p_null?: unknown }
export type ClairicAnswers = Record<string, ClairicAnswer | undefined>

const MIN_CONFIDENCE = 0.85
const MAX_NULL_PROBABILITY = 0.2
const PREFIXES = new Set(['นาย', 'นาง', 'นางสาว', 'เด็กชาย', 'เด็กหญิง', 'ด.ช.', 'ด.ญ.', 'น.ส.'])

function textValue(answers: ClairicAnswers, key: string, maxLength = 200): string {
  const answer = answers[key]
  if (!answer || typeof answer.value !== 'string') return ''
  const confidence = typeof answer.confidence === 'number' ? answer.confidence : NaN
  const pNull = typeof answer.p_null === 'number' ? answer.p_null : 1
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE || pNull > MAX_NULL_PROBABILITY) return ''
  return answer.value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function matchName(input: string): string {
  return /^[ก-ฮะ-์]+$/.test(input) ? input : ''
}

function stripPrefix(input: string, prefix: RegExp): string {
  return input.replace(prefix, '').trim()
}

function maybeDate(text: string): string {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const year = Number(m[1]) >= 2400 ? Number(m[1]) - 543 : Number(m[1])
  const month = Number(m[2]); const day = Number(m[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return year >= 1800 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? year + '-' + m[2] + '-' + m[3] : ''
}

/**
 * Convert untrusted AI extraction to the exact existing customer-form fields.
 * AI confidence is advisory, never proof: validate ID checksum, Thai names and the
 * linked province/district/sub-district before putting a value into the form.
 * Empty/uncertain values remain blank for the owner to review and enter manually.
 */
export function parseClairicThaiIdCard(answers: ClairicAnswers, addressData: ThaiProvince[]): ParsedThaiIdCard {
  const data: ParsedThaiIdCard = { ...EMPTY_PARSED_ID_CARD }
  if (textValue(answers, 'doc_type') === 'other') return data

  const idNumber = textValue(answers, 'id_number', 32).replace(/\D/g, '')
  if (validateThaiNationalId(idNumber)) data.idCardNumber = formatThaiNationalId(idNumber)

  const prefix = textValue(answers, 'prefix', 20)
  const first = matchName(textValue(answers, 'first_name', 75))
  const last = matchName(textValue(answers, 'last_name', 75))
  if (first && last) data.name = [PREFIXES.has(prefix) ? prefix : '', first, last].filter(Boolean).join(' ')

  data.birthDate = maybeDate(textValue(answers, 'birth_date', 15))
  data.idCardExpiry = maybeDate(textValue(answers, 'expiry_date', 15))

  // Reuse the existing trusted Thai-address parser when a full printed address is read.
  // Structured values below fill gaps only, never overriding a validated match.
  const address = textValue(answers, 'address', 400)
  if (address) {
    const parsed = parseThaiIdCardLines([{ text: 'ที่อยู่ ' + address, confidence: 100 }], addressData)
    for (const k of ['houseNo', 'moo', 'soi', 'road', 'province', 'district', 'subDistrict'] as const) {
      data[k] = parsed[k]
    }
  }

  const house = textValue(answers, 'house_no', 30)
  if (!data.houseNo && /^\d{1,5}(?:\/\d{1,4})?$/.test(house)) data.houseNo = house
  const moo = textValue(answers, 'moo', 10).replace(/^หมู่(?:ที่)?\s*/, '')
  if (!data.moo && /^\d{1,3}$/.test(moo)) data.moo = moo
  const soi = stripPrefix(textValue(answers, 'soi', 80), /^(?:ซอย|ซ\.)\s*/)
  if (!data.soi && /^[ก-๙0-9\s/.-]{1,70}$/.test(soi)) data.soi = soi
  const road = stripPrefix(textValue(answers, 'road', 80), /^(?:ถนน|ถ\.)\s*/)
  if (!data.road && /^[ก-๙0-9\s/.-]{1,70}$/.test(road)) data.road = road

  const provinceName = stripPrefix(textValue(answers, 'province', 90), /^(?:จังหวัด|จ\.)\s*/)
  const districtName = stripPrefix(textValue(answers, 'district', 90), /^(?:อำเภอ|อ\.|เขต)\s*/)
  const subName = stripPrefix(textValue(answers, 'sub_district', 90), /^(?:ตำบล|ต\.|แขวง)\s*/)
  const province = addressData.find((p) => p.name === provinceName)
  const district = province?.districts.find((d) => d.name === districtName)
  const subDistrict = district?.subDistricts.find((s) => s.name === subName)
  if (!data.province && province) data.province = province.name
  if (!data.district && district && data.province === province?.name) data.district = district.name
  if (!data.subDistrict && subDistrict && data.district === district?.name) data.subDistrict = subDistrict.name
  return data
}
