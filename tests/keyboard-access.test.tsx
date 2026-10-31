// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Product } from '@/lib/types/rental-pos'
import { ProductCard } from '@/features/pos/components/ProductCard'
import { CustomDatePicker } from '@/components/common/CustomDatePicker'

afterEach(cleanup)

const product = (available: number): Product =>
  ({ id: 'P1', name: 'นั่งร้าน', code: 'P1', category: 'นั่งร้าน', productType: 'RENT', status: 'ACTIVE', rentPrice: 100, availableQuantity: available, totalQuantity: 10 }) as unknown as Product

describe('POS product card with the keyboard (audit UX-10)', () => {
  it('Tab reaches the card; Enter and Space pick it', () => {
    const onClick = vi.fn()
    render(<ProductCard product={product(5)} onClick={onClick} />)
    const card = screen.getByRole('button')
    expect(card.tabIndex).toBe(0)
    fireEvent.keyDown(card, { key: 'Enter' })
    fireEvent.keyDown(card, { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('an out-of-stock card is skipped by Tab and cannot be picked', () => {
    const onClick = vi.fn()
    render(<ProductCard product={product(0)} onClick={onClick} />)
    const card = screen.getByRole('button')
    expect(card.tabIndex).toBe(-1)
    expect(card.getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('date picker: clearing with the keyboard (audit UX-22)', () => {
  function Field() {
    const [value, setValue] = useState<Date | null>(new Date(2026, 9, 31))
    return (
      <>
        <CustomDatePicker value={value} onChange={setValue} />
        <output data-testid="value">{value ? 'set' : 'empty'}</output>
      </>
    )
  }

  it('Delete on the date field clears the date', () => {
    render(<Field />)
    const field = screen.getByRole('button', { name: /31\/10\/2569/ })
    fireEvent.keyDown(field, { key: 'Delete' })
    expect(screen.getByTestId('value').textContent).toBe('empty')
  })

  it('Backspace clears too; the ✕ is no longer a hidden control inside the button', () => {
    render(<Field />)
    const field = screen.getByRole('button', { name: /31\/10\/2569/ })
    expect(field.querySelector('[title="ล้างวันที่"]')?.getAttribute('aria-hidden')).toBe('true')
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(screen.getByTestId('value').textContent).toBe('empty')
  })
})
