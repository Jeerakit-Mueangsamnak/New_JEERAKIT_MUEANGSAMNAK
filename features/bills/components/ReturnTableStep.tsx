'use client'

import React from 'react'
import type { FullBill, ReturnInspectionItem } from '@/lib/types/rental-return'
import { StepNavButton } from '@/components/common/ActionButton'
import { toggleRowOnDoubleClick } from '@/components/common/row-selection'
import { NumericInput } from '@/components/common/NumericInput'
import { CustomDatePicker, getLocalDateString, parseLocalDate } from '@/components/common/CustomDatePicker'
import { DataTableFrame, DATA_TABLE_CLASSES, DATA_TABLE_THEAD_CLASSES } from '@/components/common/DataTableFrame'
import { computeItemRentalCalculation } from '@/features/bills/services/return-calculation'
import { buildContinuationLine, shortDateTh } from '@/features/bills/utils/bill-workspace'

export type ReturnQuantityField =
  | 'normalQty'
  | 'damagedQty'
  | 'lostQty'
  | 'continueQty'
  | 'repairFeePerUnit'
  | 'replacementFeePerUnit'

interface ReturnTableStepProps {
  activeBill: FullBill
  items: ReturnInspectionItem[]
  canNext: boolean
  onToggleSelectAll: () => void
  /** Tick box, and double-click on the row (1st = tick, 2nd = untick: the shared rule). */
  onToggleSelectItem: (idx: number) => void
  onQuantityChange: (rentalBillItemId: string, field: ReturnQuantityField, value: number) => void
  /** Daily goods without เช่าต่อ: the day they came back. */
  onReturnDateChange: (idx: number, value: string) => void
  /** Daily goods with เช่าต่อ: the day the new round ends. */
  onContinueEndDateChange: (idx: number, value: string) => void
  /** Per-round goods with เช่าต่อ: how many more rounds. */
  onContinueRoundsChange: (idx: number, value: number) => void
  onBack: () => void
  onNext: () => void
}

const HEADERS: { label: string; className?: string }[] = [
  { label: 'ลำดับ' },
  { label: 'รายการ', className: 'text-left' },
  { label: 'จำนวน' },
  { label: 'ค้างคืน' },
  { label: 'คืนแล้ว' },
  { label: 'วันที่เช่า/คืน' },
  { label: 'การเช่า' },
  { label: 'ปกติ' },
  { label: 'ชำรุด' },
  { label: 'หาย' },
  { label: 'เช่าต่อ' },
  { label: 'วันที่/รอบ' },
  { label: 'เช่าจริง' },
]

const QTY_FIELDS = [
  { field: 'normalQty', activeClass: 'text-emerald-700 dark:text-emerald-400 focus:ring-emerald-500' },
  { field: 'damagedQty', activeClass: 'text-amber-700 dark:text-amber-400 focus:ring-amber-500' },
  { field: 'lostQty', activeClass: 'text-red-700 dark:text-red-400 focus:ring-red-500' },
  { field: 'continueQty', activeClass: 'text-blue-700 dark:text-blue-400 focus:ring-blue-500' },
] as const

// Same spacing as the bill list table: tight cells, text wraps instead of running off the screen.
const cell = 'px-1 text-center'
const numberBox =
  'w-full min-w-0 h-7 px-0.5 text-center font-bold border rounded-lg text-[11px] focus:outline-none'

/**
 * One table for the whole return: what was rented, what is still out, what comes back now
 * (normal / damaged / lost) and what stays with the customer on a new เช่าต่อ bill. Typing a
 * quantity ticks the row. "เช่าต่อ" = how many sets / pieces continue; "วันที่/รอบ" = for how long:
 * daily goods pick the end date (days follow from it), per-round goods type how many more rounds.
 */
