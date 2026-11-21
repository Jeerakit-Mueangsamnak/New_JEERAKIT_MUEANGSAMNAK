'use client'
import { COMMAND_BUTTON_SIZE_CLASSES, BUTTON_FUNCTION_COLOURS } from '@/components/common/ActionButton'

import React, { useEffect, useState } from 'react'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
import { useToast } from '@/components/common/Toast'
import { printFormPages } from '@/features/documents/utils/transaction-print'
import { CheckCircle2, Printer, X } from 'lucide-react'

/** One shop form offered for printing, already filled with the document's data (empty = nothing to print on it). */
export interface PrintFormChoice {
  name: string
  pages: string[]
}

export interface PostSavePrintModalProps {
  isOpen: boolean
  title: string
  /** 'saved' = after ออกบิล (check icon); 'print' = the printer icon of a bill row. */
  variant?: 'saved' | 'print'
  forms: PrintFormChoice[]
  /** Forms ticked when the window opens (e.g. the form picked in the cart). */
  defaultSelected?: string[]
  /** Forms still being read from the server. */
  loading?: boolean
  printTitle?: string
  printButtonText?: string
  closeButtonText?: string
  /** After the chosen forms were sent to the printer. */
  onPrinted?: () => void
  onClose: () => void
}

/**
 * The one print window of the bill flows (owner 2026-11-12): POS ออกบิล, จัดการบิล ออกบิล and the printer
 * icon of a bill row. Lists the shop's bill forms with a tick each (เลือกทั้งหมด, เลือกแล้ว x / n) and prints
 * the ticked ones together.
 */
export function PostSavePrintModal({
  isOpen,
  title,
  variant = 'saved',
  forms,
  defaultSelected = [],
  loading = false,
  printTitle,
  printButtonText = 'พิมพ์',
  closeButtonText = 'ออก',
  onPrinted,
  onClose,
}: PostSavePrintModalProps) {
  const { showToast } = useToast()
  const printable = forms.filter((f) => f.pages.length > 0)
  const [selected, setSelected] = useState<string[]>([])
  const formKey = printable.map((f) => f.name).join('|')
  const defaultKey = defaultSelected.join('|')

  // Each opening starts from the suggested forms that can be printed
  useEffect(() => {
    if (!isOpen) return
    const names = new Set(formKey ? formKey.split('|') : [])
    setSelected((defaultKey ? defaultKey.split('|') : []).filter((n) => names.has(n)))
  }, [isOpen, formKey, defaultKey])

  const allSelected = printable.length > 0 && printable.every((f) => selected.includes(f.name))
  const toggle = (name: string) => setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  const toggleAll = () => setSelected(allSelected ? [] : printable.map((f) => f.name))

  // Printed through the central print like ตั้งค่า › เทมเพลต › คลังแบบฟอร์ม: on the iPad Home Screen icon it shows
  // "กำลังเตรียมเอกสาร..." then the share sheet, with the pages on the shop form exactly as printed
  // (owner 2026-11-20: pictures made ahead here missed the form page and came out wrong).
  const print = () => {
    const pages = printable.filter((f) => selected.includes(f.name)).flatMap((f) => f.pages)
    if (!printFormPages(pages, printTitle)) {
      showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
      return
    }
    onPrinted?.()
  }

  return (
    <AppModal isOpen={isOpen} onClose={onClose} size="sm">
      <AppModalHeader
        onClose={onClose}
        icon={
          variant === 'print' ? (
            <Printer className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
          )
        }
        title={title}
      />

      <AppModalBody className="space-y-2">
        {loading ? (
          <p className="text-xs text-slate-600 dark:text-slate-400 text-center py-4">กำลังโหลดแบบฟอร์ม...</p>
        ) : forms.length === 0 ? (
          <p className="text-xs text-slate-600 dark:text-slate-400 text-center py-4">ยังไม่มีแบบฟอร์มบิล กรุณาเพิ่มที่ ตั้งค่าระบบ › เทมเพลต</p>
        ) : (
          <>
            <div className="flex items-center justify-between py-1 px-1 text-xs border-b border-slate-200 dark:border-slate-700">
              <label className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={printable.length === 0}
                  className="w-3.5 h-3.5 rounded enabled:cursor-pointer"
                />
                <span>เลือกทั้งหมด</span>
              </label>
              <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                เลือกแล้ว {selected.length} / {printable.length}
              </span>
            </div>
            <div role="list" aria-label="แบบฟอร์มที่จะพิมพ์" className="divide-y divide-slate-100 dark:divide-slate-700/60 max-h-[50vh] overflow-y-auto pr-1">
              {forms.map((f) => {
                const can = f.pages.length > 0
                return (
                  <label
                    key={f.name}
                    role="listitem"
                    className={`py-2 px-1.5 flex items-center gap-2 rounded-lg ${
                      can ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40' : 'opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`เลือก ${f.name}`}
                      checked={selected.includes(f.name)}
                      onChange={() => toggle(f.name)}
                      disabled={!can}
                      className="w-3.5 h-3.5 rounded shrink-0 enabled:cursor-pointer"
                    />
                    <span className="font-bold text-slate-900 dark:text-slate-100 text-[11px]">{f.name}</span>
                  </label>
                )
              })}
            </div>
          </>
        )}
      </AppModalBody>

      <AppModalFooter>
        <div className="grid grid-cols-2 gap-2.5 w-full">
          <button
            type="button"
            onClick={onClose}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full border active:scale-[0.99] transition-all flex items-center justify-center cursor-pointer ${BUTTON_FUNCTION_COLOURS.cancel}`}
          >
            <X className="w-4 h-4" />
            <span>{closeButtonText}</span>
          </button>

          <button
            type="button"
            onClick={print}
            disabled={loading || selected.length === 0}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Printer className="w-4 h-4" />
            <span>{printButtonText}</span>
          </button>
        </div>
      </AppModalFooter>
    </AppModal>
  )
}
