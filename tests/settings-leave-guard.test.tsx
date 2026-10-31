// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConfirmDialogProvider } from '@/components/common/ConfirmDialogProvider'
import { useLeaveGuard } from '@/features/settings/hooks/useLeaveGuard'

afterEach(cleanup)

function Page({ dirty, onGo }: { dirty: boolean; onGo: () => void }) {
  useLeaveGuard(dirty)
  return (
    <a href="/dashboard" onClick={(e) => { e.preventDefault(); onGo() }}>
      ไปแดชบอร์ด
    </a>
  )
}

const renderPage = (dirty: boolean, onGo = vi.fn()) => {
  render(<ConfirmDialogProvider><Page dirty={dirty} onGo={onGo} /></ConfirmDialogProvider>)
  return onGo
}

describe('settings: leaving with unsaved edits (audit UX-15)', () => {
  it('no unsaved edits → the link works at once, nothing is asked', () => {
    const onGo = renderPage(false)
    fireEvent.click(screen.getByText('ไปแดชบอร์ด'))
    expect(onGo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('ยังไม่ได้บันทึกการตั้งค่า')).toBeNull()
  })

  it('unsaved edits → asks first; "อยู่หน้านี้ต่อ" stays on the page', async () => {
    const onGo = renderPage(true)
    fireEvent.click(screen.getByText('ไปแดชบอร์ด'))
    expect(onGo).not.toHaveBeenCalled()
    expect(screen.getByText('ยังไม่ได้บันทึกการตั้งค่า')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'อยู่หน้านี้ต่อ' }))
    })
    expect(onGo).not.toHaveBeenCalled()
  })

  it('unsaved edits → "ออกโดยไม่บันทึก" follows the link', async () => {
    const onGo = renderPage(true)
    fireEvent.click(screen.getByText('ไปแดชบอร์ด'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ออกโดยไม่บันทึก' }))
    })
    expect(onGo).toHaveBeenCalledTimes(1)
  })

  it('unsaved edits → closing or reloading the tab asks the browser to confirm', () => {
    renderPage(true)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
