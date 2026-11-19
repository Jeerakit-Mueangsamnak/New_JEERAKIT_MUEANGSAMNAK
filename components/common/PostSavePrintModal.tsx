'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React, { useEffect, useRef, useState } from 'react'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
import { useToast } from '@/components/common/Toast'
import { printFormPages } from '@/features/documents/utils/transaction-print'
import { preparePrintPictures, printsThroughShareSheet } from '@/lib/print/print-service'
import { sharePrintPictures } from '@/lib/print/print-share-images'
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

  // iPad / iPhone web app from the Home Screen icon: the ticked forms are turned into pictures while this
  // window is open, so "พิมพ์" opens the share sheet right on the tap; its "พิมพ์" opens the iPad print
  // window with its preview (owner 2026-11-19). Per form; null = the pictures could not be made.
  const [shareSheet, setShareSheet] = useState(false)
  useEffect(() => setShareSheet(printsThroughShareSheet()), [])
  const pictures = useRef(new Map<string, { pages: string[]; files: File[] | null }>())
  const making = useRef(new Set<string>())
  const [, setPicturesReady] = useState(0)
  const selectedForms = printable.filter((f) => selected.includes(f.name))
  const picturesOf = (f: PrintFormChoice) => {
    const made = pictures.current.get(f.name)
    return made && made.pages === f.pages ? made : undefined
  }

  useEffect(() => {
    if (!isOpen) {
      pictures.current.clear()
      return
    }
    if (!shareSheet) return
    for (const f of forms) {
      if (!selected.includes(f.name) || f.pages.length === 0 || picturesOf(f) || making.current.has(f.name)) continue
      making.current.add(f.name)
      const pages = f.pages
      preparePrintPictures(pages, printTitle ? `${printTitle} ${f.name}` : f.name)
        .catch((error) => {
          console.error('[print] pictures for the share sheet failed', error)
          return null
        })
        .then((files) => {
          making.current.delete(f.name)
          pictures.current.set(f.name, { pages, files })
          setPicturesReady((n) => n + 1)
        })
    }
  })

  const preparing = shareSheet && selectedForms.some((f) => !picturesOf(f))

  const print = async () => {
    const pages = selectedForms.flatMap((f) => f.pages)
    if (pages.length === 0) {
      showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
      return
    }
    if (shareSheet) {
      const files = selectedForms.flatMap((f) => picturesOf(f)?.files ?? [])
      const ready = selectedForms.every((f) => picturesOf(f)?.files)
      if (ready) {
        const result = await sharePrintPictures(files)
        if (result === 'shared') onPrinted?.()
        if (result !== 'failed') return
      }
      // Pictures not made / the sheet did not open: the central print makes them again with its own window.
    }
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
            className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-[0.99] transition-all flex items-center justify-center cursor-pointer`}
          >
            <X className="w-4 h-4" />
            <span>{closeButtonText}</span>
          </button>

          <button
            type="button"
            onClick={() => void print()}
            disabled={loading || selected.length === 0 || preparing}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} w-full bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Printer className="w-4 h-4" />
            <span>{preparing ? 'กำลังเตรียม...' : printButtonText}</span>
          </button>
        </div>
      </AppModalFooter>
    </AppModal>
  )
}
