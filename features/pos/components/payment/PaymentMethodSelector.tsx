'use client'

import React, { useEffect, useMemo } from 'react'
import { Banknote, QrCode, ShieldAlert } from 'lucide-react'

// The screens offer three buttons: เงินสด, QR Code, ค้างชำระ ('TRANSFER' stays in the type for saved bills).
export type PaymentMethodType = 'CASH' | 'TRANSFER' | 'QR' | 'UNPAID'

interface PaymentMethodSelectorProps {
  selectedMethod: PaymentMethodType | null
  onSelectMethod: (method: PaymentMethodType) => void
  disabled?: boolean
  showPromptPay?: boolean
  autoSelectFirst?: boolean
  className?: string
  /** Hide the "เลือกช่องทางการชำระเงิน" caption. */
  showLabel?: boolean
  /** Buttons per row; omit for 2 columns. All buttons share the same size. */
  itemsPerRow?: number
  /** Override the button captions, e.g. { TRANSFER: 'เงินโอน' }. */
  labels?: Partial<Record<PaymentMethodType, string>>
}

export function PaymentMethodSelector({
  selectedMethod,
  onSelectMethod,
  disabled = false,
  showPromptPay = true,
  autoSelectFirst = true,
  className = '',
  showLabel = true,
  itemsPerRow,
  labels,
}: PaymentMethodSelectorProps) {
  const methods = {
    cash: true,
    promptPay: showPromptPay,
    credit: true,
  }

  const enabledList = useMemo(() => {
    const list: { key: PaymentMethodType; label: string; icon: React.ReactNode; activeClass: string }[] = []
    if (methods.cash) {
      list.push({
        key: 'CASH',
        label: 'เงินสด',
        icon: <Banknote className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-emerald-700 dark:text-emerald-400 shrink-0" />,
        activeClass: 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 shadow-sm',
      })
    }
    if (methods.promptPay) {
      list.push({
        key: 'QR',
        label: 'QR Code',
        icon: <QrCode className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-purple-600 dark:text-purple-400 shrink-0" />,
        activeClass: 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 shadow-sm',
      })
    }
    if (methods.credit) {
      list.push({
        key: 'UNPAID',
        label: 'ค้างชำระ',
        icon: <ShieldAlert className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-amber-700 dark:text-amber-400 shrink-0" />,
        activeClass: 'border-amber-500 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 shadow-sm',
      })
    }
    return list
  }, [methods.cash, methods.promptPay, methods.credit])

  const shownList = useMemo(
    () => enabledList.map((item) => ({ ...item, label: labels?.[item.key] ?? item.label })),
    [enabledList, labels]
  )

  useEffect(() => {
    if (autoSelectFirst && enabledList.length > 0 && !enabledList.some((item) => item.key === selectedMethod)) {
      onSelectMethod(enabledList[0].key)
    }
  }, [autoSelectFirst, enabledList, selectedMethod, onSelectMethod])

  return (
    <div className={`space-y-1.5 ${className}`}>
      {showLabel && (
        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
          เลือกช่องทางการชำระเงิน
        </label>
      )}

      <div
        className={`grid min-w-0 gap-1.5 sm:gap-2 ${itemsPerRow ? '' : 'grid-cols-2'}`}
        style={itemsPerRow ? { gridTemplateColumns: `repeat(${itemsPerRow}, minmax(0, 1fr))` } : undefined}
      >
        {shownList.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelectMethod(item.key)}
            className={`p-2 sm:p-2.5 rounded-xl border-2 font-bold text-xs flex items-center justify-center gap-1.5 sm:gap-2 transition-all min-h-[44px] ${
              selectedMethod === item.key
                ? item.activeClass
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {item.icon}
            <span className="min-w-0 truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
