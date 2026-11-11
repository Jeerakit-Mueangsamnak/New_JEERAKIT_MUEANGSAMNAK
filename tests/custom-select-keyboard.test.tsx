// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CustomSelect } from '@/components/common/CustomSelect'

afterEach(cleanup)

const OPTIONS = [
  { value: 'a', label: 'เช่ารายวัน' },
  { value: 'b', label: 'เช่ารายเดือน' },
  { value: 'c', label: 'ขาย' },
]

function Field({ searchable = false }: { searchable?: boolean }) {
  const [value, setValue] = useState('a')
  return (
    <>
      <CustomSelect value={value} onChange={setValue} options={OPTIONS} ariaLabel="ประเภท" searchable={searchable} />
      <output data-testid="value">{value}</output>
    </>
  )
}

const trigger = () => screen.getByRole('button', { name: 'ประเภท' })
const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k })

describe('CustomSelect with the keyboard (audit UX-23)', () => {
  it('↓ opens the list on the chosen option; ↓ ↓ Enter picks the third', () => {
    render(<Field />)
    key(trigger(), 'ArrowDown')
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(trigger().getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id)
    key(trigger(), 'ArrowDown')
    key(trigger(), 'ArrowDown')
    key(trigger(), 'ArrowDown') // stays on the last one
    key(trigger(), 'Enter')
    expect(screen.getByTestId('value').textContent).toBe('c')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('↑, Home and End move too; Space picks', () => {
    render(<Field />)
    key(trigger(), 'ArrowUp')
    key(trigger(), 'End')
    key(trigger(), 'ArrowUp')
    key(trigger(), ' ')
    expect(screen.getByTestId('value').textContent).toBe('b')
    key(trigger(), 'ArrowDown')
    key(trigger(), 'Home')
    key(trigger(), 'Enter')
    expect(screen.getByTestId('value').textContent).toBe('a')
  })

  it('the chosen option is marked for screen readers', () => {
    render(<Field />)
    key(trigger(), 'ArrowDown')
    expect(screen.getByRole('option', { name: 'เช่ารายวัน' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('option', { name: 'ขาย' }).getAttribute('aria-selected')).toBe('false')
  })

  it('in a searchable list, typing then ↓ Enter picks from the matches', () => {
    render(<Field searchable />)
    fireEvent.click(trigger())
    const search = screen.getByPlaceholderText('พิมพ์ค้นหา...')
    fireEvent.change(search, { target: { value: 'เช่า' } })
    key(search, 'ArrowDown')
    key(search, 'Enter')
    expect(screen.getByTestId('value').textContent).toBe('b')
  })

  it('a mouse click still picks an option', () => {
    render(<Field />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'ขาย' }))
    expect(screen.getByTestId('value').textContent).toBe('c')
  })
})

describe('CustomSelect allowCustom (ธนาคาร: เลือกจากรายการหรือพิมพ์เอง)', () => {
  it('offers the typed text first and picks it; a value outside the list shows as it is', () => {
    const onChange = vi.fn()
    render(<CustomSelect ariaLabel="ธนาคาร" searchable allowCustom value="ธนาคารของร้านเอง" onChange={onChange} options={[{ value: 'ออมสิน (GSB)', label: 'ออมสิน (GSB)' }]} />)
    expect(screen.getByRole('button', { name: 'ธนาคาร' }).textContent).toContain('ธนาคารของร้านเอง')
    fireEvent.click(screen.getByRole('button', { name: 'ธนาคาร' }))
    fireEvent.change(screen.getByPlaceholderText('พิมพ์ค้นหา...'), { target: { value: 'แลนด์' } })
    fireEvent.click(screen.getByRole('option', { name: 'ใช้ "แลนด์"' }))
    expect(onChange).toHaveBeenCalledWith('แลนด์')
  })

  it('without allowCustom nothing changes: no typed choice', () => {
    render(<CustomSelect ariaLabel="x" searchable value="" onChange={() => {}} options={[{ value: 'a', label: 'aaa' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'x' }))
    fireEvent.change(screen.getByPlaceholderText('พิมพ์ค้นหา...'), { target: { value: 'zzz' } })
    expect(screen.queryByRole('option', { name: /ใช้/ })).toBeNull()
  })
})
