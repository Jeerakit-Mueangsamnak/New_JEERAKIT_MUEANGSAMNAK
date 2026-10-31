import { describe, expect, it } from 'vitest'
import { THAI_ADDRESS_DATA } from '@/lib/thai-address-data'
import { EMPTY_PARSED_ID_CARD, parseThaiIdCardLines, validateThaiNationalId, type OcrLine } from '@/lib/ocr/thai-id-parser'

// A made-up person with a valid check digit (not a real ID).
function withCheckDigit(first12: string) {
  const sum = [...first12].reduce((acc, d, i) => acc + Number(d) * (13 - i), 0)
  return first12 + ((11 - (sum % 11)) % 10)
}
const ID = withCheckDigit('110170020345')
const ID_SPACED = `${ID[0]} ${ID.slice(1, 5)} ${ID.slice(5, 10)} ${ID.slice(10, 12)} ${ID[12]}`

const line = (text: string, confidence = 90): OcrLine => ({ text, confidence })
const card = (over: Partial<Record<string, OcrLine>> = {}): OcrLine[] => [
  line('บัตรประจำตัวประชาชน Thai National ID Card'),
  over.id ?? line(`เลขประจำตัวประชาชน ${ID_SPACED}`),
  over.name ?? line('ชื่อตัวและชื่อสกุล นาย ทดสอบ ระบบดี'),
  line('Name Mr. Thodsob'),
  line('Last name Rabobdee'),
  over.birth ?? line('เกิดวันที่ 12 ม.ค. 2530'),
  line('Date of Birth 12 Jan. 1987'),
  line('ศาสนา พุทธ'),
  over.address ?? line('ที่อยู่ 99/1 หมู่ที่ 5 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ'),
  over.dates ?? line('1 ก.พ. 2560 31 ม.ค. 2569'),
  line('วันออกบัตร วันบัตรหมดอายุ'),
]
const parse = (lines: OcrLine[]) => parseThaiIdCardLines(lines, THAI_ADDRESS_DATA)

