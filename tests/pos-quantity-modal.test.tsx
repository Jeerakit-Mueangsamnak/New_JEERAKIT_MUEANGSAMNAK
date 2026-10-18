// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QuantityModal } from '@/features/pos/components/QuantityModal'
import { Product } from '@/lib/types/rental-pos'

vi.mock('@/components/common/CustomDatePicker', () => ({
  getLocalDateString: (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
  CustomDatePicker: ({
    value,
    onChange,
  }: {
    value: Date | null
    onChange: (value: Date | null) => void
  }) => {
    const inputValue = value
      ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
      : ''
    return (
      <input
        type="date"
        aria-label="rental date"
        value={inputValue}
        onChange={(event) => onChange(event.target.value ? new Date(`${event.target.value}T12:00:00`) : null)}
      />
    )
  },
}))

describe('POS daily rental dates', () => {
  it('blocks adding a daily rental when the end date is before the start date', () => {
    const onAdd = vi.fn()
    const onClose = vi.fn()
    const product = {
      id: 'daily-product',
      name: 'Daily product',
      code: 'DAILY-1',
      rentalType: 'DAILY',
      calculationType: 'PER_DAY',
      dailyPrice: 100,
      availableQuantity: 5,
    } as Product

    render(<QuantityModal product={product} onAdd={onAdd} onClose={onClose} />)
    const [startDate, endDate] = screen.getAllByLabelText('rental date')
    fireEvent.change(startDate, { target: { value: '2026-06-10' } })
    fireEvent.change(endDate, { target: { value: '2026-06-09' } })

    expect(screen.getByRole('alert').textContent).toBe('วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น')
    expect((screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('disables adding quantities greater than live available stock', () => {
    const onAdd = vi.fn()
    const product = {
      id: 'daily-product',
      name: 'Daily product',
      code: 'DAILY-1',
      rentalType: 'DAILY',
      calculationType: 'PER_DAY',
      dailyPrice: 100,
      availableQuantity: 5,
    } as Product

    render(<QuantityModal product={product} onAdd={onAdd} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('1'), { target: { value: '6' } })

    expect((screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onAdd).not.toHaveBeenCalled()
  })
})
