'use client'

import React, { useEffect, useState } from 'react'
import { Calendar, MapPin } from 'lucide-react'
import { StepNavButton } from '@/components/common/ActionButton'
import { AppModal, AppModalBody } from '@/components/common/AppModal'
import { CalendarPanel, getLocalDateString } from '@/components/common/CustomDatePicker'
import { useToast } from '@/components/common/Toast'

/**
 * The cart's own input set (POS ตะกร้าสินค้า), shared with แก้ไขบิลเช่า (owner 2026-11-19): the delivery place box,
 * the date row (📝 document · 🟢 rental start · 🔴 return) and the step-by-step date window it opens.
 */

const FIELD_CLASSES =
  'rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'

/** สถานที่จัดส่ง / โครงการ box of the cart. */
export function CartDeliveryInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <MapPin className="w-4 h-4 text-slate-600 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        type="text"
        aria-label="สถานที่จัดส่ง"
        placeholder="สถานที่จัดส่ง / โครงการ..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full pl-9 pr-3 py-1.5 ${FIELD_CLASSES} text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none`}
      />
    </div>
  )
}

const shortDay = (d: Date | null) => (d ? d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' }) : '--/--')

/** The cart's date row: one button showing the picked days; --/-- until they are picked. */
export function CartDatesButton({
  documentDate,
  rentalDate,
  returnDate,
  showDates = true,
  withDocumentDate = true,
  attention = false,
  onClick,
}: {
  documentDate?: Date | null
  rentalDate: Date | null
  returnDate: Date | null
  showDates?: boolean
  /** เช่าต่อ makes a new bill: it has no document date of its own to pick. */
  withDocumentDate?: boolean
  attention?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={withDocumentDate ? 'วันที่เอกสาร วันเริ่มเช่า วันกำหนดคืน' : 'วันเริ่มเช่า วันกำหนดคืน'}
      onClick={onClick}
      className={`w-full px-2.5 py-1.5 ${FIELD_CLASSES} text-[10px] sm:text-[11px] font-bold flex items-center justify-between shadow-xs hover:border-emerald-500 transition-colors ${attention ? 'field-attention' : ''}`}
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0 leading-tight">
        {withDocumentDate && (
          <span className="text-emerald-700 dark:text-emerald-400 whitespace-nowrap">📝 {showDates ? shortDay(documentDate ?? null) : '--/--'}</span>
        )}
        <span className="text-blue-600 dark:text-blue-400 whitespace-nowrap">🟢 {showDates ? shortDay(rentalDate) : '--/--'}</span>
        <span className="text-red-700 dark:text-red-400 whitespace-nowrap">🔴 {showDates ? shortDay(returnDate) : '--/--'}</span>
      </div>
      <Calendar className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0 ml-1" />
    </button>
  )
}

/**
 * The cart's step-by-step date window: วันที่ออกเอกสาร (never a future day) → วันเริ่มเช่า → วันที่กำหนดคืน (not before
 * the start). Each pick is handed to the caller at once; the last one closes the window.
 */
export function CartDatesModal({
  isOpen,
  onClose,
  documentDate,
  rentalDate,
  returnDate,
  withDocumentDate = true,
  onDocumentDate,
  onRentalDate,
  onReturnDate,
}: {
  isOpen: boolean
  onClose: () => void
  documentDate?: Date | null
  rentalDate: Date | null
  returnDate: Date | null
  withDocumentDate?: boolean
  onDocumentDate?: (d: Date) => void
  onRentalDate: (d: Date) => void
  /** The last step: the window closes after it. */
  onReturnDate: (d: Date) => void
}) {
  const { showToast } = useToast()
  const firstStep = withDocumentDate ? 0 : 1
  const [step, setStep] = useState<number>(firstStep)
  // Every opening starts at the first step
  useEffect(() => {
    if (isOpen) setStep(firstStep)
  }, [isOpen, firstStep])
  const stepCount = withDocumentDate ? 3 : 2

  return (
    <AppModal isOpen={isOpen} onClose={onClose} size="sm">
      <AppModalBody className="space-y-4">
        <div className="text-center space-y-1">
          <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">
            {step === 0 && '📝 เลือกวันที่ออกเอกสาร'}
            {step === 1 && '🟢 เลือกวันเริ่มเช่า'}
            {step === 2 && '🔴 เลือกวันที่กำหนดคืน'}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            ขั้นตอนที่ {step - firstStep + 1} จาก {stepCount}
          </p>
        </div>

        {/* No grey backing; a black frame and black lines above / below the days (owner 2026-11-11).
            `!` because the panel's own border / shadow classes would otherwise win. */}
        <div className="flex justify-center">
          <CalendarPanel
            value={step === 0 ? documentDate ?? null : step === 1 ? rentalDate : returnDate}
            onChange={(d) => {
              if (!d) return
              if (step === 0) {
                if (getLocalDateString(d) > getLocalDateString(new Date())) {
                  showToast('วันที่เอกสารไม่ถูกต้อง', 'วันที่ออกเอกสารต้องไม่อยู่ในอนาคต', 'ERROR')
                  return
                }
                onDocumentDate?.(d)
                setStep(1)
              } else if (step === 1) {
                onRentalDate(d)
                setStep(2)
              } else {
                if (rentalDate && getLocalDateString(d) < getLocalDateString(rentalDate)) {
                  showToast('ช่วงวันเช่าไม่ถูกต้อง', 'วันกำหนดคืนต้องไม่ก่อนวันเริ่มเช่า', 'ERROR')
                  return
                }
                onReturnDate(d)
                onClose()
              }
            }}
            showClear={false}
            showToday={true}
            className="w-full !shadow-none !border-slate-900 dark:!border-slate-100"
            dividerClassName="border-slate-900 dark:border-slate-100"
          />
        </div>

        {/* Actions: Back Button (after the first step) + Cancel Button */}
        <div className="flex items-center gap-2">
          {step > firstStep && (
            <StepNavButton direction="back" onClick={() => setStep((prev) => Math.max(firstStep, prev - 1))} className="flex-1" />
          )}
          <button
            type="button"
            onClick={onClose}
            className={`${step > firstStep ? 'flex-1' : 'w-full'} py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors cursor-pointer text-center`}
          >
            ยกเลิก
          </button>
        </div>
      </AppModalBody>
    </AppModal>
  )
}
