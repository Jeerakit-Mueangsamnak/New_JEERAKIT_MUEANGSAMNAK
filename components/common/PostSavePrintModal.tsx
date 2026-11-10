'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React from 'react'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
import { CheckCircle2, Printer, X } from 'lucide-react'

export interface PostSavePrintModalProps {
  isOpen: boolean
  title: string
  description: string
  printButtonText?: string
  closeButtonText?: string
  onPrint: () => void
  onClose: () => void
}

export function PostSavePrintModal({
  isOpen,
  title,
  description,
  printButtonText = 'พิมพ์',
  closeButtonText = 'ออก',
  onPrint,
  onClose,
}: PostSavePrintModalProps) {
  return (
    <AppModal isOpen={isOpen} onClose={onClose} size="sm">
      <AppModalHeader
        onClose={onClose}
        icon={<CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />}
        title={title}
      />

      <AppModalBody className="space-y-4 text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
          <CheckCircle2 className="w-9 h-9" />
        </div>

        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-line">
          {description}
        </p>
      </AppModalBody>

      <AppModalFooter>
        <div className="grid grid-cols-2 gap-2.5 w-full">
          <button
            type="button"
            onClick={onClose}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-[0.99] transition-all flex items-center justify-center cursor-pointer`}
          >
            <X className="w-4 h-4" />
            <span>{closeButtonText}</span>
          </button>

          <button
            type="button"
            onClick={onPrint}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center cursor-pointer`}
          >
            <Printer className="w-4 h-4" />
            <span>{printButtonText}</span>
          </button>
        </div>
      </AppModalFooter>
    </AppModal>
  )
}
