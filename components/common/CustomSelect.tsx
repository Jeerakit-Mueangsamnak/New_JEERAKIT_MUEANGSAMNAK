'use client'

import React, { useState, useRef, useEffect, useId } from 'react'
import { ChevronDown, Check, Search, Trash2 } from 'lucide-react'
import { useClickOutside } from '@/lib/hooks/useClickOutside'
import { useFloatingPlacement } from '@/lib/hooks/useFloatingPlacement'
import { ModalPortal } from '@/components/common/ModalPortal'

export interface SelectOption {
  value: string | number
  label: string
  sublabel?: string
}

interface CustomSelectProps {
  value: string | number
  onChange: (value: any) => void
  options: SelectOption[]
  placeholder?: string
  align?: 'left' | 'right'
  direction?: 'down' | 'up'
  className?: string
  buttonClassName?: string
  disabled?: boolean
  searchable?: boolean
  emptyText?: string
  hideChevron?: boolean
  /** Weight of the placeholder text; default is normal. Use font-bold when the placeholder is the field's name. */
  placeholderClassName?: string
  /** Accessible name when no visible <label> names the field. */
  ariaLabel?: string
  /** When given, each option gets a bin icon at its end that removes that option. */
  onRemoveOption?: (value: string | number) => void
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = '-- เลือกรายการ --',
  align = 'left',
  className = '',
  buttonClassName = '',
  disabled = false,
  searchable = false,
  emptyText = 'ยังไม่มีรายการ',
  hideChevron = false,
  placeholderClassName = 'font-normal',
  ariaLabel,
  onRemoveOption,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  /** Option the arrow keys are on (index in the shown list), -1 = none. */
  const [highlight, setHighlight] = useState(-1)
  const listId = useId()

  const { coords, placement } = useFloatingPlacement(triggerRef, isOpen, {
    align,
    matchTriggerWidth: true,
    estimatedHeight: 240,
    offset: 4,
  })

  // Find selected option
  const selectedOption = options.find((opt) => String(opt.value) === String(value))