describe('Thai ID card OCR parser: fills only what it can prove', () => {
  it('reads a clear card: name, ID, birth date, expiry and the checked address chain', () => {
    expect(validateThaiNationalId(ID)).toBe(true)
    expect(parse(card())).toEqual({
      ...EMPTY_PARSED_ID_CARD,
      name: 'นาย ทดสอบ ระบบดี',
      idCardNumber: `${ID[0]}-${ID.slice(1, 5)}-${ID.slice(5, 10)}-${ID.slice(10, 12)}-${ID[12]}`,
      birthDate: '1987-01-12',
      idCardExpiry: '2026-01-31',
      houseNo: '99/1',
      moo: '5',
      subDistrict: 'บางพลีใหญ่',
      district: 'บางพลี',
      province: 'สมุทรปราการ',
    })
  })

  it('never fills a postal code (it is not printed on the card)', () => {
    expect(parse(card())).not.toHaveProperty('postalCode')
  })

  it('an ID number with a wrong check digit (one digit misread) stays empty', () => {
    const wrong = ID.slice(0, 12) + ((Number(ID[12]) + 1) % 10)
    expect(parse(card({ id: line(`เลขประจำตัวประชาชน ${wrong}`) })).idCardNumber).toBe('')
  })

  it('two different valid numbers on the card: cannot tell which, stays empty', () => {
    const other = withCheckDigit('310170020345')
    expect(parse(card({ id: line(`${ID} ${other}`) })).idCardNumber).toBe('')
  })

  it('a name line read with low confidence stays empty', () => {
    expect(parse(card({ name: line('ชื่อตัวและชื่อสกุล นาย ทดสอบ ระบบดี', 45) })).name).toBe('')
  })

  it('garbled name text (no title, Latin noise) stays empty', () => {
    expect(parse(card({ name: line('ชื่อตัวและชื่อสกุล ~~ Tn0s ระบ') })).name).toBe('')
  })

  it('a blurred address line (low confidence) leaves every address field empty', () => {
    const r = parse(card({ address: line('ที่อยู่ 99/1 หมู่ที่ 5 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ', 40) }))
    expect([r.houseNo, r.moo, r.subDistrict, r.district, r.province]).toEqual(['', '', '', '', ''])
  })

  it('a province that does not exist: province, district and sub-district all stay empty', () => {
    const r = parse(card({ address: line('ที่อยู่ 99/1 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปรากร') }))
    expect([r.province, r.district, r.subDistrict]).toEqual(['', '', ''])
    expect(r.houseNo).toBe('99/1')
  })

  it('a district that is not in that province: district and sub-district stay empty', () => {
    const r = parse(card({ address: line('ที่อยู่ 10 ต.บางพลีใหญ่ อ.บางนา จ.สมุทรปราการ') }))
    expect([r.province, r.district, r.subDistrict]).toEqual(['สมุทรปราการ', '', ''])
  })

  it('district / sub-district names without their ต. / อ. prefix are not guessed', () => {
    const r = parse(card({ address: line('ที่อยู่ 10 บางพลีใหญ่ บางพลี จ.สมุทรปราการ') }))
    expect([r.province, r.district, r.subDistrict]).toEqual(['สมุทรปราการ', '', ''])
  })

  it('no ที่อยู่ label: no address at all, even if a province name shows elsewhere', () => {
    const lines = card().filter((l) => !l.text.startsWith('ที่อยู่'))
    lines.push(line('ออกให้ที่ สมุทรปราการ'))
    const r = parse(lines)
    expect([r.houseNo, r.province, r.district, r.subDistrict]).toEqual(['', '', '', ''])
  })

  it('only one card date read: cannot tell issue from expiry, expiry stays empty', () => {
    expect(parse(card({ dates: line('31 ม.ค. 2569') })).idCardExpiry).toBe('')
  })

  it('a date that does not exist (31 ก.พ.) is ignored, even if the English line reads fine', () => {
    expect(parse(card({ birth: line('เกิดวันที่ 31 ก.พ. 2530') })).birthDate).toBe('')
  })

  it('Thai and English birth dates that disagree: birth date stays empty', () => {
    expect(parse(card({ birth: line('เกิดวันที่ 13 ม.ค. 2530') })).birthDate).toBe('')
  })

  it('a blank / unreadable photo gives an all-empty result', () => {
    expect(parse([line('', 0), line('~~ ## ..', 12)])).toEqual(EMPTY_PARSED_ID_CARD)
  })
  // Lines exactly as OCR.space (Engine 2) read the sample card photo on 2026-10-31 (a made-up card).
  // The height ruler beside the photo ("150", "_ 150") comes between the two address lines.
  const OCR_SPACE_SAMPLE = [
    'บัตรประจำตัวประชาชน Thai National ID Card', 'เลขประจำตัวประชาชน', 'Identification Number 1 7101 80115 76 1',
    'ชื่อตัวและชื่สกุล นาย พรพล สังข์สุวรรณ', 'Name Mr. Pornpol', 'Last name Sang-suwan', 'เกิดวันที่ 2 พ.ค. 2533',
    '170', '170', 'Date of Birth 2 May 1990', '160', '160', 'ศาสนา พุทธ',
    'ที่อยู่ 145 หมู่ที่ 1 ต.ลาดหญ้า อ.เมืองกาญจนบุรี', '150', '_ 150', 'จ.กาญจนบุรี', '140', '140',
    '22 ม.ค. 2563', 'วันออกบัตร', '22 Jan. 2020', 'Date of Issue', '(นายธนาคม์ จงจิระ)', 'เจ้าพนักงานออกบัตร',
    '1 พ.ค. 2571', 'วันบัตรหมดอายุ', '1 May 2028', 'Date of Expiry', '7105-08-01221318',
  ].map((text) => line(text, 90))

  it('OCR.space sample card: the ruler numbers between address lines do not cut the address', () => {
    expect(parse(OCR_SPACE_SAMPLE)).toEqual({
      ...EMPTY_PARSED_ID_CARD,
      name: 'นาย พรพล สังข์สุวรรณ',
      // The made-up card number fails the check digit, so it is never filled.
      idCardNumber: '',
      birthDate: '1990-05-02',
      idCardExpiry: '2028-05-01',
      houseNo: '145',
      moo: '1',
      subDistrict: 'ลาดหญ้า',
      district: 'เมืองกาญจนบุรี',
      province: 'กาญจนบุรี',
    })
  })
})
