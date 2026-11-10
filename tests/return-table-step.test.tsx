// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ReturnTableStep } from '@/features/bills/components/ReturnTableStep'
import type { FullBill, ReturnInspectionItem } from '@/lib/types/rental-return'

const item = (over: Partial<ReturnInspectionItem>): ReturnInspectionItem =>
  ({
    rentalBillItemId: 'a', productId: 'p', productCode: 'WI-001', productName: 'นั่งร้าน 170', totalQtyInBill: 15, outstandingQty: 10,
    returnQty: 0, normalQty: 0, damagedQty: 0, lostQty: 0, dailyRate: 10, rentalType: 'DAILY', usageCount: 10,
    repairFeePerUnit: 0, replacementFeePerUnit: 0, totalDamageFee: 0, note: '', selected: false,
    rentalStartDate: '2026-11-01', scheduledReturnDate: '2026-11-10', actualReturnDate: '2026-11-04', ...over,
  }) as ReturnInspectionItem

const bill = { items: [{ rentalBillItemId: 'a', returnedQty: 5 }, { rentalBillItemId: 'b', returnedQty: 0 }] } as unknown as FullBill

const setup = (items: ReturnInspectionItem[]) => {
  const handlers = {
    onToggleSelectAll: vi.fn(), onToggleSelectItem: vi.fn(), onQuantityChange: vi.fn(),
    onReturnDateChange: vi.fn(), onContinueEndDateChange: vi.fn(), onContinueRoundsChange: vi.fn(), onBack: vi.fn(), onNext: vi.fn(),
  }
  render(<ReturnTableStep activeBill={bill} items={items} canNext {...handlers} />)
  return handlers
}

afterEach(cleanup)

describe('ReturnTableStep', () => {
  it('has the agreed columns in order', () => {
    setup([item({})])
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())
    expect(headers.slice(1)).toEqual(['ลำดับ', 'รายการ', 'จำนวน', 'ค้างคืน', 'คืนแล้ว', 'วันที่เช่า/คืน', 'การเช่า', 'ปกติ', 'ชำรุด', 'หาย', 'เช่าต่อ', 'วันที่/รอบ', 'เช่าจริง'])
  })

  it('shows short dates, usage and actual days for a daily item', () => {
    setup([item({})])
    const row = screen.getByText('นั่งร้าน 170').closest('tr') as HTMLElement
    expect(within(row).getByText('1 พ.ย. 69')).toBeTruthy()
    expect(within(row).getByText('10 พ.ย. 69')).toBeTruthy()
    expect(within(row).getByText('10 วัน')).toBeTruthy() // การเช่า
    expect(within(row).getByText('4 วัน')).toBeTruthy() // เช่าจริง: 1–4 พ.ย. inclusive
  })

  it('per-round goods show rounds and no return date', () => {
    setup([item({ rentalType: 'NORMAL', usageCount: 5 })])
    const row = screen.getByText('นั่งร้าน 170').closest('tr') as HTMLElement
    expect(within(row).getAllByText('5 รอบ').length).toBe(2) // การเช่า + เช่าจริง (rounds)
    expect(within(row).queryByText('-')).toBeNull()
    expect(within(row).getAllByRole('textbox').length).toBe(5) // ปกติ ชำรุด หาย เช่าต่อ + rounds box, always there
  })

  it('double-click toggles the row (1st ticks, 2nd unticks); the tick box toggles too (owner 2026-11-11)', () => {
    const h = setup([item({})])
    const row = screen.getByText('นั่งร้าน 170').closest('tr') as HTMLElement
    fireEvent.doubleClick(row)
    fireEvent.doubleClick(row)
    expect(h.onToggleSelectItem).toHaveBeenCalledTimes(2)
    expect(h.onToggleSelectItem).toHaveBeenCalledWith(0)
    fireEvent.doubleClick(within(row).getAllByRole('textbox')[0])
    expect(h.onToggleSelectItem).toHaveBeenCalledTimes(2) // a double-click in a box is the box's own
    fireEvent.click(within(row).getByRole('checkbox'))
    expect(h.onToggleSelectItem).toHaveBeenCalledTimes(3)
  })

  it('ย้อนกลับ / ถัดไป are the shared step buttons', () => {
    const h = setup([item({})])
    fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))
    expect(h.onBack).toHaveBeenCalled()
    expect(h.onNext).toHaveBeenCalled()
  })

  it('a quantity typed in ปกติ is reported to the parent', () => {
    const h = setup([item({})])
    const row = screen.getByText('นั่งร้าน 170').closest('tr') as HTMLElement
    fireEvent.change(within(row).getAllByRole('textbox')[0], { target: { value: '3' } })
    expect(h.onQuantityChange).toHaveBeenCalledWith('a', 'normalQty', 3)
  })
})

describe('ReturnTableStep quantity boxes are input-only', () => {
  it('clicking into a box and leaving it empty does not put a 0 in it', () => {
    setup([item({})])
    const row = screen.getByText('นั่งร้าน 170').closest('tr') as HTMLElement
    const box = within(row).getAllByRole('textbox')[0] as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.blur(box)
    expect(box.value).toBe('')
  })
})

describe('ReturnTableStep เช่าต่อ column', () => {
  it('a quantity in เช่าต่อ is reported (4th box after ปกติ / ชำรุด / หาย)', () => {
    const h = setup([item({})])
    const row = screen.getByText('นั่งร้าน 170').closest('tr') as HTMLElement
    fireEvent.change(within(row).getAllByRole('textbox')[3], { target: { value: '5' } })
    expect(h.onQuantityChange).toHaveBeenCalledWith('a', 'continueQty', 5)
  })

  it('a finished item (nothing left to return) cannot be continued', () => {
    setup([item({ outstandingQty: 0 })])
    const row = screen.getByText('นั่งร้าน 170').closest('tr') as HTMLElement
    expect((within(row).getAllByRole('textbox')[3] as HTMLInputElement).disabled).toBe(true)
  })
})

describe('ReturnTableStep วันที่/รอบ', () => {
  it('per-round goods have a rounds box; เช่าจริง adds the rounds typed', () => {
    const h = setup([item({ rentalType: 'NORMAL', usageCount: 5, continueQty: 4, continueRounds: 3 })])
    const row = screen.getByText('นั่งร้าน 170').closest('tr') as HTMLElement
    const boxes = within(row).getAllByRole('textbox')
    expect(boxes.length).toBe(5) // ปกติ ชำรุด หาย เช่าต่อ + rounds
    expect(within(row).getByText('8 รอบ')).toBeTruthy() // 5 rounds so far + 3 more
    fireEvent.change(boxes[4], { target: { value: '2' } })
    expect(h.onContinueRoundsChange).toHaveBeenCalledWith(0, 2)
  })

  it('daily goods that continue show the new end day and its total days', () => {
    setup([item({ continueQty: 5, continueEndDate: '2026-11-20' })])
    const row = screen.getByText('นั่งร้าน 170').closest('tr') as HTMLElement
    expect(within(row).getByText('20 วัน')).toBeTruthy() // 1–20 พ.ย. inclusive
  })
})
