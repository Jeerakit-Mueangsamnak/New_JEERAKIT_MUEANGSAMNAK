import { afterEach, describe, expect, it, vi } from 'vitest'

// Finance menu check 2026-10-18: money moved on the bills page must reach the finance cache,
// server timestamps (UTC) are counted on the shop's local day, drafts are not bills.

const fetchFinance = vi.fn(async () => [])
vi.mock('@/features/finance/services/finance-storage', async (orig) => ({
  ...(await orig<object>()),
  fetchTransactionsFromSupabase: () => fetchFinance(),
}))
vi.mock('@/features/bills/services/bill-storage', async (orig) => ({
  ...(await orig<object>()),
  refreshBillsCache: vi.fn(async () => [{ id: 'bill-1' }]),
}))
vi.mock('@/lib/db/rpc', async (orig) => ({
  ...(await orig<object>()),
  rpc: vi.fn(async () => ({ receipt_no: 'RC-1', total_amount: 95 })),
  // the statement reload after a void reads nothing in unit tests
  selectRows: vi.fn(async () => []),
}))

import { receivePayment } from '@/features/bills/services/bill-service'
import {
  formatLocalDateTime,
  setCachedRevenueLedger,
  setCachedTransactions,
  voidManualTransaction,
} from '@/features/finance/services/finance-storage'
import { rpc } from '@/lib/db/rpc'
import { setCachedBills } from '@/features/bills/services/bill-storage'
import { getFinanceReportData } from '@/features/reports/services/finance-report-data'
import { formatThaiDate, isDateInRange, localDayOf, toLocalDateString } from '@/features/reports/services/report-data-common'
import type { FullBill } from '@/lib/types/rental-return'

// 01:15 on 18 Oct in Thailand is 18:15 UTC on 17 Oct.
const LATE_NIGHT_UTC = '2026-10-17T18:15:32.574+00:00'
const localDay = (iso: string) => toLocalDateString(new Date(iso))

const bill = (overrides: Partial<FullBill> = {}): FullBill => ({
  id: 'bill-1',
  billNo: 'BL-1',
  billDate: '2026-10-01',
  customerName: 'Customer',
  customerPhone: '',
  rentalStartDate: '2026-10-01',
  scheduledReturnDate: '2026-10-15',
  heldDepositAmount: 0,
  paidDepositAmount: 0,
  deposits: [],
  grandTotal: 100,
  paidAmount: 0,
  outstandingAmount: 100,
  rentalStatus: 'RENTING',
  paymentStatus: 'UNPAID',
  items: [],
  ...overrides,
})

vi.mock('@/lib/db/pin-confirm', async (orig) => ({
  ...(await orig<object>()),
  withPin: vi.fn(async (_opts: unknown, run: (token: string) => Promise<unknown>) => run('pin-token')),
}))

afterEach(() => {
  setCachedBills([])
  setCachedTransactions([])
  setCachedRevenueLedger([])
  vi.mocked(rpc).mockClear()
  fetchFinance.mockClear()
})

