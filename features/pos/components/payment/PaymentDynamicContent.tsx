'use client'

import React, { useEffect, useRef } from 'react'
import Image from 'next/image'
import { AlertCircle, CheckCircle2, Maximize2, QrCode, RefreshCw, X } from 'lucide-react'
import { PaymentMethodType } from './PaymentMethodSelector'
import { NumericInput } from '@/components/common/NumericInput'
import type { SplitState } from '@/features/pos/hooks/useSplitPayment'

const METHOD_LABEL = { CASH: 'เงินสด', QR: 'QR Code' } as const
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 })

interface PaymentDynamicContentProps {
  paymentMethod: PaymentMethodType
  targetAmount: number
  receivedCashInput: string
  onReceivedCashInputChange: (value: string) => void
  changeAmount: number
  bankRef: string
  onBankRefChange: (value: string) => void
  qrCodeUrl?: string
  bankQrUrl?: string
  isQrLoading?: boolean
  qrError?: string | null
  onRetryQr?: () => void
  promptPayId?: string
  unpaidMessage?: React.ReactNode
  className?: string
  /** Shows "ยืนยัน" beside the cash box (pop-up only, records nothing); false = แก้ไข, back to the box. */
  onConfirmCash?: () => Promise<boolean>
  cashConfirmed?: boolean
  /** เงินสด + QR Code: the order pressed and the first part once taken (the rest is `targetAmount`). */
  split?: SplitState | null
  onClearSplit?: () => void
  /** Changes each time the cash box should take the focus (back to the amount). */
  focusCashSignal?: number
  /** The cash box may be confirmed empty (= exactly `targetAmount`). */
  cashConfirmEmptyAllowed?: boolean
  /** QR Code: open the QR in the middle of the screen again. */
  onOpenQr?: () => void
}

