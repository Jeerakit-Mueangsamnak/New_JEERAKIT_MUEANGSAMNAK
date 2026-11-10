'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CreditCard, FileText } from 'lucide-react'
import { NumericInput } from '@/components/common/NumericInput'
import { VatModeButtons, type VatMode } from '@/features/pos/components/VatModeButtons'
import type { BillCalculationResult } from '@/lib/calculation-service'

/**
 * The shared "summary / payment" screen of the POS (owner 2026-11-04: one central layout, used by
 * ชำระเงิน for bills and by สรุปใบเสนอราคา for quotations). Left: A4 preview; right: discount /
 * shipping / deposit, รวม VAT / ไม่รวม VAT, the amounts table, the total box, then each screen's own
 * middle part (payment methods) and bottom buttons.
 */

const INPUT_CLASSES =
  'w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-1 focus:ring-emerald-500'

const TAB_CLASSES = 'flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer'

export interface SummaryRow {
  label: string
  value: number
}

/** Rows of the amounts table: goods value always; discount / shipping / VAT / deposit only when not 0
 *  (owner 2026-11-02). Amounts are shown plain: no +, - or currency sign (owner 2026-11-04). */
export function documentSummaryRows(input: {
  totals: Pick<BillCalculationResult, 'subtotal' | 'discountAmount' | 'shippingFee' | 'vatAmount' | 'vatRate'>
  vatInclusive: boolean
  depositAmount: number
  depositLabel?: string
}): SummaryRow[] {
  const { totals } = input
  const rows: SummaryRow[] = [{ label: 'มูลค่าสินค้า', value: totals.subtotal }]
  if (totals.discountAmount > 0) rows.push({ label: 'ส่วนลด', value: totals.discountAmount })
  if (totals.shippingFee > 0) rows.push({ label: 'ค่าขนส่ง', value: totals.shippingFee })
  if (totals.vatAmount > 0) {
    const vatLabel = `ภาษีมูลค่าเพิ่ม ${(totals.vatRate * 100).toFixed(0)}%`
    rows.push({ label: input.vatInclusive ? `${vatLabel} (รวมในราคาแล้ว)` : vatLabel, value: totals.vatAmount })
  }
  if (input.depositAmount > 0) rows.push({ label: input.depositLabel ?? 'เงินมัดจำ', value: input.depositAmount })
  return rows
}

const money = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2 })

interface DocumentSummaryLayoutProps {
  /** Extra classes for the root (e.g. the print root of the payment page). */
  className?: string
  /** The A4 document shown on the left (scaled by the caller's A4FitPreview). */
  preview: React.ReactNode
  /** Mobile tab captions (< md). */
  formTabLabel: string
  previewTabLabel: string
  /** The right-hand panel (DocumentSummaryPanel). */
  children: React.ReactNode
}

