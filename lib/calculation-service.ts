/**
 * Centralized Calculation Service
 *
 * Single source of truth for financial & bill arithmetic across:
 * - POS Cart & Checkout
 * - Quotations
 * - Bill Revisions & Confirmations
 * - Document Renderers
 *
 * Rules:
 * - VAT is calculated AFTER discount.
 * - Deposit is strictly separated from Revenue.
 * - Money: 2 decimals, half-up (same as the server's round(x, 2)) — not a setting.
 * - VAT ON/OFF is per bill (enableVat); rate and price mode come from Settings (server row).
 *   The server recomputes and snapshots the final total; this is the screen preview.
 * - Discount above the OWNER's limit (when the limit is on) is flagged; no limit otherwise.
 * - Late returns track dates and overdue days, but NEVER charge automatic penalty fees.
 */

import { loadSystemSettings, isVatConfigured, type SystemConfig } from '@/features/settings/services/settings-storage'
import { RentalType } from '@/lib/types/rental-pos'
import {
  toSatang,
  toBaht,
  addSatang,
  subtractSatang,
  multiplySatang,
  calculateLineTotalSatang,
  calculateVatSatang,
  calculateDiscountSatang,
  calculateDepositSettlement,
} from '@/lib/money'

export type RoundingMode = 'ROUND_HALF_UP' | 'ROUND_UP' | 'ROUND_DOWN'

/** The OWNER's discount limit in percent, or null when the limit is off (no limit). */
export function discountLimitPercent(cfg: SystemConfig): number | null {
  const t = cfg.taxDiscount
  const pct = t.discountLimitPercent
  // A limit the OWNER switched on is used only when the stored percent is a real, positive number.
  if (!t.discountLimitEnabled) return null
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0) return null
  return pct
}
export interface LineItemInput {
  quantity: number
  unitPrice: number
  rentalType?: RentalType | string
  usageCount?: number
  billableDays?: number
  dailyStartDate?: string | Date | null
  dailyEndDate?: string | Date | null
}

/**
 * Calculates line total for a single item.
 */
export function calculateLineTotal(item: LineItemInput, settings?: SystemConfig): number {
  const qty = Number(item.quantity) || 0
  const isSale = item.rentalType === 'SALE'

  let multiplier = 1
  if (!isSale) {
    if (item.rentalType === 'DAILY' && item.dailyStartDate && item.dailyEndDate) {
      if (item.billableDays !== undefined) {
        multiplier = Math.max(1, item.billableDays)
      } else {
        const start = new Date(item.dailyStartDate).getTime()
        const end = new Date(item.dailyEndDate).getTime()
        if (!isNaN(start) && !isNaN(end)) {
          const days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)))
          multiplier = days
        } else {
          multiplier = Math.max(1, item.usageCount || 1)
        }
      }
    } else {
      multiplier = Math.max(1, item.billableDays || item.usageCount || 1)
    }
  }

  const priceSatang = toSatang(item.unitPrice)
  const lineSatang = calculateLineTotalSatang(priceSatang, qty, multiplier)
  return toBaht(lineSatang)
}

export interface CalculateTotalsOptions {
  items: Array<{ lineTotal?: number; quantity?: number; unitPrice?: number; rentalType?: any; usageCount?: number; billableDays?: number }>
  discount?: number
  discountAmount?: number
  discountPercent?: number
  shippingFee?: number
  depositAmount?: number
  /** VAT ON/OFF of THIS bill (POS transaction state); off when omitted. */
  enableVat?: boolean
  /** How VAT is priced on THIS bill (POS button รวม / ไม่รวม VAT). When given it replaces the shop's
   *  price mode and only the shop's VAT rate is needed; omitted = the shop's rate + mode as before. */
  vatMode?: 'INCLUSIVE' | 'EXCLUSIVE' | null
  includeShippingInTax?: boolean // defaults to true matching Thai standard
  settings?: SystemConfig
}

export interface BillCalculationResult {
  subtotal: number
  subtotalWithoutTax?: number
  discountAmount: number
  discountPercent: number
  isDiscountExceeded: boolean
  maxDiscountAllowed: number
  netSubtotal: number
  vatRate: number
  vatAmount: number
  shippingFee: number
  revenueTotal: number
  billAmount: number
  depositAmount: number
  grandTotal: number
  totalPayableWithDeposit: number
  precision: number
  roundingMode: RoundingMode
}

/**
 * Calculates complete bill totals according to centralized business rules.
 */
