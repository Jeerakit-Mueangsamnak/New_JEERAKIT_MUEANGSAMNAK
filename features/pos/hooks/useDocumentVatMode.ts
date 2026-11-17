'use client'

import { useCallback, useState } from 'react'
import { type VatMode } from '@/features/pos/components/VatModeButtons'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'

const asMode = (m: unknown): VatMode | null => (m === 'INCLUSIVE' || m === 'EXCLUSIVE' ? m : null)

/**
 * รวม / ไม่รวม VAT of one document (POS cart, payment page, quotation page — was copied in all three).
 * A document saved before the VAT buttons, with VAT on but no mode of its own, keeps the shop's price mode until
 * a button is pressed (owner 2026-11-04: the mode is each document's own; Settings keeps the rate).
 */
export function useDocumentVatMode(initial?: { mode?: VatMode | null; vatEnabled?: boolean }) {
  const { settings } = useSystemSettings()
  const [mode, setMode] = useState<VatMode | null>(asMode(initial?.mode))
  const [legacyOn, setLegacyOn] = useState<boolean>(Boolean(initial?.vatEnabled) && !initial?.mode)

  /** The mode in use: the button pressed, else the shop's price mode for an old document that had VAT on. */
  const effective: VatMode | null = mode ?? (legacyOn ? settings.taxDiscount?.vatMode ?? null : null)

  /** Takes the VAT state of a loaded document (saved cart, quotation, draft bill). */
  const load = useCallback((savedMode: unknown, vatEnabled: boolean | undefined) => {
    setMode(asMode(savedMode))
    setLegacyOn(vatEnabled === true && !savedMode)
  }, [])

  /** A VAT button: pressing the mode in use turns VAT off. */
  const toggle = (next: VatMode) => {
    setLegacyOn(false)
    setMode(effective === next ? null : next)
  }

  const clear = useCallback(() => {
    setMode(null)
    setLegacyOn(false)
  }, [])

  return { mode, effective, load, toggle, clear }
}
