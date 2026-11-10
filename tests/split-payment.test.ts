import { describe, expect, it } from 'vitest'
import { allocateTenders, computeSplit } from '@/features/pos/services/split-payment'
import { crc16, promptPayPayload } from '@/lib/promptpay'

// เงินสด + QR Code in one payment (owner 2026-11-05): the first method pressed is taken first.
describe('computeSplit', () => {
  it('owner example: due 1,000, cash 500 first → QR Code takes the other 500', () => {
    const r = computeSplit({ due: 1000, split: { method: 'CASH', amount: 500 }, method: 'QR', cashInput: '' })
    expect(r.restDue).toBe(500)
    expect(r.tenders).toEqual([{ method: 'CASH', amount: 500 }, { method: 'QR', amount: 500 }])
    expect(r.remaining).toBe(0)
  })

  it('QR Code first for 300, then cash 1,000 for the 700 left → change 300', () => {
    const r = computeSplit({ due: 1000, split: { method: 'QR', amount: 300 }, method: 'CASH', cashInput: '1000' })
    expect(r.tenders).toEqual([{ method: 'QR', amount: 300 }, { method: 'CASH', amount: 700 }])
    expect(r.change).toBe(300)
    expect(r.remaining).toBe(0)
  })

  it('one method only: empty cash box = exact amount; cash above = change, never recorded', () => {
    expect(computeSplit({ due: 250, split: null, method: 'CASH', cashInput: '' }).tenders).toEqual([{ method: 'CASH', amount: 250 }])
    const r = computeSplit({ due: 250, split: null, method: 'CASH', cashInput: '300' })
    expect(r.tenders).toEqual([{ method: 'CASH', amount: 250 }])
    expect(r.change).toBe(50)
  })

  it('cash below what is due leaves the rest owed; ค้างชำระ takes nothing', () => {
    const r = computeSplit({ due: 1000, split: null, method: 'CASH', cashInput: '400' })
    expect(r.collected).toBe(400)
    expect(r.remaining).toBe(600)
    expect(computeSplit({ due: 1000, split: { method: 'CASH', amount: 500 }, method: 'UNPAID', cashInput: '' }).tenders).toEqual([])
  })

  it('cash first and cash again for the rest is one cash payment', () => {
    const r = computeSplit({ due: 1000, split: { method: 'CASH', amount: 500 }, method: 'CASH', cashInput: '' })
    expect(r.tenders).toEqual([{ method: 'CASH', amount: 1000 }])
  })
})

describe('allocateTenders', () => {
  it('old bill first, the rest on the new เช่าต่อ bill, keeping the order of the methods', () => {
    const [first, rest] = allocateTenders([{ method: 'CASH', amount: 500 }, { method: 'QR', amount: 500 }], 700)
    expect(first).toEqual([{ method: 'CASH', amount: 500 }, { method: 'QR', amount: 200 }])
    expect(rest).toEqual([{ method: 'QR', amount: 300 }])
  })
  it('the bill total first, the deposit after (deposit is kept on the bill, not as a payment)', () => {
    const [bill] = allocateTenders([{ method: 'CASH', amount: 1000 }, { method: 'QR', amount: 500 }], 1000)
    expect(bill).toEqual([{ method: 'CASH', amount: 1000 }])
  })
})

describe('PromptPay QR', () => {
  it('CRC-16/CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe('29B1')
  })
  it('mobile number with amount: Thai QR fields and a valid CRC', () => {
    const p = promptPayPayload('081-234-5678', 500)!
    expect(p.startsWith('000201010212')).toBe(true)
    expect(p).toContain('29370016A00000067701011101130066812345678')
    expect(p).toContain('5802TH')
    expect(p).toContain('5303764')
    expect(p).toContain('5406500.00')
    expect(p.slice(-8, -4)).toBe('6304')
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)))
  })
  it('13-digit ID, no amount = static QR; a wrong number gives no QR', () => {
    const p = promptPayPayload('1539900535239')!
    expect(p.startsWith('000201010211')).toBe(true)
    expect(p).toContain('02131539900535239')
    expect(p).not.toContain('5406')
    expect(promptPayPayload('12345')).toBeNull()
  })
})
