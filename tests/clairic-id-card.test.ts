import { describe, expect, it } from 'vitest'
import { THAI_ADDRESS_DATA } from '@/lib/thai-address-data'
import { parseClairicThaiIdCard, type ClairicAnswers } from '@/lib/ocr/clairic-id-card'
import { EMPTY_PARSED_ID_CARD, validateThaiNationalId } from '@/lib/ocr/thai-id-parser'

function withCheckDigit(first12: string) {
  const sum = [...first12].reduce((acc, digit, i) => acc + Number(digit) * (13 - i), 0)
  return first12 + ((11 - (sum % 11)) % 10)
}
const ID = withCheckDigit('110170020345')
const answer = (value: string, confidence = 0.97, p_null = 0.001) => ({ value, confidence, p_null })

const sample = (): ClairicAnswers => ({
  doc_type: answer('thai_id_card'), id_number: answer(ID),
  prefix: answer('นาย'), first_name: answer('ทดสอบ'), last_name: answer('ระบบดี'),
  address: answer('99/1 หมู่ที่ 5 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ'),
  house_no: answer('99/1'), moo: answer('5'),
  sub_district: answer('บางพลีใหญ่'), district: answer('บางพลี'), province: answer('สมุทรปราการ'),
  birth_date: answer('1987-01-12'), expiry_date: answer('2028-05-01'),
})

const parse = (answers: ClairicAnswers) => parseClairicThaiIdCard(answers, THAI_ADDRESS_DATA)

describe('Clairic Thai ID OCR adapter', () => {
  it('maps high-confidence Thai card values to the unchanged POS customer form', () => {
    expect(validateThaiNationalId(ID)).toBe(true)
    expect(parse(sample())).toMatchObject({
      name: 'นาย ทดสอบ ระบบดี', idCardNumber: ID[0] + '-' + ID.slice(1, 5) + '-' + ID.slice(5, 10) + '-' + ID.slice(10, 12) + '-' + ID[12],
      houseNo: '99/1', moo: '5', subDistrict: 'บางพลีใหญ่', district: 'บางพลี', province: 'สมุทรปราการ',
      birthDate: '1987-01-12', idCardExpiry: '2028-05-01',
    })
  })
  it('rejects unrelated images instead of filling personal data', () => {
    expect(parse({ ...sample(), doc_type: answer('other') })).toEqual(EMPTY_PARSED_ID_CARD)
  })
  it('keeps a suspicious ID number blank', () => {
    const wrong = ID.slice(0, 12) + ((Number(ID[12]) + 1) % 10)
    expect(parse({ ...sample(), id_number: answer(wrong) }).idCardNumber).toBe('')
  })
  it('keeps low-confidence/p-null Thai names blank', () => {
    expect(parse({ ...sample(), first_name: answer('ผิด', 0.62) }).name).toBe('')
    expect(parse({ ...sample(), last_name: answer('ผิด', 0.97, 0.8) }).name).toBe('')
  })
  it('does not accept unknown province or an unlinked district', () => {
    const r = parse({ ...sample(), address: answer(''), province: answer('ไม่พบจังหวัด'), district: answer('บางพลี'), sub_district: answer('บางพลีใหญ่') })
    expect([r.province, r.district, r.subDistrict]).toEqual(['', '', ''])
  })
  it('can recover address from structured fields when full address is unreadable', () => {
    const r = parse({ ...sample(), address: answer('', 0) })
    expect([r.houseNo, r.moo, r.province, r.district, r.subDistrict]).toEqual(['99/1', '5', 'สมุทรปราการ', 'บางพลี', 'บางพลีใหญ่'])
  })
  it('does not accept an invalid date or a fabricated English name in Thai name fields', () => {
    const r = parse({ ...sample(), birth_date: answer('1987-02-30'), first_name: answer('TEST') })
    expect([r.birthDate, r.name]).toEqual(['', ''])
  })
})
