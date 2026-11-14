import { describe, expect, it } from 'vitest'

import { crc16, promptPayPayload } from '@/lib/promptpay'

/** Fields every PromptPay QR starts with; `pointOfInitiation` 11 = no amount (static), 12 = amount in the QR. */
const head = (pointOfInitiation: '11' | '12', merchant: string) =>
  '000201' + `0102${pointOfInitiation}` + `29${String(20 + merchant.length).padStart(2, '0')}` + '0016A000000677010111' + merchant

/** The whole payload a body must give: body + its CRC. */
const withCrc = (body: string) => body + crc16(body)

describe('promptpay QR payload', () => {
  it('crc16 matches the CRC-16/CCITT-FALSE standard test vector', () => {
    // "123456789" -> 0x29B1 is the canonical CRC-16/CCITT-FALSE check value.
    expect(crc16('123456789')).toBe('29B1')
  })

  it('crc16 pads to 4 uppercase hex digits', () => {
    expect(crc16('a')).toMatch(/^[0-9A-F]{4}$/)
  })

  it('builds a mobile payload with amount, ending in a valid CRC', () => {
    // tag 01 mobile: 0066 + the number without its leading 0
    const body = head('12', '01130066812345678') + '5802TH' + '5303764' + '5406100.00' + '6304'
    expect(promptPayPayload('0812345678', 100)).toBe(withCrc(body))
  })

  it('mobile payload has no amount field when none is given', () => {
    // Whole payload pinned: no tag 54 between the currency and the CRC tag.
    const body = head('11', '01130066812345678') + '5802TH' + '5303764' + '6304'
    expect(promptPayPayload('0812345678')).toBe(withCrc(body))
  })

  it('a zero or negative amount is left out, as when none is given', () => {
    const noAmount = promptPayPayload('0812345678')
    expect(promptPayPayload('0812345678', 0)).toBe(noAmount)
    expect(promptPayPayload('0812345678', -5)).toBe(noAmount)
  })

  it('writes the amount with two decimals', () => {
    const body = head('12', '01130066812345678') + '5802TH' + '5303764' + '54071234.50' + '6304'
    expect(promptPayPayload('0812345678', 1234.5)).toBe(withCrc(body))
  })

  it('uses tag 02 for a 13-digit ID card', () => {
    const body = head('12', '02131234567890123') + '5802TH' + '5303764' + '540550.00' + '6304'
    expect(promptPayPayload('1234567890123', 50)).toBe(withCrc(body))
  })

  it('uses tag 03 for a 15-digit e-wallet number', () => {
    const body = head('11', '0315123456789012345') + '5802TH' + '5303764' + '6304'
    expect(promptPayPayload('123456789012345')).toBe(withCrc(body))
  })

  it('reads only the digits of a number written with dashes', () => {
    expect(promptPayPayload('081-234-5678', 100)).toBe(promptPayPayload('0812345678', 100))
  })

  it('returns null for a number that is not a 0-led 10-digit mobile, 13 or 15 digits', () => {
    for (const bad of ['', '123', 'abc', '1234567890', '12345678901', '123456789012', '12345678901234', '1234567890123456']) {
      expect(promptPayPayload(bad)).toBeNull()
    }
  })

  it('matches a pinned Thai QR sample payload', () => {
    // Full payload pinned for mobile 0012345678 at 1.00 THB, CRC included — catches any
    // field-order, length-prefix or checksum regression at once.
    const body =
      '00020101021229370016A000000677010111' +
      '01130066012345678' +
      '5802TH' +
      '5303764' +
      '54041.00' +
      '6304'
    expect(promptPayPayload('0012345678', 1)).toBe(withCrc(body))
  })
})
