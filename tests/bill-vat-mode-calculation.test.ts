import { describe, expect, it } from 'vitest'
import { calculateBillTotals } from '@/lib/calculation-service'
import { DEFAULT_SYSTEM_CONFIG, isVatRateConfigured, type SystemConfig } from '@/features/settings/services/settings-storage'

// Shop settings: only the VAT RATE matters for the POS buttons; the stored price mode is just the old fallback.
const shop = (vatRate: number | null, vatMode: 'INCLUSIVE' | 'EXCLUSIVE' | null): SystemConfig => ({
  ...DEFAULT_SYSTEM_CONFIG,
  taxDiscount: { ...DEFAULT_SYSTEM_CONFIG.taxDiscount, vatRate, vatMode },
})
const items = [{ lineTotal: 1000 }]

describe('VAT mode chosen per bill (รวม VAT / ไม่รวม VAT)', () => {
  it('ไม่รวม VAT adds VAT on top, whatever the shop mode is', () => {
    const t = calculateBillTotals({ settings: shop(7, 'INCLUSIVE'), items, enableVat: true, vatMode: 'EXCLUSIVE' })
    expect(t.vatAmount).toBe(70)
    expect(t.grandTotal).toBe(1070)
  })

  it('รวม VAT keeps the total and takes VAT out of it, whatever the shop mode is', () => {
    const t = calculateBillTotals({ settings: shop(7, 'EXCLUSIVE'), items, enableVat: true, vatMode: 'INCLUSIVE' })
    expect(t.vatAmount).toBe(65.42)
    expect(t.grandTotal).toBe(1000)
    expect(t.subtotalWithoutTax).toBe(934.58)
  })

  it('the deposit is added to the amount to pay in both modes, and VAT never covers it', () => {
    const excl = calculateBillTotals({ settings: shop(7, null), items, enableVat: true, vatMode: 'EXCLUSIVE', depositAmount: 500 })
    const incl = calculateBillTotals({ settings: shop(7, null), items, enableVat: true, vatMode: 'INCLUSIVE', depositAmount: 500 })
    expect(excl.totalPayableWithDeposit).toBe(1570)
    expect(incl.totalPayableWithDeposit).toBe(1500)
    expect(excl.vatAmount).toBe(70)
  })

  it('only the shop rate is needed when the bill chose a mode (the stored mode may be empty)', () => {
    expect(isVatRateConfigured(shop(7, null))).toBe(true)
    expect(isVatRateConfigured(shop(null, null))).toBe(false)
    expect(isVatRateConfigured(shop(0, 'EXCLUSIVE'))).toBe(false)
    expect(calculateBillTotals({ settings: shop(7, null), items, enableVat: true, vatMode: 'EXCLUSIVE' }).vatAmount).toBe(70)
  })

  it('no rate in Settings = no VAT even when a mode is given (no hard-coded rate)', () => {
    const t = calculateBillTotals({ settings: shop(null, null), items, enableVat: true, vatMode: 'EXCLUSIVE' })
    expect(t.vatAmount).toBe(0)
    expect(t.grandTotal).toBe(1000)
  })

  it('VAT off = no VAT; no mode given = the old shop mode (documents saved before the buttons)', () => {
    expect(calculateBillTotals({ settings: shop(7, 'EXCLUSIVE'), items, enableVat: false, vatMode: 'EXCLUSIVE' }).vatAmount).toBe(0)
    expect(calculateBillTotals({ settings: shop(7, 'EXCLUSIVE'), items, enableVat: true }).vatAmount).toBe(70)
    expect(calculateBillTotals({ settings: shop(7, 'INCLUSIVE'), items, enableVat: true }).grandTotal).toBe(1000)
  })
})
