// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CustomerUnifiedSelector } from '@/features/pos/components/CustomerUnifiedSelector'
import type { Customer } from '@/lib/types/rental-pos'

afterEach(cleanup)

function Host({ customer = null }: { customer?: Customer | null }) {
  const [attention, setAttention] = useState(true)
  return (
    <CustomerUnifiedSelector
      selectedCustomer={customer}
      customers={[]}
      onSelectCustomer={() => undefined}
      attention={attention}
      onAttentionDismiss={() => setAttention(false)}
    />
  )
}

describe('customer field attention (replaces the "ข้อมูลลูกค้าไม่ครบถ้วน" pop-up)', () => {
  it('the empty field blinks until it is clicked', () => {
    render(<Host />)
    const input = screen.getByPlaceholderText(/ค้นหาชื่อ/)
    expect(input.className).toContain('field-attention')
    fireEvent.mouseDown(input)
    expect(input.className).not.toContain('field-attention')
  })

  it('focusing the field also stops the blinking', () => {
    render(<Host />)
    const input = screen.getByPlaceholderText(/ค้นหาชื่อ/)
    fireEvent.focus(input)
    expect(input.className).not.toContain('field-attention')
  })

  it('a chosen guest customer with missing details blinks until the chip is clicked', () => {
    const guest = { id: '', customerName: 'สมชาย', phone: '', address: '', taxId: '', status: 'ACTIVE' } as Customer
    render(<Host customer={guest} />)
    const chip = screen.getByText('สมชาย').closest('div[class*="rounded-xl"]') as HTMLElement
    expect(chip.className).toContain('field-attention')
    fireEvent.click(chip)
    expect(chip.className).not.toContain('field-attention')
  })
})
