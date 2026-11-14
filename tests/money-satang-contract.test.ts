import { describe, expect, it } from 'vitest'

import {
  addSatang,
  subtractSatang,
  multiplySatang,
  calculateLineTotalSatang,
  calculateVatSatang,
} from '@/lib/money'

// Contract: addSatang / subtractSatang take INTEGER SATANG and return integer
// satang, with no float round-trip. NaN / Infinity inputs count as 0.
describe('money satang arithmetic contract', () => {
  it('adds integer satang exactly', () => {
    expect(addSatang(1250, 300, 45)).toBe(1595)
    expect(addSatang()).toBe(0)
    expect(addSatang(-500, 500)).toBe(0)
  })

  it('treats non-finite satang as 0', () => {
    expect(addSatang(100, NaN)).toBe(100)
    expect(addSatang(Infinity, 7)).toBe(7)
    expect(subtractSatang(NaN, NaN)).toBe(0)
  })

  it('subtracts integer satang exactly', () => {
    expect(subtractSatang(1595, 300)).toBe(1295)
    expect(subtractSatang(100, 500)).toBe(-400)
  })

  it('no float drift on values like 0.1 + 0.2 baht', () => {
    // 10 + 20 satang stays exact (the old toBaht/toSatang round-trip would survive this,
    // but 1e-9 epsilon tricks are no longer in the addition path at all).
    expect(addSatang(10, 20)).toBe(30)
  })

  it('multiplySatang rounds to integer satang', () => {
    expect(multiplySatang(12345, 3)).toBe(37035)
    expect(multiplySatang(NaN, 2)).toBe(0)
  })

  it('calculateLineTotalSatang floors quantity at 0 and multiplier at 1', () => {
    expect(calculateLineTotalSatang(2500, 3, 2)).toBe(15000)
    expect(calculateLineTotalSatang(2500, -1)).toBe(0)
    expect(calculateLineTotalSatang(2500, 2, 0)).toBe(5000)
  })

  it('calculateVatSatang exclusive and inclusive', () => {
    expect(calculateVatSatang(10000, 0.07)).toBe(700)
    expect(calculateVatSatang(10000, 0.07, true)).toBe(654) // 10000 * 0.07/1.07, rounded
    expect(calculateVatSatang(0, 0.07)).toBe(0)
    expect(calculateVatSatang(10000, 0)).toBe(0)
  })
})
