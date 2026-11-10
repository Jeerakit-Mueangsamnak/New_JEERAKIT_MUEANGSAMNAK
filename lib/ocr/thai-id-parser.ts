import type { ThaiProvince } from '@/lib/thai-address-data'

/**
 * Turns OCR lines read from the front of a Thai ID card into form values.
 *
 * Rule: a field is filled only when the text proves it; anything unclear stays empty.
 * - ID number: 13 digits that pass the Mod-11 check digit (one distinct number only).
 * - Name / address: the line must be read with enough confidence and carry its label/prefix.
 * - Province / district / sub-district: must exist in the address list and belong together.
 * - Postal code is never filled from the card (it is not printed on it).
 * - Dates must be real calendar dates; the expiry needs both card dates to tell them apart.
 */
export interface OcrLine {
  text: string
  /** 0–100 as reported by the OCR engine. */
  confidence: number
}

export interface ParsedThaiIdCard {
  name: string
  idCardNumber: string
  birthDate: string
  idCardExpiry: string
  houseNo: string
  moo: string
  soi: string
  road: string
  subDistrict: string
  district: string
  province: string
}

export type ParsedThaiIdField = keyof ParsedThaiIdCard

export const EMPTY_PARSED_ID_CARD: ParsedThaiIdCard = {
  name: '', idCardNumber: '', birthDate: '', idCardExpiry: '', houseNo: '', moo: '', soi: '', road: '',
  subDistrict: '', district: '', province: '',
}

/** Below this the engine itself is unsure of the line: leave its fields empty. */
export const MIN_TEXT_CONFIDENCE = 70

/**
 * Validates 13-digit Thai National Identification Number using Mod 11 Checksum.
 */
export function validateThaiNationalId(id: string): boolean {
  const digits = id.replace(/\D/g, '')
  if (digits.length !== 13) return false
  if (/^(\d)\1{12}$/.test(digits)) return false

  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i], 10) * (13 - i)
  }
  const checkDigit = (11 - (sum % 11)) % 10
  return checkDigit === parseInt(digits[12], 10)
}

/**
 * Format 13-digit Thai National ID to standard format 1-2345-67890-12-3
 */