export function PaymentDynamicContent({
  paymentMethod,
  targetAmount,
  receivedCashInput,
  onReceivedCashInputChange,
  changeAmount,
  bankRef,
  onBankRefChange,
  qrCodeUrl,
  bankQrUrl,
  isQrLoading = false,
  qrError,
  onRetryQr,
  promptPayId,
  unpaidMessage,
  className = '',
  onConfirmCash,
  cashConfirmed = false,
  split = null,
  onClearSplit,
  onOpenQr,
  focusCashSignal = 0,
  cashConfirmEmptyAllowed = false,
}: PaymentDynamicContentProps) {
  const displayQr = qrCodeUrl || bankQrUrl
  const cashInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusCashSignal === 0) return
    cashInputRef.current?.focus()
    cashInputRef.current?.select()
  }, [focusCashSignal])
  const cashEmpty = receivedCashInput === '' && !cashConfirmEmptyAllowed
  const handleConfirmCash = async () => {
    if (!onConfirmCash || cashEmpty) return
    if (!(await onConfirmCash())) {
      cashInputRef.current?.focus()
      cashInputRef.current?.select()
    }
  }
  return (
    <div className={`shrink-0 ${className}`}>
      {split && (
        <div className="mb-1.5 flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/80 px-2 py-1.5 text-xs dark:border-blue-900/60 dark:bg-blue-950/40">
          <span className="font-semibold text-blue-800 dark:text-blue-200">
            {split.part ? (
              <>
                รับแล้ว: {METHOD_LABEL[split.part.method]} <span className="font-black tabular-nums">{baht(split.part.amount)}</span>
                {' · '}ส่วนที่เหลือ <span className="font-black tabular-nums">{baht(targetAmount)}</span> บาท ({METHOD_LABEL[split.order[1]]})
                {split.qrReceived && ' ✓ ได้รับแล้ว'}
              </>
            ) : (
              <>
                จ่าย 2 ช่องทาง: {METHOD_LABEL[split.order[0]]}ก่อน แล้วต่อด้วย {METHOD_LABEL[split.order[1]]}
              </>
            )}
          </span>
          {onClearSplit && (
            <button
              type="button"
              onClick={onClearSplit}
              className="shrink-0 flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/50 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> ยกเลิก
            </button>
          )}
        </div>
      )}
      {paymentMethod === 'CASH' && (
        <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50/80 p-2 dark:border-slate-700 dark:bg-slate-900/50">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-0.5">
              เงินสดที่รับมา (บาท)
            </label>
            <div className="flex items-stretch gap-2">
              <NumericInput
                ref={cashInputRef}
                value={receivedCashInput}
                onChange={(val) => onReceivedCashInputChange(val === '' ? '' : String(val))}
                min={0}
                placeholder={targetAmount > 0 ? targetAmount.toString() : '0'}
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-base font-extrabold text-slate-900 focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 sm:text-lg tabular-nums"
              />
              {onConfirmCash && (
                <button
                  type="button"
                  onClick={() => void handleConfirmCash()}
                  disabled={cashEmpty}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-3 text-xs sm:text-sm font-bold flex items-center gap-1 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                    cashConfirmed && (receivedCashInput !== '' || cashConfirmEmptyAllowed)
                      ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-emerald-700 text-white hover:bg-emerald-800'
                  }`}
                >
                  {cashConfirmed && (receivedCashInput !== '' || cashConfirmEmptyAllowed) ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" /> ยืนยันแล้ว
                    </>
                  ) : (
                    'ยืนยัน'
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-slate-200 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">เงินทอน</span>
            <span className="text-base sm:text-lg font-black text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">
              {changeAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}

      {paymentMethod === 'TRANSFER' && (
        <div className="bg-slate-50/80 dark:bg-slate-900/50 p-2 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1 text-xs">
          <div>
            <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-0.5 text-[11px]">
              เลขอ้างอิง / สลิปโอนเงิน
            </label>
            <input
              type="text"
              placeholder="กรอกเลขอ้างอิงธนาคาร..."
              value={bankRef}
              onChange={(e) => onBankRefChange(e.target.value)}
              className="w-full px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
            />
          </div>
        </div>
      )}

      {paymentMethod === 'QR' && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-purple-200 bg-purple-50/50 p-2 dark:border-purple-900/40 dark:bg-purple-950/30 text-center">
          {qrError ? (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-red-700 dark:text-red-300 text-xs space-y-2 w-full">
              <div className="flex items-center justify-center gap-1.5 font-bold">
                <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400" />
                <span>ไม่สามารถสร้าง QR Payment ได้</span>
              </div>
              <p className="text-[11px] text-red-700 dark:text-red-400">{qrError}</p>
              <div className="flex items-center justify-center gap-2 pt-1">
                {onRetryQr && (
                  <button
                    type="button"
                    onClick={onRetryQr}
                    className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" /> ลองใหม่อีกครั้ง
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex aspect-square w-24 h-24 sm:w-28 sm:h-28 max-w-[120px] max-h-[120px] items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-sm">
                {isQrLoading ? (
                  <div className="flex flex-col items-center justify-center text-slate-600 dark:text-slate-400 gap-1">
                    <RefreshCw className="w-5 h-5 animate-spin text-purple-600 dark:text-purple-400" />
                    <span className="text-[10px]">กำลังสร้าง QR...</span>
                  </div>
                ) : displayQr ? (
                  <Image
                    src={displayQr}
                    alt="QR Code"
                    width={120}
                    height={120}
                    unoptimized
                    className="w-full h-full object-contain rounded"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-600 dark:text-slate-400 text-xs">
                    <QrCode className="w-6 h-6 text-slate-300 mb-1" />
                    <span>พื้นที่แสดง QR Code</span>
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 font-semibold whitespace-nowrap">
                {promptPayId ? `PromptPay: ${promptPayId}` : bankQrUrl ? 'QR Code รับเงิน' : 'ยังไม่ได้ตั้งค่า QR Code รับเงิน'}
              </span>
              {onOpenQr && (
                <button
                  type="button"
                  onClick={onOpenQr}
                  className="mt-1 flex items-center gap-1 rounded-lg border border-purple-300 bg-white px-2.5 py-1 text-[11px] font-bold text-purple-700 hover:bg-purple-50 dark:border-purple-800 dark:bg-slate-900 dark:text-purple-300 dark:hover:bg-purple-950/50 cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" /> แสดง QR กลางจอ ({targetAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท)
                </button>
              )}
            </>
          )}
        </div>
      )}

      {paymentMethod === 'UNPAID' && (
        <div className="bg-amber-50/80 dark:bg-amber-950/40 p-2 rounded-xl border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 leading-snug">
          {unpaidMessage || (
            <>
              ⚠️ บิลนี้จะถูกตั้งเป็น <strong>&quot;ค้างชำระ&quot;</strong> ยอดคงค้าง {targetAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} จะแสดงในระบบรายงานลูกหนี้
            </>
          )}
        </div>
      )}
    </div>
  )
}
