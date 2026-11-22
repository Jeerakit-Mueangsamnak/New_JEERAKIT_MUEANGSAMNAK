import { describe, expect, it } from 'vitest'
import { extractAddress } from '@/lib/ocr/thai-id-parser'
import { THAI_ADDRESS_DATA } from '@/lib/thai-address-data'

describe('extractAddress: แยกที่อยู่ภาษาไทยจากข้อความ OCR', () => {
  it('แยกที่อยู่ปกติที่มีเว้นวรรค ต. อ. จ. ได้ถูกต้อง', () => {
    const res = extractAddress('99/1 หมู่ที่ 5 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ', THAI_ADDRESS_DATA)
    expect(res).toEqual({
      houseNo: '99/1',
      moo: '5',
      soi: '',
      road: '',
      subDistrict: 'บางพลีใหญ่',
      district: 'บางพลี',
      province: 'สมุทรปราการ',
    })
  })

  it('แยกที่อยู่ที่พิมพ์ติดกันเป็นพืด ไม่มีเว้นวรรค (ต. อ. จ. ติดกัน) ได้ถูกต้อง', () => {
    const res = extractAddress('99/1 หมู่ที่ 5ต.บางพลีใหญ่อ.บางพลีจ.สมุทรปราการ', THAI_ADDRESS_DATA)
    expect(res.province).toBe('สมุทรปราการ')
    expect(res.district).toBe('บางพลี')
    expect(res.subDistrict).toBe('บางพลีใหญ่')
    expect(res.houseNo).toBe('99/1')
    expect(res.moo).toBe('5')
  })

  it('แก้ปัญหา อ.เมือง -> แปลงเป็น เมือง + ชื่อจังหวัด ได้ถูกต้อง', () => {
    const res = extractAddress('7/1 ม.1 ต.สวนใหญ่ อ.เมือง จ.นนทบุรี', THAI_ADDRESS_DATA)
    expect(res.province).toBe('นนทบุรี')
    expect(res.district).toBe('เมืองนนทบุรี')
    expect(res.subDistrict).toBe('สวนใหญ่')
    expect(res.houseNo).toBe('7/1')
    expect(res.moo).toBe('1')
  })

  it('แยกที่อยู่ที่ไม่มีคำนำหน้า ต. อ. จ. (Fallback ค้นหาชื่อตรงๆ) ได้ถูกต้อง', () => {
    const res = extractAddress('12 หมู่ 3 บางพลีใหญ่ บางพลี สมุทรปราการ', THAI_ADDRESS_DATA)
    expect(res.province).toBe('สมุทรปราการ')
    expect(res.district).toBe('บางพลี')
    expect(res.subDistrict).toBe('บางพลีใหญ่')
    expect(res.houseNo).toBe('12')
    expect(res.moo).toBe('3')
  })

  it('แยกที่อยู่ในกรุงเทพมหานคร (แขวง / เขต) ได้ถูกต้อง', () => {
    const res = extractAddress('55/2 ซอยสุขุมวิท 101 แขวงหนองบอน เขตประเวศ กรุงเทพมหานคร', THAI_ADDRESS_DATA)
    expect(res.province).toBe('กรุงเทพมหานคร')
    expect(res.district).toBe('ประเวศ')
    expect(res.subDistrict).toBe('หนองบอน')
    expect(res.houseNo).toBe('55/2')
    expect(res.soi).toBe('สุขุมวิท 101')
  })
})

describe('Name deduplication: ตัดคำนำหน้าซ้ำและชื่อซ้ำ', () => {
  function deduplicateName(f: { prefix?: string | null; first_name?: string | null; last_name?: string | null }) {
    let prefix = (f.prefix || '').trim()
    let firstName = (f.first_name || '').trim()
    let lastName = (f.last_name || '').trim()

    const allPrefixes = ['ว่าที่ร้อยตรี', 'นางสาว', 'เด็กหญิง', 'เด็กชาย', 'น.ส.', 'ด.ญ.', 'ด.ช.', 'นาย', 'นาง']
    if (prefix && firstName.startsWith(prefix)) {
      firstName = firstName.slice(prefix.length).trim()
    } else {
      for (const p of allPrefixes) {
        if (firstName.startsWith(p)) {
          if (!prefix) prefix = p
          firstName = firstName.slice(p.length).trim()
          break
        }
      }
    }

    if (allPrefixes.includes(lastName) || lastName === prefix) {
      lastName = ''
    }

    if (firstName === lastName) {
      lastName = ''
    }

    for (const p of allPrefixes) {
      if (lastName.startsWith(p)) {
        lastName = lastName.slice(p.length).trim()
        break
      }
    }

    return [prefix, firstName, lastName]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  it('ตัดชื่อซ้ำเมื่อ first_name ตรงกับ last_name (นาย ก.ไก่ ก.ไก่ -> นาย ก.ไก่)', () => {
    expect(deduplicateName({ prefix: 'นาย', first_name: 'ก.ไก่', last_name: 'ก.ไก่' })).toBe('นาย ก.ไก่')
  })

  it('ตัดคำนำหน้าซ้ำเมื่อ prefix อยู่ใน last_name (นายก.ไก่ นาย -> นาย ก.ไก่)', () => {
    expect(deduplicateName({ prefix: null, first_name: 'นายก.ไก่', last_name: 'นาย' })).toBe('นาย ก.ไก่')
  })

  it('ตัดคำนำหน้าซ้ำเมื่อ prefix อยู่ใน first_name (นาย + นาย ก.ไก่ -> นาย ก.ไก่)', () => {
    expect(deduplicateName({ prefix: 'นาย', first_name: 'นาย ก.ไก่', last_name: 'ใจดี' })).toBe('นาย ก.ไก่ ใจดี')
  })

  it('ชื่อและนามสกุลปกติคงเดิม', () => {
    expect(deduplicateName({ prefix: 'นาย', first_name: 'สมชาย', last_name: 'ใจดี' })).toBe('นาย สมชาย ใจดี')
  })
})