export function formatThaiNationalId(id: string): string {
  const digits = id.replace(/\D/g, '').slice(0, 13)
  if (digits.length <= 1) return digits
  if (digits.length <= 5) return `${digits.slice(0, 1)}-${digits.slice(1)}`
  if (digits.length <= 10) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5)}`
  if (digits.length <= 12) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10)}`
  return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12, 13)}`
}

/** One distinct 13-digit number with a valid check digit, else ''. */
export function extractIdCardNumber(text: string): string {
  const found = new Set<string>()
  // Groups as printed (1 4 5 2 1) with spaces / dashes, or 13 digits in a row.
  for (const m of text.matchAll(/(?<!\d)(\d)[\s-]*(\d{4})[\s-]*(\d{5})[\s-]*(\d{2})[\s-]*(\d)(?!\d)/g)) {
    const digits = m.slice(1, 6).join('')
    if (validateThaiNationalId(digits)) found.add(digits)
  }
  return found.size === 1 ? formatThaiNationalId([...found][0]) : ''
}

const THAI_MONTHS: Record<string, number> = {
  'ม.ค.': 1, 'มกราคม': 1, 'ก.พ.': 2, 'กุมภาพันธ์': 2, 'มี.ค.': 3, 'มีนาคม': 3, 'เม.ย.': 4, 'เมษายน': 4,
  'พ.ค.': 5, 'พฤษภาคม': 5, 'มิ.ย.': 6, 'มิถุนายน': 6, 'ก.ค.': 7, 'กรกฎาคม': 7, 'ส.ค.': 8, 'สิงหาคม': 8,
  'ก.ย.': 9, 'กันยายน': 9, 'ต.ค.': 10, 'ตุลาคม': 10, 'พ.ย.': 11, 'พฤศจิกายน': 11, 'ธ.ค.': 12, 'ธันวาคม': 12,
}
const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}
const escape = (s: string) => s.replace(/[.]/g, '\\.')
const THAI_DATE = new RegExp(`(\\d{1,2})\\s*(${Object.keys(THAI_MONTHS).map(escape).join('|')})\\s*(25\\d{2})`, 'g')
const EN_DATE = new RegExp(`(\\d{1,2})\\s*(${Object.keys(EN_MONTHS).join('|')})\\.?\\s*((?:19|20)\\d{2})`, 'gi')

function isoDate(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Every real date in a line (Thai Buddhist-era or English), as YYYY-MM-DD. */
export function datesInText(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(THAI_DATE)) {
    const iso = isoDate(Number(m[3]) - 543, THAI_MONTHS[m[2]], Number(m[1]))
    if (iso) out.push(iso)
  }
  for (const m of text.matchAll(EN_DATE)) {
    const iso = isoDate(Number(m[3]), EN_MONTHS[m[2].toLowerCase()], Number(m[1]))
    if (iso) out.push(iso)
  }
  return out
}
const NAME_PREFIX = '(?:นางสาว|นาย|นาง|เด็กชาย|เด็กหญิง|ด\\.ช\\.|ด\\.ญ\\.|น\\.ส\\.)'
const NAME_PATTERN = new RegExp(`(${NAME_PREFIX})\\s*([ก-ฮ][ก-๙]+)\\s+([ก-ฮ][ก-๙]+)\\s*$`)

function extractName(lines: OcrLine[]): string {
  for (const line of lines) {
    if (line.confidence < MIN_TEXT_CONFIDENCE) continue
    const text = line.text.replace(/\s+/g, ' ').trim()
    // The label is "ชื่อตัวและชื่อสกุล"; read what follows it on the same line.
    const labelled = text.match(/ชื่อตัว.*?สกุล\s*(.*)$/)
    const candidate = labelled ? labelled[1] : text
    const m = candidate.match(NAME_PATTERN)
    if (m && (labelled || m.index === 0)) return `${m[1]} ${m[2]} ${m[3]}`
  }
  return ''
}

const ADDRESS_STOP = /วันออกบัตร|หมดอายุ|Date of|เจ้าพนักงาน/i

function addressText(lines: OcrLine[]): string {
  const start = lines.findIndex((l) => /^\s*ที่อยู่/.test(l.text))
  if (start < 0) return ''
  const parts: string[] = []
  for (let i = start; i < lines.length && parts.length < 3; i++) {
    const line = lines[i]
    if (i > start && (ADDRESS_STOP.test(line.text) || datesInText(line.text).length > 0)) break
    // Lines with no Thai letter (the height ruler beside the photo: "150", "_ 150") sit between
    // the address lines; they are not part of the address.
    if (i > start && !/[ก-ฮ]/.test(line.text)) continue
    // One unsure line makes the whole address unsure: do not guess from it.
    if (line.confidence < MIN_TEXT_CONFIDENCE) return ''
    parts.push(line.text)
  }
  return parts.join(' ').replace(/^\s*ที่อยู่\s*/, '').replace(/\s+/g, ' ').trim()
}

function afterPrefix(text: string, prefixes: string): string {
  const m = text.match(new RegExp(`(?:^|\\s)(?:${prefixes})\\s*([ก-๙0-9]+)`))
  return m ? m[1] : ''
}

function extractAddress(text: string, addressData: ThaiProvince[]) {
  const result = { houseNo: '', moo: '', soi: '', road: '', subDistrict: '', district: '', province: '' }
  if (!text) return result

  const house = text.match(/^(\d{1,5}(?:\/\d{1,4})?)(?=\s|$)/)
  if (house) result.houseNo = house[1]
  const moo = text.match(/(?:หมู่ที่|หมู่|ม\.)\s*(\d{1,3})(?=\s|$)/)
  if (moo) result.moo = moo[1]
  const soi = text.match(/(?:ซอย|ซ\.)\s*([ก-๙0-9/]+(?:\s\d+)?)/)
  if (soi) result.soi = soi[1]
  const road = text.match(/(?:ถนน|ถ\.)\s*([ก-๙0-9]+)/)
  if (road) result.road = road[1]

  const provinceName = text.includes('กรุงเทพมหานคร') ? 'กรุงเทพมหานคร' : afterPrefix(text, 'จังหวัด|จ\\.')
  const province = addressData.find((p) => p.name === provinceName)
  if (!province) return result // cannot check district / sub-district without a known province
  result.province = province.name

  const district = province.districts.find((d) => d.name === afterPrefix(text, 'อำเภอ|อ\\.|เขต'))
  if (!district) return result
  result.district = district.name

  const sub = district.subDistricts.find((s) => s.name === afterPrefix(text, 'ตำบล|ต\\.|แขวง'))
  if (sub) result.subDistrict = sub.name
  return result
}

function extractDates(lines: OcrLine[]) {
  const birthDates = new Set<string>()
  let birthLines = 0
  const cardDates = new Set<string>()
  for (const line of lines) {
    if (/เกิด|Birth/i.test(line.text)) {
      // Thai and English birth lines must agree; a line that does not read as one date counts as a disagreement.
      birthLines++
      const dates = datesInText(line.text)
      birthDates.add(dates.length === 1 ? dates[0] : 'unreadable')
    } else {
      datesInText(line.text).forEach((d) => cardDates.add(d))
    }
  }
  const today = new Date().toISOString().slice(0, 10)
  let birthDate = birthLines > 0 && birthDates.size === 1 ? [...birthDates][0] : ''
  if (birthDate === 'unreadable' || birthDate >= today) birthDate = ''
  // Issue and expiry dates are printed side by side; only with exactly both read is the later one the expiry.
  const sorted = [...cardDates].sort()
  const idCardExpiry = sorted.length === 2 ? sorted[1] : ''
  return { birthDate, idCardExpiry }
}

export function parseThaiIdCardLines(lines: OcrLine[], addressData: ThaiProvince[]): ParsedThaiIdCard {
  const clean = lines
    .map((l) => ({ text: l.text.replace(/[|—_~`•*]/g, ' ').replace(/\s+/g, ' ').trim(), confidence: l.confidence }))
    .filter((l) => l.text)
  return {
    ...EMPTY_PARSED_ID_CARD,
    idCardNumber: extractIdCardNumber(clean.map((l) => l.text).join('\n')),
    name: extractName(clean),
    ...extractDates(clean),
    ...extractAddress(addressText(clean), addressData),
  }
}
