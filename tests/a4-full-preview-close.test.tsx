// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { A4FullPreviewOverlay } from '@/features/pos/components/A4FitPreview'

// Owner 2026-11-11: one tap or a swipe must not close the full preview; three quick taps do.
describe('A4 full preview closes on three quick taps', () => {
  afterEach(cleanup)
  const open = (onClose = vi.fn()) => {
    render(
      <A4FullPreviewOverlay open onClose={onClose}>
        <p>เอกสาร</p>
      </A4FullPreviewOverlay>,
    )
    return { onClose, overlay: screen.getByRole('dialog', { name: 'ตัวอย่างเอกสาร A4 เต็มจอ' }) }
  }

  it('one or two taps keep it open, the third closes it', () => {
    const { onClose, overlay } = open()
    fireEvent.click(overlay)
    fireEvent.click(screen.getByText('เอกสาร'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a swipe (touch without a click) does not close it', () => {
    const { onClose, overlay } = open()
    fireEvent.touchStart(overlay)
    fireEvent.touchMove(overlay)
    fireEvent.touchEnd(overlay)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('slow taps do not add up', () => {
    vi.useFakeTimers()
    try {
      const { onClose, overlay } = open()
      fireEvent.click(overlay)
      vi.advanceTimersByTime(1000)
      fireEvent.click(overlay)
      vi.advanceTimersByTime(1000)
      fireEvent.click(overlay)
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('Esc still closes it', () => {
    const { onClose } = open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
