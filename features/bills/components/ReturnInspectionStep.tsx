'use client'

import type { FullBill, ReturnInspectionItem } from '@/lib/types/rental-return'
import { NumericInput } from '@/components/common/NumericInput'

export type ReturnQuantityField =
  | 'normalQty'
  | 'damagedQty'
  | 'lostQty'
  | 'repairFeePerUnit'
  | 'replacementFeePerUnit'

interface ReturnInspectionStepProps {
  activeBill: FullBill
  inspectionItems: ReturnInspectionItem[]
  hasReturnItems: boolean
  onItemQuantityChange: (rentalBillItemId: string, field: ReturnQuantityField, value: number) => void
  onBack: () => void
  onNext: () => void
}

export function ReturnInspectionStep({
  activeBill,
  inspectionItems,
  hasReturnItems,
  onItemQuantityChange,
  onBack,
  onNext,
}: ReturnInspectionStepProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xs">
        <table className="w-full text-xs text-left border-collapse">
          <colgroup>
            <col className="w-[36px] sm:w-[42px]" />
            <col className="w-auto" />
            <col className="w-[48px] sm:w-[56px]" />
            <col className="w-[48px] sm:w-[56px]" />
            <col className="w-[48px] sm:w-[56px]" />
            <col className="w-[54px] sm:w-[68px]" />
            <col className="w-[54px] sm:w-[68px]" />
            <col className="w-[54px] sm:w-[68px]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-800 dark:bg-slate-900 text-white font-bold border-b border-slate-700 shadow-xs text-xs">
            <tr>
              {['ลำดับ', 'รายการ', 'ทั้งหมด', 'ค้างคืน', 'คืนแล้ว', 'ปกติ', 'ชำรุด', 'หาย'].map((label) => (
                <th
                  key={label}
                  className="py-2 px-1 text-center bg-slate-800 dark:bg-slate-900 text-white"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800 text-[10.5px] sm:text-xs">
            {inspectionItems
              .filter((item) => item.selected)
              .map((item, idx) => {
                const billItem = activeBill.items.find(
                  (candidate) => candidate.rentalBillItemId === item.rentalBillItemId
                )
                const returnedQty =
                  billItem?.returnedQty ?? Math.max(0, item.totalQtyInBill - item.outstandingQty)
                const isCompleted = item.outstandingQty <= 0
                const maxNormal = Math.max(0, item.outstandingQty - (item.damagedQty || 0) - (item.lostQty || 0))
                const maxDamaged = Math.max(0, item.outstandingQty - (item.normalQty || 0) - (item.lostQty || 0))
                const maxLost = Math.max(0, item.outstandingQty - (item.normalQty || 0) - (item.damagedQty || 0))

                return (
                  <tr key={item.rentalBillItemId || item.productId} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="py-1 px-1 text-center font-bold text-slate-500">{idx + 1}</td>
                    <td className="py-1 px-1.5 font-bold text-slate-800 dark:text-slate-200 overflow-hidden">
                      <div className="truncate">{item.productName}</div>
                      {item.productCode && (
                        <span className="text-[10px] text-slate-400 font-mono block truncate">
                          {item.productCode}
                        </span>
                      )}
                      {item.damagedQty > 0 && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                          <span className="shrink-0 font-medium">ค่าซ่อม/ชิ้น: ฿</span>
                          <NumericInput
                            value={item.repairFeePerUnit === 0 ? '' : item.repairFeePerUnit}
                            onChange={(value) =>
                              onItemQuantityChange(item.rentalBillItemId, 'repairFeePerUnit', value === '' ? 0 : Number(value))
                            }
                            defaultValueOnBlur={0}
                            min={0}
                            className="w-16 h-5 text-right font-bold border rounded px-1 text-[10px] bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700"
                          />
                        </div>
                      )}
                      {item.lostQty > 0 && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-red-600 dark:text-red-400">
                          <span className="shrink-0 font-medium">ค่าของหาย/ชิ้น: ฿</span>
                          <NumericInput
                            value={item.replacementFeePerUnit === 0 ? '' : item.replacementFeePerUnit}
                            onChange={(value) =>
                              onItemQuantityChange(item.rentalBillItemId, 'replacementFeePerUnit', value === '' ? 0 : Number(value))
                            }
                            defaultValueOnBlur={0}
                            min={0}
                            className="w-16 h-5 text-right font-bold border rounded px-1 text-[10px] bg-white dark:bg-slate-900 border-red-300 dark:border-red-700"
                          />
                        </div>
                      )}
                    </td>
                    <td className="py-1 px-1 text-center font-bold text-slate-700 dark:text-slate-300">
                      {item.totalQtyInBill}
                    </td>
                    <td className="py-1 px-1 text-center">
                      <span className="px-1.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold">
                        {item.outstandingQty}
                      </span>
                    </td>
                    <td className="py-1 px-1 text-center">
                      <span className="px-1.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-bold">
                        {returnedQty}
                      </span>
                    </td>
                    {([
                      ['normalQty', maxNormal, 'text-emerald-600 focus:ring-emerald-500'],
                      ['damagedQty', maxDamaged, 'text-amber-600 focus:ring-amber-500'],
                      ['lostQty', maxLost, 'text-red-600 focus:ring-red-500'],
                    ] as const).map(([field, max, activeClass]) => (
                      <td key={field} className="py-1 px-1 text-center">
                        <NumericInput
                          value={item[field] === 0 ? '' : item[field]}
                          onChange={(value) =>
                            onItemQuantityChange(item.rentalBillItemId, field, value === '' ? 0 : value)
                          }
                          defaultValueOnBlur={0}
                          min={0}
                          max={max}
                          disabled={isCompleted}
                          allowDecimals={false}
                          allowNegative={false}
                          placeholder=""
                          className={`w-full min-w-0 h-7 sm:h-8 text-center font-bold border rounded-lg text-xs focus:outline-none ${
                            isCompleted
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                              : `border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 ${activeClass}`
                          }`}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-700 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="px-4 sm:px-5 py-2 rounded-xl font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-all text-xs cursor-pointer"
        >
          ย้อนกลับ
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasReturnItems}
          className={`px-5 py-2 rounded-xl font-bold text-white transition-all text-xs ${
            hasReturnItems ? 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer shadow-sm' : 'bg-slate-300 cursor-not-allowed'
          }`}
        >
          ถัดไป
        </button>
      </div>
    </div>
  )
}
