'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle, Info } from 'lucide-react'

/**
 * In-app replacement for window.confirm / window.alert.
 * `const confirm = useConfirm(); if (await confirm({ title: '…' })) { … }`
 * `const notice = useNotice(); await notice({ title: '…' })`
 * `const ask = useAskText(); const reason = await ask({ title: 'เหตุผล…' })` → string | null
 */
export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button for destructive actions (delete, reset). */
  danger?: boolean
  /** Amber confirm button for ระงับ (suspend): reversible, history kept. */
  warning?: boolean
}

export interface AskTextOptions extends ConfirmOptions {
  placeholder?: string
  /** Empty answers are not accepted (default true). */
  required?: boolean
}

interface Pending {
  opts: AskTextOptions
  alertOnly: boolean
  askText?: boolean
  resolve: (ok: boolean, text?: string) => void
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

type AskTextFn = (opts: AskTextOptions) => Promise<string | null>

const ConfirmContext = createContext<{
  confirm: ConfirmFn
  notice: (opts: ConfirmOptions) => Promise<void>
  askText: AskTextFn
} | null>(null)

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [text, setText] = useState('')
  const confirmRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setPending({ opts, alertOnly: false, resolve })),
    []
  )
  const notice = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<void>((resolve) => setPending({ opts, alertOnly: true, resolve: () => resolve() })),
    []
  )

  const askText = useCallback<AskTextFn>(
    (opts) =>
      new Promise<string | null>((resolve) => {
        setText('')
        setPending({ opts, alertOnly: false, askText: true, resolve: (ok, t) => resolve(ok ? (t ?? '') : null) })
      }),
    []
  )

  const required = pending?.askText && pending.opts.required !== false
  const close = useCallback(
    (ok: boolean) => {
      if (ok && required && !text.trim()) {
        inputRef.current?.focus()
        return
      }
      pending?.resolve(ok, text.trim())
      setPending(null)
    },
    [pending, required, text]
  )

  useEffect(() => {
    if (!pending) return
    setTimeout(() => (pending.askText ? inputRef.current : confirmRef.current)?.focus(), 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Answers "no" to this question only; the modal behind it stays open
      e.preventDefault()
      close(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [pending, close])

  const o = pending?.opts
  const Icon = pending?.alertOnly ? Info : o?.danger ? AlertTriangle : HelpCircle

  return (
    <ConfirmContext.Provider value={{ confirm, notice, askText }}>
      {children}
      {pending && o && (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="app-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) close(false)
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <Icon
                className={`w-5 h-5 shrink-0 mt-0.5 ${
                  o.danger ? 'text-red-700 dark:text-red-400' : pending.alertOnly ? 'text-blue-600 dark:text-blue-400' : 'text-amber-700 dark:text-amber-400'
                }`}
              />
              <div className="min-w-0">
                <h3 id="app-confirm-title" className="font-bold text-sm text-slate-900 dark:text-white">
                  {o.title}
                </h3>
                {o.message && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 whitespace-pre-line">{o.message}</p>
                )}
              </div>
            </div>
            {pending.askText && (
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder={o.placeholder || 'ระบุเหตุผล'}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            )}
            <div className="flex justify-end gap-2">
              {!pending.alertOnly && (
                <button
                  type="button"
                  onClick={() => close(false)}
                  className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800`}
                >
                  {o.cancelLabel || 'ยกเลิก'}
                </button>
              )}
              <button
                ref={confirmRef}
                type="button"
                onClick={() => close(true)}
                disabled={Boolean(required && !text.trim())}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} disabled:opacity-50 ${
                  o.danger
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : o.warning
                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-900'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {o.confirmLabel || (pending.alertOnly ? 'ตกลง' : 'ยืนยัน')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmDialogProvider')
  return ctx.confirm
}

export function useNotice(): (opts: ConfirmOptions) => Promise<void> {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useNotice must be used inside ConfirmDialogProvider')
  return ctx.notice
}

export function useAskText(): AskTextFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useAskText must be used inside ConfirmDialogProvider')
  return ctx.askText
}
