'use client'

import type { ReturnInspectionItem } from '@/lib/types/rental-return'
import { CustomDatePicker, getLocalDateString, parseLocalDate } from '@/components/common/CustomDatePicker'
import { computeItemRentalCalculation } from '@/features/bills/services/return-calculation'

interface PaymentItemSelectionTableProps {
  items: ReturnInspectionItem[]
  rentalStartDate: string
  scheduledReturnDate: string
  actualReturnDate: string
  onToggleSelectAll: () => void
  onToggleSelectItem: (index: number) => void
  onItemDateChange: (
    index: number,
    field: 'rentalStartDate' | 'scheduledReturnDate' | 'actualReturnDate',
    value: string
  ) => void
}

const rentalBilling = { allowPartialReturn: true, allowContinueAfterPaid: true }

export function PaymentItemSelectionTable({
  items,
  rentalStartDate,
  scheduledReturnDate,
  actualReturnDate,
  onToggleSelectAll,
  onToggleSelectItem,
  onItemDateChange,
}: PaymentItemSelectionTableProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xs">
      <table className="w-full text-xs text-left border-collapse">
        <colgroup>
          <col className="w-[36px] sm:w-[42px]" />
          <col className="w-[36px] sm:w-[42px]" />
          <col className="w-auto" />
          <col className="w-[84px] sm:w-[100px] lg:w-[115px]" />
          <col className="w-[84px] sm:w-[100px] lg:w-[115px]" />
          <col className="w-[84px] sm:w-[100px] lg:w-[115px]" />
          <col className="w-[56px] sm:w-[68px]" />
          <col className="w-[72px] sm:w-[88px]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-slate-800 dark:bg-slate-900 text-white font-bold border-b border-slate-700 shadow-xs text-xs">
          <tr>
            <th className="py-2 px-1 text-center bg-slate-800 dark:bg-slate-900 text-white">
              <input
                type="checkbox"
                checked={items.length > 0 && items.every((item) => item.selected)}
                onChange={onToggleSelectAll}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                title="เลือก/ยกเลิกทั้งหมด"
              />
            </th>
            <th className="py-2 px-1 text-center bg-slate-800 dark:bg-slate-900 text-white">ลำดับ</th>
            <th className="py-2 px-1.5 bg-slate-800 dark:bg-slate-900 text-white">รายการ</th>
            <th className="py-2 px-1 text-center bg-slate-800 dark:bg-slate-900 text-white">วันที่เช่า</th>
            <th className="py-2 px-1 text-center bg-slate-800 dark:bg-slate-900 text-white">กำหนดคืน</th>
            <th className="py-2 px-1 text-center bg-slate-800 dark:bg-slate-900 text-white">วันคืนจริง</th>
            <th className="py-2 px-1 text-center bg-slate-800 dark:bg-slate-900 text-white">วันใช้จริง</th>
            <th className="py-2 px-1.5 text-right bg-slate-800 dark:bg-slate-900 text-white">รวมค่าเช่า</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800 text-[10.5px] sm:text-xs">
          {items.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                <p className="font-semibold text-sm">ไม่มีรายการสินค้าที่ต้องเลือก</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  สามารถชำระยอดค้างของบิลแบบรวมได้ (กดปุ่ม &quot;ชำระรวม&quot; หรือ &quot;ถัดไป&quot;)
                </p>
              </td>
            </tr>
          ) : (
            items.map((item, idx) => {
              const itemCalc = computeItemRentalCalculation(item, {
                rentalStartDate,
                scheduledReturnDate,
                actualReturnDate,
              }, rentalBilling)

              return (
                <tr
                  key={item.rentalBillItemId || item.productId}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${
                    !item.selected ? 'opacity-60 bg-slate-50/50 dark:bg-slate-900/30' : ''
                  }`}
                >
                  <td className="py-1 px-1 text-center">
                    <input
                      type="checkbox"
                      checked={item.selected ?? true}
                      onChange={() => onToggleSelectItem(idx)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </td>
                  <td className="py-1 px-1 text-center font-bold text-slate-500">{idx + 1}</td>
                  <td className="py-1 px-1.5 font-bold text-slate-800 dark:text-slate-200 overflow-hidden">
                    <div className="truncate">{item.productName}</div>
                    {item.productCode && (
                      <span className="text-[10px] text-slate-400 font-mono block truncate">
                        {item.productCode}
                      </span>
                    )}
                  </td>
                  {([
                    ['rentalStartDate', item.rentalStartDate, 'วันที่เช่า...'],
                    ['scheduledReturnDate', item.scheduledReturnDate, 'วันกำหนดคืน...'],
                    ['actualReturnDate', item.actualReturnDate, 'วันคืนจริง...'],
                  ] as const).map(([field, date, placeholder]) => (
                    <td key={field} className="py-1 px-1 text-center">
                      <CustomDatePicker
                        value={parseLocalDate(date)}
                        onChange={(value) =>
                          onItemDateChange(idx, field, value ? getLocalDateString(value) : '')
                        }
                        align="left"
                        placeholder={placeholder}
                        className="text-xs"
                      />
                    </td>
                  ))}
                  <td className="py-1 px-1 text-center">
                    <span className="px-1.5 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-black text-[10.5px] sm:text-[11px] whitespace-nowrap">
                      {itemCalc.actualRentalDays} วัน
                    </span>
                  </td>
                  <td className="py-1 px-1.5 text-right font-black text-slate-900 dark:text-slate-100 tabular-nums truncate">
                    ฿{itemCalc.itemRentalFee.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
