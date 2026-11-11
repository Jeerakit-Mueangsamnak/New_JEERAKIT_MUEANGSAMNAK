'use client'

import React, { useMemo, useState } from 'react'
import { PencilLine } from 'lucide-react'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
import { CustomSelect } from '@/components/common/CustomSelect'
import { NumericInput } from '@/components/common/NumericInput'
import { loadUnits } from '@/lib/unit-storage'

export type CustomItemRentalType = 'NORMAL' | 'DAILY' | 'SALE'

export interface CustomItemData {
  name: string
  quantity: number
  unit: string
  unitPrice: number
  /** Rounds (ต่อรอบ) or days (ต่อวัน); a sale counts once. */
  count: number
  rentalType: CustomItemRentalType
}

const RENTAL_TYPE_OPTIONS: { value: CustomItemRentalType; label: string }[] = [
  { value: 'NORMAL', label: 'ต่อรอบ' },
  { value: 'DAILY', label: 'ต่อวัน' },
  { value: 'SALE', label: 'ขาย' },
]

/** One window takes up to this many typed-in lines at once (owner 2026-11-11). */
export const CUSTOM_ITEM_ROWS = 5

const FIELD_CLASSES =
  'w-full h-10 px-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold text-sm tabular-nums focus:ring-2 focus:ring-emerald-500 focus:outline-none'
const HEAD_CLASSES = 'whitespace-nowrap text-xs font-medium text-slate-700 dark:text-slate-300'
// Column widths sized to what each box holds (owner 2026-11-11): จำนวน 3 digits, ราคา 4, รอบ 2,
// จำนวนเงิน 6; the name takes what is left. Narrow screens scroll the rows sideways.
const GRID_CLASSES = 'grid grid-cols-[minmax(120px,1fr)_52px_84px_64px_60px_84px_100px] gap-1.5 items-center'

interface Row {
  name: string
  quantity: number | ''
  unit: string
  unitPrice: number | ''
  count: number | ''
  rentalType: CustomItemRentalType
}

const emptyRow = (): Row => ({ name: '', quantity: '', unit: '', unitPrice: '', count: 1, rentalType: 'NORMAL' })

const rowTimes = (r: Row) => (r.rentalType === 'SALE' ? 1 : Math.max(1, typeof r.count === 'number' ? r.count : 1))
const rowAmount = (r: Row) =>
  Math.round((typeof r.quantity === 'number' ? r.quantity : 0) * (typeof r.unitPrice === 'number' ? r.unitPrice : 0) * rowTimes(r) * 100) / 100
/** What a started row (it has a name) still lacks; an empty row is skipped. */
const rowMissing = (r: Row): string | null =>
  !r.name.trim()
    ? null
    : !(typeof r.quantity === 'number' && r.quantity > 0)
      ? 'จำนวน'
      : !r.unit.trim()
        ? 'หน่วย'
        : !(typeof r.unitPrice === 'number' && r.unitPrice > 0)
          ? 'ราคา'
          : null

interface CustomItemModalProps {
  /** The filled rows, in order (one when editing). */
  onAdd: (items: CustomItemData[]) => void
  onClose: () => void
  /** Editing a cart line: one row with its values. */
  initial?: CustomItemData
  submitLabel?: string
}

/**
 * รายการนอกร้าน (owner 2026-11-11): lines typed in at the counter, like writing a paper bill —
 * [ชื่อรายการ][จำนวน][หน่วย][ราคา][จำนวนรอบ][การเช่า][จำนวนเงิน], up to 5 per window. No shop product,
 * no stock; each amount (จำนวน × ราคา × รอบ/วัน) goes on the bill and counts as the shop's revenue.
 * Same window style as the quantity window (QuantityModal).
 */