export function ReturnTableStep({
  activeBill,
  items,
  canNext,
  onToggleSelectAll,
  onToggleSelectItem,
  onQuantityChange,
  onReturnDateChange,
  onContinueEndDateChange,
  onContinueRoundsChange,
  onBack,
  onNext,
}: ReturnTableStepProps) {
  const today = getLocalDateString(new Date())

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* owner 2026-11-07: the table runs to the bottom; ย้อนกลับ / ถัดไป sit in its bottom bar, the count in the middle */}
      <DataTableFrame
        fill
        rowCount={items.length}
        countBarStart={<StepNavButton direction="back" onClick={onBack} />}
        countBarEnd={<StepNavButton direction="next" onClick={onNext} disabled={!canNext} />}
        // Edge to edge inside the bill's white work area, under the tabs
        className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent"
      >
        <table className={`${DATA_TABLE_CLASSES} text-[10px] leading-tight`}>
          <colgroup>
            {/* No text between <col>s: spaces inside <colgroup> break hydration */}
            <col className="w-[28px]" />
            <col className="w-[34px]" />
            <col className="w-auto" />
            <col className="w-[40px]" />
            <col className="w-[40px]" />
            <col className="w-[40px]" />
            <col className="w-[62px]" />
            <col className="w-[44px]" />
            <col className="w-[38px]" />
            <col className="w-[38px]" />
            <col className="w-[38px]" />
            <col className="w-[38px]" />
            <col className="w-[76px]" />
            <col className="w-[54px]" />
          </colgroup>
          <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 shadow-sm text-xs`}>
            <tr>
              <th className="px-1 text-center">
                <input
                  type="checkbox"
                  checked={items.length > 0 && items.every((i) => i.selected)}
                  onChange={onToggleSelectAll}
                  className="w-4 h-4 rounded text-emerald-700 dark:text-emerald-400 focus:ring-emerald-500 cursor-pointer"
                  title="เลือก/ยกเลิกทั้งหมด"
                  aria-label="เลือก/ยกเลิกทั้งหมด"
                />
              </th>
              {HEADERS.map((h) => (
                <th key={h.label} className={`px-1 text-center ${h.className || ''}`}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {items.map((item, idx) => {
              const billItem = activeBill.items.find((c) => c.rentalBillItemId === item.rentalBillItemId)
              const returnedQty = billItem?.returnedQty ?? Math.max(0, item.totalQtyInBill - item.outstandingQty)
              const isCompleted = item.outstandingQty <= 0
              const isDaily = item.rentalType === 'DAILY'
              const periods = Math.max(1, item.usageCount || 1)
              const continuing = (item.continueQty || 0) > 0
              const max = (field: (typeof QTY_FIELDS)[number]['field']) =>
                Math.max(
                  0,
                  item.outstandingQty -
                    QTY_FIELDS.filter((f) => f.field !== field).reduce((sum, f) => sum + (item[f.field] || 0), 0)
                )

              // Daily goods: the date of this row (return day, or the new end day when continuing).
              const defaultEnd = continuing ? buildContinuationLine(item, item.continueQty || 1)?.endDay : undefined
              const dateShown = continuing ? item.continueEndDate || defaultEnd || '' : item.actualReturnDate || today
              const actualDays =
                isDaily && !isCompleted
                  ? computeItemRentalCalculation(item, {
                      rentalStartDate: item.rentalStartDate,
                      scheduledReturnDate: item.scheduledReturnDate,
                      actualReturnDate: dateShown,
                    }).actualRentalDays
                  : null
              // Rounds beyond the bill: the เช่าต่อ bill's rounds, or rounds already used by goods coming back now.
              const rounds = periods + Math.max(0, item.continueRounds || 0)

              return (
                <tr
                  key={item.rentalBillItemId || item.productId}
                  onDoubleClick={(e) => toggleRowOnDoubleClick(e, () => !isCompleted && onToggleSelectItem(idx))}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${
                    item.selected ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''
                  } ${isCompleted ? 'opacity-60' : ''}`}
                >
                  <td className={cell}>
                    <input
                      type="checkbox"
                      checked={item.selected ?? false}
                      disabled={isCompleted}
                      onChange={() => onToggleSelectItem(idx)}
                      className="w-4 h-4 rounded text-emerald-700 dark:text-emerald-400 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                      aria-label={`เลือก ${item.productName}`}
                    />
                  </td>
                  <td className={`${cell} font-bold text-slate-600 dark:text-slate-400`}>{idx + 1}</td>
                  <td className="px-1 font-bold text-slate-800 dark:text-slate-200 break-words">
                    <div title={item.productName}>{item.productName}</div>
                    {item.productCode && (
                      <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono block break-all">{item.productCode}</span>
                    )}
                    {item.damagedQty > 0 && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                        <span className="shrink-0 font-medium">ค่าซ่อม/ชิ้น: </span>
                        <NumericInput
                          value={item.repairFeePerUnit === 0 ? '' : item.repairFeePerUnit}
                          onChange={(value) => onQuantityChange(item.rentalBillItemId, 'repairFeePerUnit', value === '' ? 0 : Number(value))}
                          min={0}
                          className="w-16 h-5 text-right font-bold border rounded px-1 text-[10px] bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700"
                        />
                      </div>
                    )}
                    {item.lostQty > 0 && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-red-700 dark:text-red-400">
                        <span className="shrink-0 font-medium">ค่าของหาย/ชิ้น: </span>
                        <NumericInput
                          value={item.replacementFeePerUnit === 0 ? '' : item.replacementFeePerUnit}
                          onChange={(value) => onQuantityChange(item.rentalBillItemId, 'replacementFeePerUnit', value === '' ? 0 : Number(value))}
                          min={0}
                          className="w-16 h-5 text-right font-bold border rounded px-1 text-[10px] bg-white dark:bg-slate-900 border-red-300 dark:border-red-700"
                        />
                      </div>
                    )}
                  </td>
                  <td className={`${cell} font-bold text-slate-700 dark:text-slate-300`}>{item.totalQtyInBill}</td>
                  <td className={`${cell} font-bold text-slate-700 dark:text-slate-300`}>{item.outstandingQty}</td>
                  <td className={`${cell} font-bold text-slate-600 dark:text-slate-400`}>{returnedQty}</td>
                  <td className={`${cell} text-slate-600 dark:text-slate-300 whitespace-nowrap`}>
                    <span className="block">{shortDateTh(item.rentalStartDate)}</span>
                    <span className="block">{shortDateTh(item.scheduledReturnDate)}</span>
                  </td>
                  <td className={`${cell} text-slate-700 dark:text-slate-300 whitespace-nowrap`}>
                    {periods} {isDaily ? 'วัน' : 'รอบ'}
                  </td>
                  {QTY_FIELDS.map(({ field, activeClass }) => (
                    <td key={field} className={cell}>
                      <NumericInput
                        value={item[field] === 0 || item[field] === undefined ? '' : (item[field] as number)}
                        onChange={(value) => onQuantityChange(item.rentalBillItemId, field, value === '' ? 0 : value)}
                        min={0}
                        max={max(field)}
                        disabled={isCompleted}
                        allowDecimals={false}
                        allowNegative={false}
                        placeholder=""
                        className={`${numberBox} ${
                          isCompleted
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                            : `border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 ${activeClass}`
                        }`}
                      />
                    </td>
                  ))}
                  <td className={cell}>
                    {isCompleted ? (
                      <span className="text-slate-600 dark:text-slate-400">-</span>
                    ) : isDaily ? (
                      <CustomDatePicker
                        value={parseLocalDate(dateShown)}
                        onChange={(date) => {
                          const value = date ? getLocalDateString(date) : ''
                          if (continuing) onContinueEndDateChange(idx, value)
                          else onReturnDateChange(idx, value)
                        }}
                        showClear={false}
                        hideIcon
                        align="right"
                        className="text-xs"
                        buttonClassName="h-7 px-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-[11px] font-mono font-semibold justify-center [&>span]:text-center hover:border-slate-300"
                      />
                    ) : (
                      <NumericInput
                        value={item.continueRounds || ''}
                        onChange={(value) => onContinueRoundsChange(idx, value === '' ? 0 : value)}
                        min={1}
                        allowDecimals={false}
                        allowNegative={false}
                        placeholder=""
                        aria-label="รอบที่เพิ่ม"
                        className={`${numberBox} border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 focus:ring-blue-500`}
                      />
                    )}
                  </td>
                  <td className={`${cell} font-bold text-blue-700 dark:text-blue-400 whitespace-nowrap`}>
                    {isCompleted ? '-' : isDaily ? `${actualDays} วัน` : `${rounds} รอบ`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}
