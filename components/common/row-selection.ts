import type React from 'react'

/**
 * Row selection by double-click, the one rule of the system (owner 2026-11-11): the first double-click
 * ticks the row, the next one unticks it. Double-clicks on a control inside the row (box, button, link,
 * date picker…) are left to that control. Use it on every table row that can be ticked.
 */
export function toggleRowOnDoubleClick(e: React.MouseEvent, toggle: () => void): void {
  if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="button"]')) return
  window.getSelection()?.removeAllRanges()
  toggle()
}