export function CustomItemModal({ onAdd, onClose, initial, submitLabel = 'เพิ่มลงตะกร้า' }: CustomItemModalProps) {
  const unitOptions = useMemo(
    () => loadUnits().filter((u) => u.isActive !== false).map((u) => ({ value: u.name, label: u.name })),
    [],
  )
  const [rows, setRows] = useState<Row[]>(() =>
    initial
      ? [{ ...initial }]
      : Array.from({ length: CUSTOM_ITEM_ROWS }, emptyRow),
  )
  const setRow = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  const started = rows.filter((r) => r.name.trim())
  const firstMissing = rows.map(rowMissing).find(Boolean) ?? null
  const blocked = started.length === 0 ? 'ชื่อรายการ' : firstMissing
  const total = Math.round(started.reduce((s, r) => s + rowAmount(r), 0) * 100) / 100

  const submit = () => {
    if (blocked) return
    onAdd(
      started.map((r) => ({
        name: r.name.trim(),
        quantity: r.quantity as number,
        unit: r.unit.trim(),
        unitPrice: r.unitPrice as number,
        count: rowTimes(r),
        rentalType: r.rentalType,
      })),
    )
    onClose()
  }

  return (
    <AppModal isOpen={true} onClose={onClose} size="lg">
      <AppModalHeader onClose={onClose} icon={<PencilLine className="w-5 h-5 text-blue-600 dark:text-blue-400" />}>
        <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">รายการนอกร้าน</h3>
      </AppModalHeader>

      <AppModalBody>
        <div className="overflow-x-auto">
          <div className="min-w-[600px] space-y-1.5">
            <div className={GRID_CLASSES} aria-hidden="true">
              <span className={HEAD_CLASSES}>ชื่อรายการ</span>
              <span className={HEAD_CLASSES}>จำนวน</span>
              <span className={HEAD_CLASSES}>หน่วย</span>
              <span className={HEAD_CLASSES}>ราคา</span>
              <span className={HEAD_CLASSES}>จำนวนรอบ</span>
              <span className={HEAD_CLASSES}>การเช่า</span>
              <span className={HEAD_CLASSES}>จำนวนเงิน</span>
            </div>
            {rows.map((r, i) => {
              const n = i + 1
              const isSale = r.rentalType === 'SALE'
              return (
                <div key={i} className={GRID_CLASSES}>
                  <input
                    type="text"
                    aria-label={`ชื่อรายการ แถว ${n}`}
                    autoFocus={i === 0}
                    maxLength={200}
                    value={r.name}
                    onChange={(e) => setRow(i, { name: e.target.value })}
                    className={FIELD_CLASSES}
                  />
                  <NumericInput
                    aria-label={`จำนวน แถว ${n}`}
                    value={r.quantity}
                    onChange={(v) => setRow(i, { quantity: v })}
                    min={1}
                    allowDecimals={false}
                    className={FIELD_CLASSES}
                  />
                  <CustomSelect
                    ariaLabel={`หน่วย แถว ${n}`}
                    value={r.unit}
                    onChange={(v) => setRow(i, { unit: String(v) })}
                    options={unitOptions}
                    searchable
                    allowCustom
                    placeholder="หน่วย"
                    buttonClassName="h-10 px-2 py-0 rounded-xl"
                    align="left"
                  />
                  <NumericInput
                    aria-label={`ราคา แถว ${n}`}
                    value={r.unitPrice}
                    onChange={(v) => setRow(i, { unitPrice: v })}
                    min={0}
                    allowDecimals={true}
                    className={FIELD_CLASSES}
                  />
                  <NumericInput
                    aria-label={`${r.rentalType === 'DAILY' ? 'จำนวนวัน' : 'จำนวนรอบ'} แถว ${n}`}
                    value={isSale ? 1 : r.count}
                    onChange={(v) => setRow(i, { count: v })}
                    min={1}
                    allowDecimals={false}
                    disabled={isSale}
                    className={`${FIELD_CLASSES} disabled:opacity-50`}
                  />
                  <CustomSelect
                    ariaLabel={`การเช่า แถว ${n}`}
                    value={r.rentalType}
                    onChange={(v) => setRow(i, { rentalType: v as CustomItemRentalType })}
                    options={RENTAL_TYPE_OPTIONS}
                    buttonClassName="h-10 px-2 py-0 rounded-xl"
                    align="right"
                  />
                  <div
                    aria-label={`จำนวนเงิน แถว ${n}`}
                    className="h-10 px-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-right text-sm font-extrabold text-blue-600 dark:text-blue-400 flex items-center justify-end tabular-nums"
                  >
                    {r.name.trim() ? rowAmount(r).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </AppModalBody>

      <AppModalFooter>
        <div className="flex-1 flex items-center justify-between w-full">
          <div className="text-xs">
            <span className="text-slate-600 dark:text-slate-400">ราคารวม: </span>
            <span className="text-base font-extrabold text-blue-600 dark:text-blue-400">
              {total.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs transition-colors cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={Boolean(blocked)}
              title={blocked ? `กรอก${blocked}ก่อน` : undefined}
              className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-lg shadow-emerald-500/30 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </AppModalFooter>
    </AppModal>
  )
}