export function calculateBillTotals(options: CalculateTotalsOptions): BillCalculationResult {
  const cfg = options.settings || loadSystemSettings()
  const precision = 2
  const roundingMode: RoundingMode = 'ROUND_HALF_UP'
  const maxDiscountPercent = discountLimitPercent(cfg) ?? 100

  // 1. Subtotal in Satang
  let rawSubtotalSatang = 0
  for (const it of options.items) {
    if (typeof it.lineTotal === 'number') {
      rawSubtotalSatang = addSatang(rawSubtotalSatang, toSatang(it.lineTotal))
    } else {
      rawSubtotalSatang = addSatang(rawSubtotalSatang, toSatang(calculateLineTotal(it as LineItemInput, cfg)))
    }
  }
  const subtotal = toBaht(rawSubtotalSatang)

  // 2. Discount & Ceiling Validation in Satang
  const discountCalc = calculateDiscountSatang(rawSubtotalSatang, {
    discountPercent: options.discountPercent,
    discountAmountSatang: options.discountAmount !== undefined ? toSatang(options.discountAmount) : (options.discount !== undefined ? toSatang(options.discount) : undefined),
    maxDiscountPercent,
  })

  const discountAmount = toBaht(discountCalc.discountSatang)
  const maxDiscountAllowed = toBaht(discountCalc.maxAllowedSatang)
  const isDiscountExceeded = discountCalc.isDiscountExceeded
  const effectiveDiscountPercent = discountCalc.effectivePercent

  // 3. Net Subtotal (after discount) in Satang
  const netSubtotalSatang = Math.max(0, subtractSatang(rawSubtotalSatang, discountCalc.discountSatang))
  const netSubtotal = toBaht(netSubtotalSatang)

  // 4. Shipping Fee in Satang
  const shippingFeeSatang = Math.max(0, toSatang(options.shippingFee))
  const shippingFee = toBaht(shippingFeeSatang)

  // 5. VAT in Satang
  const billVatMode = options.vatMode ?? null
  const vatMode = billVatMode ?? cfg.taxDiscount.vatMode
  let vatRate = 0
  const rateSet = (cfg.taxDiscount.vatRate ?? 0) > 0
  if (options.enableVat === true && (billVatMode ? rateSet : isVatConfigured(cfg))) {
    vatRate = (cfg.taxDiscount.vatRate as number) / 100
  }

  const includeShippingInTax = options.includeShippingInTax !== false
  const taxBaseSatang = includeShippingInTax
    ? addSatang(netSubtotalSatang, shippingFeeSatang)
    : netSubtotalSatang

  const isVatInclusive = vatRate > 0 && vatMode === 'INCLUSIVE'
  const vatAmountSatang = calculateVatSatang(taxBaseSatang, vatRate, isVatInclusive)
  const vatAmount = toBaht(vatAmountSatang)

  // 6. Revenue Total in Satang
  let revenueTotalSatang = 0
  if (isVatInclusive) {
    revenueTotalSatang = addSatang(netSubtotalSatang, shippingFeeSatang)
  } else {
    revenueTotalSatang = addSatang(netSubtotalSatang, shippingFeeSatang, vatAmountSatang)
  }
  const revenueTotal = toBaht(revenueTotalSatang)

  // Inclusive: take out only the VAT that sits inside the merchandise (shipping is not part of this subtotal).
  const subtotalWithoutTax = isVatInclusive
    ? toBaht(Math.max(0, subtractSatang(netSubtotalSatang, calculateVatSatang(netSubtotalSatang, vatRate, true))))
    : netSubtotal

  // 7. Deposit in Satang (Held strictly separately from Revenue)
  const depositAmountSatang = Math.max(0, toSatang(options.depositAmount))
  const depositAmount = toBaht(depositAmountSatang)

  // 8. Bill Amount & Grand Total (Strictly excludes Security Deposit per MASTER v2.3.0)
  const billAmount = revenueTotal
  const grandTotal = billAmount
  const totalPayableWithDeposit = toBaht(addSatang(revenueTotalSatang, depositAmountSatang))

  return {
    subtotal,
    subtotalWithoutTax,
    discountAmount,
    discountPercent: effectiveDiscountPercent,
    isDiscountExceeded,
    maxDiscountAllowed,
    netSubtotal,
    vatRate,
    vatAmount,
    shippingFee,
    revenueTotal,
    billAmount,
    depositAmount,
    grandTotal,
    totalPayableWithDeposit,
    precision,
    roundingMode,
  }
}

/**
 * Validates whether a requested discount exceeds the maximum allowed percentage.
 * Throws a descriptive error if exceeded.
 */
export function validateDiscountCeiling(subtotal: number, discountAmount: number, settings?: SystemConfig): void {
  const cfg = settings || loadSystemSettings()
  const maxPercent = discountLimitPercent(cfg)
  if (maxPercent === null) return
  const maxAllowed = (subtotal * maxPercent) / 100
  if (discountAmount > maxAllowed + 0.01) {
    throw new Error(
      `ส่วนลด ${discountAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท เกินเพดานส่วนลดสูงสุดที่อนุญาต (${maxPercent}% = ${maxAllowed.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท)`
    )
  }
}

/** A date the caller gave, or the fallback when it is missing / not a real date. */
function usableDate(value: string | Date | undefined, fallback: Date): Date {
  if (value === undefined) return fallback
  const d = new Date(value)
  return isNaN(d.getTime()) ? fallback : d
}