/** Page frame: A4 preview on the left, the panel on the right; tabs switch between them on small screens. */
export function DocumentSummaryLayout({ className = '', preview, formTabLabel, previewTabLabel, children }: DocumentSummaryLayoutProps) {
  const [mobileTab, setMobileTab] = useState<'FORM' | 'PREVIEW'>('FORM')
  return (
    <div className={`${className} flex h-full min-h-0 w-full flex-1 flex-col bg-slate-100 p-2 sm:p-2.5 dark:bg-slate-900 md:grid md:h-full md:max-h-full md:min-h-0 md:grid-cols-[minmax(0,58fr)_minmax(300px,42fr)] lg:grid-cols-[minmax(0,60fr)_minmax(340px,40fr)] md:gap-2.5 md:overflow-hidden lg:gap-3 lg:p-3`}>
      {/* Mobile View Switcher (< md screens) */}
      <div className="md:hidden flex items-center bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm shrink-0 mb-1.5">
        <button
          type="button"
          onClick={() => setMobileTab('FORM')}
          className={`${TAB_CLASSES} ${mobileTab === 'FORM' ? 'bg-emerald-700 text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>{formTabLabel}</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('PREVIEW')}
          className={`${TAB_CLASSES} ${mobileTab === 'PREVIEW' ? 'bg-emerald-700 text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>{previewTabLabel}</span>
        </button>
      </div>

      {/* Left: real A4 preview. The A4 sheet never scrolls; it is scaled to fit available space. */}
      <div className={`h-full min-h-0 w-full flex-1 overflow-hidden flex-col bg-slate-100/60 dark:bg-slate-950/40 rounded-xl border border-slate-200/80 dark:border-slate-800 ${
        mobileTab === 'PREVIEW' ? 'flex' : 'hidden md:flex'
      }`}>
        <div className="flex-1 min-h-0 w-full h-full overflow-hidden">{preview}</div>
      </div>

      {/* Right: the panel */}
      <div className={`min-h-0 min-w-0 flex-col md:h-full ${mobileTab === 'FORM' ? 'flex flex-1' : 'hidden md:flex'}`}>
        {children}
      </div>
    </div>
  )
}

interface DocumentSummaryPanelProps {
  title: string
  backHref: string
  backLabel: string
  discount: number
  onDiscountChange: (value: number) => void
  shippingFee: number
  onShippingFeeChange: (value: number) => void
  depositAmount: number
  onDepositAmountChange: (value: number) => void
  disabled?: boolean
  /** The shop's VAT rate from Settings (the buttons are disabled until it is set). */
  vatRate: number | null | undefined
  /** The pressed button; null = no VAT. */
  vatMode: VatMode | null
  onToggleVat: (mode: VatMode) => void
  rows: SummaryRow[]
  totalLabel: string
  totalAmount: number
  /** This screen's own middle part (e.g. payment methods). */
  children?: React.ReactNode
  /** This screen's own bottom buttons (always at the very bottom). */
  footer: React.ReactNode
}

export function DocumentSummaryPanel({
  title,
  backHref,
  backLabel,
  discount,
  onDiscountChange,
  shippingFee,
  onShippingFeeChange,
  depositAmount,
  onDepositAmountChange,
  disabled = false,
  vatRate,
  vatMode,
  onToggleVat,
  rows,
  totalLabel,
  totalAmount,
  children,
  footer,
}: DocumentSummaryPanelProps) {
  const amountInputs: Array<[string, number, (value: number) => void]> = [
    ['ส่วนลด (บาท)', discount, onDiscountChange],
    ['ค่าขนส่ง (บาท)', shippingFee, onShippingFeeChange],
    ['เงินมัดจำ (บาท)', depositAmount, onDepositAmountChange],
  ]
  return (
    <div className="mt-0 flex h-full min-h-0 min-w-0 flex-1 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800 md:mt-0 md:p-3.5 lg:p-4">
      <div className="flex min-h-0 flex-1 flex-col space-y-2 sm:space-y-2.5 overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 min-w-0 items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-700">
          <Link
            href={backHref}
            className="flex shrink-0 items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">{backLabel}</span>
          </Link>
          <h3 className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-900 dark:text-slate-100 sm:text-base">{title}</h3>
        </div>

        {/* ส่วนลด / ค่าขนส่ง / เงินมัดจำ */}
        <div className="grid shrink-0 grid-cols-3 gap-2 text-xs">
          {amountInputs.map(([label, value, onChange]) => (
            <div key={label}>
              <span className="text-slate-600 dark:text-slate-400 block mb-0.5">{label}</span>
              <NumericInput
                aria-label={label}
                value={value || ''}
                onChange={(val) => onChange(val === '' ? 0 : val)}
                defaultValueOnBlur={0}
                min={0}
                disabled={disabled}
                className={INPUT_CLASSES}
              />
            </div>
          ))}
        </div>

        {/* รวม VAT / ไม่รวม VAT: none pressed = no VAT; pressing the chosen one again cancels it.
            The rate (%) is only what the owner set in Settings. */}
        <VatModeButtons mode={vatMode} onToggle={onToggleVat} vatRate={vatRate} disabled={disabled} />

        {/* Amounts table */}
        <div className="shrink-0 divide-y divide-slate-100 border-y border-slate-100 text-xs text-slate-700 tabular-nums dark:divide-slate-700 dark:border-slate-700 dark:text-slate-300">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-2 py-1">
              <span>{row.label}</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">{money(row.value)}</span>
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="flex shrink-0 items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 dark:bg-emerald-950/40">
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{totalLabel}</span>
          <span className="whitespace-nowrap text-2xl font-black leading-tight tracking-tight text-emerald-700 tabular-nums dark:text-emerald-300 sm:text-3xl">
            {money(totalAmount)}
          </span>
        </div>

        {children}
      </div>

      {/* Bottom of the panel */}
      <div className="flex shrink-0 flex-col gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">{footer}</div>
    </div>
  )
}
