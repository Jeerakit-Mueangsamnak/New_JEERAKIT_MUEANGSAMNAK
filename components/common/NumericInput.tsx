'use client'

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { NumericKeypadPopover, useCoarsePointer, type KeypadKey } from './NumericKeypadPopover'

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max'> {
  value: number | string | undefined | null
  onChange: (value: number | '') => void
  min?: number
  max?: number
  allowDecimals?: boolean
  defaultValueOnBlur?: number
  allowNegative?: boolean
  /** On touch screens (iPad), type with the on-screen number pad above the box instead of the device keyboard. */
  touchKeypad?: boolean
}

/** What the box shows for a value: nothing for empty or 0 (owner 2026-11-07: an unfilled box is blank, never a 0). */
const displayText = (value: number | string | undefined | null): string =>
  value === null || value === undefined || value === '' || Number(value) === 0 ? '' : String(value)

export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput(
    {
      value,
      onChange,
      min,
      max,
      allowDecimals = true,
      defaultValueOnBlur,
      allowNegative = false,
      touchKeypad = false,
      onBlur,
      onKeyDown,
      className = '',
      placeholder = '',
      ...rest
    },
    ref
  ) {
    const isControlled = value !== undefined
    const initialText = displayText(value)

    const [rawText, setRawText] = useState<string>(initialText)
    const isFocusedRef = useRef(false)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const setRefs = (el: HTMLInputElement | null) => {
      inputRef.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    }
    const coarsePointer = useCoarsePointer()
    const keypadEnabled = touchKeypad && coarsePointer
    const [keypadOpen, setKeypadOpen] = useState(false)
    const pendingCaretRef = useRef<number | null>(null)
    // Bumped on every accepted keypad press so the caret is placed even when the text did not change
    // (e.g. the box shows "1", focus selects it, and the user taps "1" again).
    const [keypadPress, setKeypadPress] = useState(0)

    // Put the caret back where the last keypad press left it (React resets it to the end).
    useLayoutEffect(() => {
      const caret = pendingCaretRef.current
      if (caret === null) return
      pendingCaretRef.current = null
      try {
        inputRef.current?.setSelectionRange(caret, caret)
      } catch {
        // The box may have lost focus or been removed before this ran; nothing to restore.
      }
    }, [rawText, keypadPress])

    // Synchronize external value changes ONLY when not focused (rawText is the single source of truth while typing)
    useEffect(() => {
      if (!isControlled) return

      const formattedVal = displayText(value)

      if (!isFocusedRef.current) {
        setRawText(formattedVal)
      }
    }, [value, isControlled])

    /** Validates typed text; returns false when it was rejected. */
    const applyText = (val: string): boolean => {
      // Allow empty string while typing
      if (val === '') {
        setRawText('')
        onChange('')
        return true
      }

      // Allow typing single negative sign if negative is allowed
      if (allowNegative && val === '-') {
        setRawText('-')
        onChange('')
        return true
      }

      // Regex validation based on decimal settings
      const pattern = allowDecimals
        ? allowNegative
          ? /^-?\d*\.?\d*$/
          : /^\d*\.?\d*$/
        : allowNegative
        ? /^-?\d*$/
        : /^\d*$/

      if (!pattern.test(val)) {
        return false // reject non-matching characters
      }

      setRawText(val)

      // If typing incomplete decimal e.g. "10.", do not parse yet for parent if not valid number, or pass current float
      if (val.endsWith('.')) {
        const num = parseFloat(val)
        if (!isNaN(num)) {
          onChange(num)
        }
        return true
      }

      const num = parseFloat(val)
      if (!isNaN(num)) {
        onChange(num)
      }
      return true
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      applyText(e.target.value)
    }

    const handleKeypadKey = (key: KeypadKey) => {
      const el = inputRef.current
      const start = el?.selectionStart ?? rawText.length
      const end = el?.selectionEnd ?? rawText.length
      let next: string
      let caret: number
      if (key === 'backspace') {
        if (start !== end) {
          next = rawText.slice(0, start) + rawText.slice(end)
          caret = start
        } else if (start > 0) {
          next = rawText.slice(0, start - 1) + rawText.slice(end)
          caret = start - 1
        } else {
          return
        }
      } else {
        next = rawText.slice(0, start) + key + rawText.slice(end)
        caret = start + 1
      }
      if (applyText(next)) {
        pendingCaretRef.current = caret
        setKeypadPress((n) => n + 1)
      }
    }

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      isFocusedRef.current = false
      setKeypadOpen(false)

      if (rawText === '' || rawText === '-') {
        if (defaultValueOnBlur !== undefined) {
          setRawText(displayText(defaultValueOnBlur))
          onChange(defaultValueOnBlur)
        } else {
          setRawText('')
          onChange('')
        }
      } else {
        let parsed = parseFloat(rawText)
        if (isNaN(parsed)) {
          const fallback = defaultValueOnBlur !== undefined ? defaultValueOnBlur : ''
          setRawText(displayText(fallback))
          onChange(fallback)
        } else {
          if (!allowDecimals) parsed = Math.floor(parsed)
          if (min !== undefined && parsed < min) parsed = min
          if (max !== undefined && parsed > max) parsed = max
          setRawText(displayText(parsed))
          onChange(parsed)
        }
      }

      if (onBlur) {
        onBlur(e)
      }
    }

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      isFocusedRef.current = true
      if (keypadEnabled) setKeypadOpen(true)
      // Auto-select text on focus so user can immediately type to replace without appending
      try {
        e.currentTarget.select()
      } catch {}
      if (rest.onFocus) {
        rest.onFocus(e)
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur()
      }
      if (onKeyDown) {
        onKeyDown(e)
      }
    }

    return (
      <>
      <input
        ref={setRefs}
        type="text"
        // 'none' keeps the device keyboard closed; the on-screen pad below does the typing.
        inputMode={keypadEnabled ? 'none' : allowDecimals ? 'decimal' : 'numeric'}
        value={rawText}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        {...rest}
      />
      {keypadEnabled && keypadOpen && (
        <NumericKeypadPopover
          anchorRef={inputRef}
          allowDecimal={allowDecimals}
          onKey={handleKeypadKey}
          onDismiss={() => inputRef.current?.blur()}
        />
      )}
      </>
    )
  }
)