describe('finance cache after bill money commands', () => {
  it('reloads the finance statement together with the bills after a payment', async () => {
    const result = await receivePayment('bill-1', [{ method: 'CASH', amount: 95 }])
    expect(result.bill?.id).toBe('bill-1')
    expect(fetchFinance).toHaveBeenCalledTimes(1)
  })

  it('keeps the payment result when the finance reload fails', async () => {
    fetchFinance.mockRejectedValueOnce(new Error('network'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await receivePayment('bill-1', [{ method: 'CASH', amount: 95 }])
    expect(result.receiptNo).toBe('RC-1')
    spy.mockRestore()
  })
})

describe('local day of server timestamps', () => {
  it('converts a UTC timestamp to the local day and leaves plain dates alone', () => {
    expect(localDayOf(LATE_NIGHT_UTC)).toBe(localDay(LATE_NIGHT_UTC))
    expect(localDayOf('2026-10-17')).toBe('2026-10-17')
  })

  it('filters and labels by the local day', () => {
    const day = new Date(LATE_NIGHT_UTC)
    expect(isDateInRange(LATE_NIGHT_UTC, day, day)).toBe(true)
    const [y, m, d] = localDay(LATE_NIGHT_UTC).split('-').map(Number)
    expect(formatThaiDate(LATE_NIGHT_UTC)).toContain(`${d} `)
    expect(formatThaiDate(LATE_NIGHT_UTC)).toContain(String(y + 543))
    expect(m).toBeGreaterThan(0)
  })

  it('shows statement times in local time (DD/MM/BBBB HH:mm)', () => {
    const d = new Date(LATE_NIGHT_UTC)
    const pad = (n: number) => String(n).padStart(2, '0')
    expect(formatLocalDateTime(LATE_NIGHT_UTC)).toBe(
      `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + 543} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    )
    expect(formatLocalDateTime('')).toBe('')
  })
})

describe('finance report', () => {
  it('puts a late-night payment in the local day bucket', () => {
    const day = new Date(LATE_NIGHT_UTC)
    setCachedTransactions([
      {
        id: 'p1',
        dateTime: LATE_NIGHT_UTC,
        refNo: 'BL-1',
        type: 'INCOME',
        category: 'รับชำระบิล',
        description: '',
        incomeAmount: 30,
        expenseAmount: 0,
        runningBalance: 30,
        channel: 'เงินสด',
      },
    ])
    const data = getFinanceReportData({ startDate: day, endDate: day, granularity: 'daily' })
    expect(data.totalIncome).toBe(30)
    expect(data.trendData.reduce((s, p) => s + p.income, 0)).toBe(30)
  })

  it('does not count a draft bill as debt or stated deposit', () => {
    setCachedBills([
      bill({ id: 'draft', serverStatus: 'DRAFT', heldDepositAmount: 100, outstandingAmount: 50 }),
      bill({ id: 'active', serverStatus: 'ACTIVE', heldDepositAmount: 200, outstandingAmount: 20 }),
    ])
    const now = new Date()
    const data = getFinanceReportData({ startDate: now, endDate: now, granularity: 'daily' })
    expect(data.billDepositAmount).toBe(200)
    expect(data.billsWithDepositCount).toBe(1)
    expect(data.totalOutstanding).toBe(20)
  })
})

describe('cancel a wrong manual entry (owner 2026-10-18)', () => {
  it('voids an expense or other income with PIN + reason through the server', async () => {
    await voidManualTransaction({ id: 'ex-1', source: 'EXPENSE' }, 'บันทึกผิด')
    expect(rpc).toHaveBeenCalledWith('expense_void', { p_expense_id: 'ex-1', p_reason: 'บันทึกผิด', p_pin_token: 'pin-token' })
    await voidManualTransaction({ id: 'oi-1', source: 'OTHER_INCOME' }, 'ซ้ำ')
    expect(rpc).toHaveBeenCalledWith('other_income_void', { p_income_id: 'oi-1', p_reason: 'ซ้ำ', p_pin_token: 'pin-token' })
  })

  it('never voids a bill payment or refund from the statement', async () => {
    await expect(voidManualTransaction({ id: 'p-1', source: 'PAYMENT' }, 'x')).rejects.toThrow('หน้าบิล')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('revenue per type from the finance ledger (Master §31)', () => {
  it('sums each class in the date range, discounts and reversals negative', () => {
    const now = new Date()
    const iso = now.toISOString()
    setCachedRevenueLedger([
      { revenueClass: 'RENTAL', amount: 240, occurredAt: iso },
      { revenueClass: 'SALE', amount: 45, occurredAt: iso },
      { revenueClass: 'DELIVERY_FEE', amount: 40, occurredAt: iso },
      { revenueClass: 'DISCOUNT', amount: -10, occurredAt: iso },
      { revenueClass: 'SALE', amount: -45, occurredAt: iso },
      { revenueClass: 'RENTAL', amount: 999, occurredAt: '2020-01-01T00:00:00Z' },
    ])
    const data = getFinanceReportData({ startDate: now, endDate: now, granularity: 'daily' })
    expect(data.revenueByClass).toEqual([
      { revenueClass: 'RENTAL', label: 'ค่าเช่า', amount: 240 },
      { revenueClass: 'DELIVERY_FEE', label: 'ค่าขนส่ง', amount: 40 },
      { revenueClass: 'DISCOUNT', label: 'ส่วนลด', amount: -10 },
    ])
    expect(data.revenueTotal).toBe(270)
  })

  it('has no deposit received / returned figures (deposits are never recorded as money)', () => {
    const now = new Date()
    const data = getFinanceReportData({ startDate: now, endDate: now, granularity: 'daily' })
    expect(data).not.toHaveProperty('depositReceived')
    expect(data).not.toHaveProperty('depositRefunded')
  })
})
