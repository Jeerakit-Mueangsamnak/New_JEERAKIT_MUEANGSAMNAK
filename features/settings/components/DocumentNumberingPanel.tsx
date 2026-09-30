'use client'

import React from 'react'
import { CustomSelect } from '@/components/common/CustomSelect'
import type { SystemConfig } from '@/features/settings/types/settings-page.types'
import { previewDocumentNumber } from '@/features/settings/utils/settings-page-utils'

interface DocumentNumberingPanelProps {
  config: SystemConfig
  setConfig: React.Dispatch<React.SetStateAction<SystemConfig>>
}

export function DocumentNumberingPanel({ config, setConfig }: DocumentNumberingPanelProps) {
  return (
    <div className="space-y-2">
      {(
        [
          { key: 'rentalBill', name: 'บิลเช่า / สัญญาเช่า' },
          { key: 'quotation', name: 'ใบเสนอราคา' },
          { key: 'receipt', name: 'ใบเสร็จรับเงิน' },
          { key: 'returnSlip', name: 'ใบรับคืนสินค้า' },
        ] as { key: 'rentalBill' | 'quotation' | 'receipt' | 'returnSlip'; name: string }[]
      ).map((doc) => {
        const dConfig = config.documentNumbering[doc.key]
        const preview = previewDocumentNumber(dConfig)

        return (
          <div key={doc.key} className="py-6 px-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="font-bold text-slate-900 dark:text-slate-100">{doc.name}</h4>
              <div className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-mono font-black text-xs border border-indigo-200 dark:border-indigo-800">
                ตัวอย่าง: {preview}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Prefix</label>
                <input
                  type="text"
                  maxLength={10}
                  value={dConfig.prefix}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      documentNumbering: {
                        ...config.documentNumbering,
                        [doc.key]: { ...dConfig, prefix: e.target.value.trim() },
                      },
                    })
                  }
                  className="w-full h-9 px-3 py-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold text-blue-600 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">จำนวนหลัก Running</label>
                <CustomSelect
                  buttonClassName="h-9 px-2.5 py-0 rounded-xl"
                  value={dConfig.runningDigits}
                  onChange={(val) =>
                    setConfig({
                      ...config,
                      documentNumbering: {
                        ...config.documentNumbering,
                        [doc.key]: { ...dConfig, runningDigits: parseInt(String(val), 10) || 3 },
                      },
                    })
                  }
                  options={[
                    { value: 3, label: '3 หลัก (001)' },
                    { value: 4, label: '4 หลัก (0001)' },
                    { value: 5, label: '5 หลัก (00001)' },
                    { value: 6, label: '6 หลัก (000001)' },
                  ]}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">รอบการรีเซ็ตเลข</label>
                <CustomSelect
                  buttonClassName="h-9 px-2.5 py-0 rounded-xl"
                  value={dConfig.resetCycle}
                  onChange={(val) =>
                    setConfig({
                      ...config,
                      documentNumbering: {
                        ...config.documentNumbering,
                        [doc.key]: { ...dConfig, resetCycle: val },
                      },
                    })
                  }
                  options={[
                    { value: 'DAILY', label: 'รายวัน' },
                    { value: 'MONTHLY', label: 'รายเดือน' },
                    { value: 'YEARLY', label: 'รายปี' },
                    { value: 'NEVER', label: 'ไม่รีเซ็ต' },
                  ]}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">รูปแบบปี</label>
                <CustomSelect
                  buttonClassName="h-9 px-2.5 py-0 rounded-xl"
                  value={dConfig.yearMode}
                  onChange={(val) =>
                    setConfig({
                      ...config,
                      documentNumbering: {
                        ...config.documentNumbering,
                        [doc.key]: { ...dConfig, yearMode: val },
                      },
                    })
                  }
                  options={[
                    { value: 'BE', label: 'พ.ศ. (เช่น 2569)' },
                    { value: 'CE', label: 'ค.ศ. (เช่น 2026)' },
                  ]}
                />
              </div>


              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">รูปแบบวันที่</label>
                <CustomSelect
                  buttonClassName="h-9 px-2.5 py-0 rounded-xl"
                  disabled={!dConfig.includeDate}
                  value={dConfig.datePattern}
                  onChange={(val) =>
                    setConfig({
                      ...config,
                      documentNumbering: {
                        ...config.documentNumbering,
                        [doc.key]: { ...dConfig, datePattern: val },
                      },
                    })
                  }
                  options={[
                    { value: 'DDMMYYYY', label: 'วันเดือนปี (15082569)' },
                    { value: 'MMYYYY', label: 'เดือนปี (082569)' },
                    { value: 'YYYY', label: 'ปีอย่างเดียว (2569)' },
                  ]}
                />
              </div>

              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-1.5 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dConfig.includeDate}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        documentNumbering: {
                          ...config.documentNumbering,
                          [doc.key]: { ...dConfig, includeDate: e.target.checked },
                        },
                      })
                    }
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">ใส่วันที่ในรหัส</span>
                </label>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

