// @vitest-environment jsdom
process.env.TZ = 'Asia/Bangkok'

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const fake = vi.hoisted(() => ({
  saves: 0,
  release: null as null | (() => void),
  fail: null as null | (() => void),
}))

vi.mock('@/features/finance/services/finance-storage', async (orig) => ({
  ...(await orig<object>()),
  loadTransactions: vi.fn(() => []),
  fetchTransactionsFromSupabase: vi.fn(async () => []),
  // Each save stays pending until the test releases or fails it.
  addManualTransaction: vi.fn(
    () =>
      new Promise((resolve, reject) => {
        fake.saves++
        fake.release = () => resolve([])
        fake.fail = () => reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'))
      })
  ),
}))
vi.mock('@/lib/db/policies', () => ({ getPolicy: (_k: string, d: unknown) => d, savePolicies: vi.fn(async () => {}) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/components/common/ConfirmDialogProvider', () => ({ useAskText: () => vi.fn(async () => null) }))

import StatementPage from '@/app/finance/statement/page'
import { filterTransactionsByLocalDate, type StatementTransaction } from '@/features/finance/services/finance-storage'

const tx = (id: string, dateTime: string): StatementTransaction => ({
  id,
  dateTime,
  refNo: id,
  type: 'INCOME',
  category: 'รายรับอื่นๆ',
  description: id,
  incomeAmount: 100,
  expenseAmount: 0,
  runningBalance: 0,
  channel: 'เงินสด',
})

beforeEach(() => {
  fake.saves = 0
  fake.release = null
  fake.fail = null
})
afterEach(() => cleanup())

describe('P1-B8 Statement filters by the local day, not the UTC day', () => {
  it('an entry at 00:30 local time (17:30 UTC the day before) counts on that local day', () => {
    // 2026-10-07 00:30 Bangkok = 2026-10-06T17:30Z
    const list = [tx('early', '2026-10-06T17:30:00+00:00'), tx('prev', '2026-10-06T16:59:00+00:00')]
    const day = new Date(2026, 9, 7)
    expect(filterTransactionsByLocalDate(list, day, day).map((t) => t.id)).toEqual(['early'])
    const prevDay = new Date(2026, 9, 6)
    expect(filterTransactionsByLocalDate(list, prevDay, prevDay).map((t) => t.id)).toEqual(['prev'])
  })

  it('open-ended ranges and no range still work', () => {
    const list = [tx('early', '2026-10-06T17:30:00+00:00')]
    expect(filterTransactionsByLocalDate(list, new Date(2026, 9, 7), null)).toHaveLength(1)
    expect(filterTransactionsByLocalDate(list, null, new Date(2026, 9, 6))).toHaveLength(0)
    expect(filterTransactionsByLocalDate(list, null, null)).toBe(list)
  })
})

describe('P1-B9 income/expense save cannot be sent twice', () => {
  const openFormAndFill = () => {
    render(<StatementPage />)
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรายการ' }))
    const amount = screen.getAllByRole('textbox').find((el) => el.hasAttribute('required'))!
    fireEvent.change(amount, { target: { value: '150' } })
    fireEvent.change(screen.getByPlaceholderText(/กรอกรายละเอียดเพิ่มเติม/), { target: { value: 'ค่าบริการ' } })
    // the modal's submit button is the last "บันทึกรายการ"
    const buttons = screen.getAllByRole('button', { name: 'บันทึกรายการ' })
    return buttons[buttons.length - 1] as HTMLButtonElement
  }

  it('a double submit calls the save once and disables the button', async () => {
    const submit = openFormAndFill()
    await act(async () => {
      fireEvent.click(submit)
      fireEvent.click(submit)
      fireEvent.submit(submit.closest('form')!)
    })
    expect(fake.saves).toBe(1)
    expect(submit.disabled).toBe(true)
    await act(async () => fake.release!())
  })

  it('after a failed save the button is enabled again and the form is kept', async () => {
    const submit = openFormAndFill()
    await act(async () => fireEvent.click(submit))
    expect(submit.disabled).toBe(true)
    await act(async () => fake.fail!())
    expect(submit.disabled).toBe(false)
    expect((screen.getByPlaceholderText(/กรอกรายละเอียดเพิ่มเติม/) as HTMLTextAreaElement).value).toBe('ค่าบริการ')
    await act(async () => fireEvent.click(submit))
    expect(fake.saves).toBe(2)
  })
})