  // Close on click outside (Mouse & Touch/iPad)
  useClickOutside([triggerRef, popoverRef], () => setIsOpen(false), isOpen)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Closes only this list, not the modal it sits in
      e.preventDefault()
      setIsOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen])

  const handleSelect = (val: string | number) => {
    onChange(val)
    setSearchTerm('')
    setIsOpen(false)
  }

  const filteredOptions = searchable && searchTerm.trim()
    ? options.filter((option) => {
        const query = searchTerm.trim().toLocaleLowerCase()
        return `${option.label} ${option.sublabel || ''}`.toLocaleLowerCase().includes(query)
      })
    : options

  // Opening starts on the chosen option (or the first); typing a search starts on the first match.
  const selectedIndex = filteredOptions.findIndex((opt) => String(opt.value) === String(value))
  useEffect(() => {
    if (isOpen) setHighlight(searchTerm.trim() ? 0 : Math.max(0, selectedIndex))
    else setHighlight(-1)
    // selectedIndex is read only when the list opens or the search changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, searchTerm])

  useEffect(() => {
    if (!isOpen || highlight < 0) return
    const el = document.getElementById(`${listId}-${highlight}`)
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [isOpen, highlight, listId])

  // Keyboard: ↓/↑ open the list and move, Home/End jump, Enter/Space pick, Tab closes.
  const handleListKeys = (e: React.KeyboardEvent) => {
    if (disabled) return
    const count = filteredOptions.length
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSearchTerm('')
        setIsOpen(true)
      }
      return
    }
    const move = (to: number) => {
      e.preventDefault()
      if (count > 0) setHighlight(Math.min(count - 1, Math.max(0, to)))
    }
    if (e.key === 'ArrowDown') move(highlight + 1)
    else if (e.key === 'ArrowUp') move(highlight - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(count - 1)
    else if (e.key === 'Enter' || (e.key === ' ' && e.target === triggerRef.current)) {
      e.preventDefault()
      const opt = filteredOptions[highlight]
      if (opt) handleSelect(opt.value)
    } else if (e.key === 'Tab') setIsOpen(false)
  }

  return (
    <div className={`relative inline-block min-w-0 w-full ${className}`}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={isOpen && highlight >= 0 && filteredOptions[highlight] ? `${listId}-${highlight}` : undefined}
        onKeyDown={handleListKeys}
        // Space on an open list picks on keydown; stop the button's own click on keyup
        onKeyUp={(e) => { if (e.key === ' ' && isOpen) e.preventDefault() }}
        onClick={() => !disabled && setIsOpen((prev) => {
          if (!prev) setSearchTerm('')
          return !prev
        })}
        className={`w-full min-w-0 ${buttonClassName ? buttonClassName : 'h-9 px-2.5 py-0 rounded-xl'} border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-bold flex items-center justify-between gap-1.5 focus:ring-2 focus:ring-emerald-500 focus:outline-none shadow-xs transition-all text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-slate-300 dark:hover:border-slate-600'
        }`}
      >
        <span className="truncate flex-1">
          {selectedOption ? (
            <span>
              {selectedOption.label}
              {selectedOption.sublabel && (
                <span className="text-slate-600 dark:text-slate-400 font-normal ml-1.5 text-[11px]">
                  ({selectedOption.sublabel})
                </span>
              )}
            </span>
          ) : (
            <span className={`text-slate-600 dark:text-slate-400 ${placeholderClassName}`}>
              {options.length === 0 && placeholder === '-- เลือกรายการ --' ? emptyText : placeholder || '\u00A0'}
            </span>
          )}
        </span>
        {!hideChevron && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0 transition-transform duration-200 ${
              isOpen ? (placement === 'top' ? '-rotate-180 text-emerald-700 dark:text-emerald-400' : 'rotate-180 text-emerald-700 dark:text-emerald-400') : ''
            }`}
          />
        )}
      </button>

      {/* Popover Dropdown List (Smart Placement via Portal) */}
      {isOpen && (
        <ModalPortal>
          <div
            ref={popoverRef}
            id={listId}
            role="listbox"
            style={{
              position: 'fixed',
              top: coords.top !== undefined ? `${coords.top}px` : undefined,
              bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
              left: `${coords.left}px`,
              width: coords.width ? `${coords.width}px` : undefined,
              maxHeight: coords.maxHeight ? `${coords.maxHeight}px` : '240px',
              zIndex: 9999,
            }}
            className="overflow-y-auto no-scrollbar bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1 space-y-0.5 text-xs font-medium animate-in fade-in zoom-in-95 duration-100"
          >
            {searchable && (
              <div className="sticky top-0 z-10 bg-white dark:bg-slate-800 px-1 pb-1.5 border-b border-slate-100 dark:border-slate-700">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                  <input
                    autoFocus
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    onKeyDown={handleListKeys}
                    placeholder="พิมพ์ค้นหา..."
                    className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            )}
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-slate-600 dark:text-slate-400 text-center text-[11px]">
                {searchTerm ? 'ไม่พบรายการที่ตรงกับคำค้นหา' : emptyText}
              </div>
            ) : (
              filteredOptions.map((opt, index) => {
                const isSelected = String(opt.value) === String(value)
                const isHighlighted = index === highlight
                const optionButton = (
                  <button
                    key={String(opt.value)}
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setHighlight(index)}
                    className={`w-full text-left px-3 py-2 rounded-lg font-bold transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-slate-100 dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 shadow-xs'
                        : 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/80'
                    } ${isHighlighted ? 'ring-2 ring-inset ring-emerald-500' : ''}`}
                  >
                    <span className="truncate flex-1">{opt.label}</span>
                    {opt.sublabel && (
                      <span
                        className={`text-[10px] shrink-0 font-mono ${
                          isSelected ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {opt.sublabel}
                      </span>
                    )}
                    {isSelected && <Check className="w-3.5 h-3.5 shrink-0 ml-1" />}
                  </button>
                )
                if (!onRemoveOption) return optionButton
                return (
                  <div key={String(opt.value)} className="flex items-center gap-0.5">
                    <div className="flex-1 min-w-0">{optionButton}</div>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`ลบ ${opt.label}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveOption(opt.value)
                      }}
                      className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </ModalPortal>
      )}
    </div>
  )
}
