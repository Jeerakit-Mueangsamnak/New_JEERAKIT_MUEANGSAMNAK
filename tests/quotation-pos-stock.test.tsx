// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProductCard } from '@/features/pos/components/ProductCard'
import { QuantityModal } from '@/features/pos/components/QuantityModal'
import type { Product } from '@/lib/types/rental-pos'

// Owner 2026-10-18: a quotation holds no stock, so POS in quotation mode may quote products that
// are out of stock or more than is free — with a warning. Bills keep the stock lock.

const product = {
  id: 'p1', name: 'แบบคาน 40x0.75', code: 'BK-003', rentalType: 'NORMAL', calculationType: 'PER_PERIOD',
  rentPrice: 15, availableQuantity: 2, status: 'ACTIVE', unit: 'แผ่น',
} as unknown as Product

afterEach(() => cleanup())

describe('quotation mode stock rules in POS', () => {
  it('an out-of-stock card is locked for a bill but selectable for a quotation', () => {
    const out = { ...product, availableQuantity: 0 } as Product
    const onBill = vi.fn()
    const { unmount } = render(<ProductCard product={out} onClick={onBill} />)
    fireEvent.click(screen.getByText('แบบคาน 40x0.75'))
    expect(onBill).not.toHaveBeenCalled()
    unmount()

    const onQuote = vi.fn()
    render(<ProductCard product={out} onClick={onQuote} allowOutOfStock />)
    fireEvent.click(screen.getByText('แบบคาน 40x0.75'))
    expect(onQuote).toHaveBeenCalledOnce()
  })

  it('more than the free stock: a bill cannot add it, a quotation can (warning shown)', () => {
    const { unmount } = render(<QuantityModal product={product} onAdd={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getAllByPlaceholderText('1')[0], { target: { value: '5' } })
    expect((screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()

    const onAdd = vi.fn()
    render(<QuantityModal product={product} onAdd={onAdd} onClose={vi.fn()} allowOverStock />)
    fireEvent.change(screen.getAllByPlaceholderText('1')[0], { target: { value: '5' } })
    expect(screen.getByText(/เสนอราคาได้ แต่ต้องมีของพอตอนเปิดบิล/)).toBeTruthy()
    const add = screen.getByRole('button', { name: 'เพิ่มลงตะกร้า' }) as HTMLButtonElement
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5 }))
  })
})
