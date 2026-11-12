// @vitest-environment jsdom
// The one print window of the bill flows (owner 2026-11-12): tick the shop's forms, print the ticked ones.
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const printed = vi.hoisted(() => ({ fn: vi.fn((_pages: string[], _title?: string) => true) }))
vi.mock('@/features/documents/utils/transaction-print', () => ({ printFormPages: printed.fn }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { PostSavePrintModal } from '@/components/common/PostSavePrintModal'

const forms = [
  { name: 'ใบเช็คของ', pages: ['<p>check</p>'] },
  { name: 'ใบส่งของ/ใบเสร็จรับเงิน', pages: ['<p>main 1</p>', '<p>main 2</p>'] },
  { name: 'ใบเสร็จรับเงิน', pages: [] },
]

afterEach(() => {
  cleanup()
  printed.fn.mockClear()
})

describe('PostSavePrintModal', () => {
  it('keeps the title, lists the forms with ticks, the suggested one ticked; a form with nothing to print cannot be ticked', () => {
    render(<PostSavePrintModal isOpen title="บันทึกบิลเช่าสำเร็จ" forms={forms} defaultSelected={['ใบส่งของ/ใบเสร็จรับเงิน']} onClose={vi.fn()} />)
    expect(screen.getByText('บันทึกบิลเช่าสำเร็จ')).toBeTruthy()
    expect((screen.getByLabelText('เลือก ใบส่งของ/ใบเสร็จรับเงิน') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('เลือก ใบเช็คของ') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('เลือก ใบเสร็จรับเงิน') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('เลือกแล้ว 1 / 2')).toBeTruthy()
  })

  it('prints the ticked forms together in list order, then reports back', () => {
    const onPrinted = vi.fn()
    render(<PostSavePrintModal isOpen title="t" forms={forms} defaultSelected={['ใบส่งของ/ใบเสร็จรับเงิน']} printTitle="BL-1" onPrinted={onPrinted} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('เลือก ใบเช็คของ'))
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์' }))
    expect(printed.fn).toHaveBeenCalledWith(['<p>check</p>', '<p>main 1</p>', '<p>main 2</p>'], 'BL-1')
    expect(onPrinted).toHaveBeenCalledOnce()
  })

  it('เลือกทั้งหมด ticks every printable form; nothing ticked = พิมพ์ is off', () => {
    render(<PostSavePrintModal isOpen title="t" forms={forms} onClose={vi.fn()} />)
    const printButton = screen.getByRole('button', { name: 'พิมพ์' }) as HTMLButtonElement
    expect(printButton.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('เลือกทั้งหมด'))
    expect(screen.getByText('เลือกแล้ว 2 / 2')).toBeTruthy()
    expect(printButton.disabled).toBe(false)
  })
})
