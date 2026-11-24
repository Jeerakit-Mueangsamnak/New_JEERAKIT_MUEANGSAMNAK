// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NumericInput } from '@/components/common/NumericInput'

const setPointer = (coarse: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function Harness({ allowDecimals = false, allowNegative = false, onValue }: { allowDecimals?: boolean; allowNegative?: boolean; onValue: (v: number | '') => void }) {
  const [value, setValue] = useState<number | ''>('')
  return (
    <NumericInput
      aria-label="จำนวน"
      value={value}
      onChange={(v) => { setValue(v); onValue(v) }}
      min={0}
      max={50}
      allowDecimals={allowDecimals}
      allowNegative={allowNegative}
    />
  )
}

/** A finger tap on the box: it takes the focus, then the click opens the pad. */
const tap = (el: HTMLElement) => {
  act(() => el.focus())
  fireEvent.click(el)
}
const key = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }))

beforeEach(() => setPointer(true))
afterEach(cleanup)

describe('NumericInput on-screen number pad', () => {
  it('opens above the box on a touch screen and keeps the device keyboard closed', () => {
    render(<Harness onValue={vi.fn()} />)
    const input = screen.getByLabelText('จำนวน')
    expect(input.getAttribute('inputmode')).toBe('none')
    expect(screen.queryByRole('group', { name: 'แป้นตัวเลข' })).toBeNull()
    // A window that puts the focus in the box does not open the pad: only a tap does (owner 2026-11-24)
    act(() => input.focus())
    expect(screen.queryByRole('group', { name: 'แป้นตัวเลข' })).toBeNull()
    fireEvent.click(input)
    expect(screen.getByRole('group', { name: 'แป้นตัวเลข' })).toBeTruthy()
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) expect(screen.getByRole('button', { name: d })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ลบ' })).toBeTruthy()
    // Whole-number boxes leave the "." slot empty
    expect(screen.queryByRole('button', { name: '.' })).toBeNull()
  })

  it('types digits, deletes with ⌫, and applies the same blur rules (max) as typing', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    const input = screen.getByLabelText('จำนวน') as HTMLInputElement
    tap(input)
    key('1'); key('2'); key('3')
    expect(input.value).toBe('123')
    key('ลบ')
    expect(input.value).toBe('12')
    expect(onValue).toHaveBeenLastCalledWith(12)
    key('9')
    fireEvent.blur(input)
    expect(onValue).toHaveBeenLastCalledWith(50)
    expect(screen.queryByRole('group', { name: 'แป้นตัวเลข' })).toBeNull()
  })

  it('keeps typing after a press that leaves the text unchanged (box shows 1, user taps 1 then 2)', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    const input = screen.getByLabelText('จำนวน') as HTMLInputElement
    tap(input)
    key('1')
    fireEvent.blur(input)
    tap(input)
    input.setSelectionRange(0, 1) // focus selects the existing "1"
    key('1'); key('2')
    expect(input.value).toBe('12')
  })

  it('closes when tapping outside the box and the pad', () => {
    render(<div><Harness onValue={vi.fn()} /><p>outside</p></div>)
    const input = screen.getByLabelText('จำนวน') as HTMLInputElement
    tap(input)
    expect(screen.getByRole('group', { name: 'แป้นตัวเลข' })).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(document.activeElement).not.toBe(input)
    expect(screen.queryByRole('group', { name: 'แป้นตัวเลข' })).toBeNull()
  })

  it('shows "." for decimal boxes', () => {
    render(<Harness allowDecimals onValue={vi.fn()} />)
    tap(screen.getByLabelText('จำนวน'))
    key('1'); key('.'); key('5')
    expect((screen.getByLabelText('จำนวน') as HTMLInputElement).value).toBe('1.5')
  })

  it('does nothing different with a mouse, or in a box that takes negative numbers (the pad has no minus)', () => {
    setPointer(false)
    render(<Harness onValue={vi.fn()} />)
    const input = screen.getByLabelText('จำนวน')
    expect(input.getAttribute('inputmode')).toBe('numeric')
    tap(input)
    expect(screen.queryByRole('group', { name: 'แป้นตัวเลข' })).toBeNull()
    cleanup()
    setPointer(true)
    render(<Harness allowNegative onValue={vi.fn()} />)
    tap(screen.getByLabelText('จำนวน'))
    expect(screen.queryByRole('group', { name: 'แป้นตัวเลข' })).toBeNull()
  })
})
