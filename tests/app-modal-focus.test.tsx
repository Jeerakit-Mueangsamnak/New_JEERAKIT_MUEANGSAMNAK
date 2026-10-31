// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AppModal, AppModalBody, AppModalHeader } from '@/components/common/AppModal'

afterEach(cleanup)

function Screen() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>เปิดหน้าต่าง</button>
      <button>ปุ่มหลังหน้าต่าง</button>
      <AppModal isOpen={open} onClose={() => setOpen(false)}>
        <AppModalHeader title="แก้ไขลูกค้า" onClose={() => setOpen(false)} />
        <AppModalBody>
          <input aria-label="ชื่อ" />
          <button>บันทึก</button>
        </AppModalBody>
      </AppModal>
    </>
  )
}

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift })

describe('AppModal keyboard and screen reader (audit UX-12)', () => {
  it('the window has a name: its header title', () => {
    render(<Screen />)
    fireEvent.click(screen.getByText('เปิดหน้าต่าง'))
    expect(screen.getByRole('dialog', { name: 'แก้ไขลูกค้า' })).toBeTruthy()
  })

  it('opening moves the focus into the window; closing gives it back', () => {
    render(<Screen />)
    const opener = screen.getByText('เปิดหน้าต่าง')
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('Tab from the last item goes back to the first; Shift+Tab from the first goes to the last', () => {
    render(<Screen />)
    fireEvent.click(screen.getByText('เปิดหน้าต่าง'))
    const dialog = screen.getByRole('dialog')
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('button, input'))
    const first = items[0]
    const last = items[items.length - 1]

    last.focus()
    tab()
    expect(document.activeElement).toBe(first)

    first.focus()
    tab(true)
    expect(document.activeElement).toBe(last)
  })

  it('focus never lands on the page behind while the window is open', () => {
    render(<Screen />)
    fireEvent.click(screen.getByText('เปิดหน้าต่าง'))
    ;(document.activeElement as HTMLElement).blur()
    tab()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })
})
