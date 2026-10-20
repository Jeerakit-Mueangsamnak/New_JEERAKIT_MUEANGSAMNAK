import { afterEach, describe, expect, it, vi } from 'vitest'
import { setCachedCustomers } from '@/features/customers/services/customer-storage'
import { setCachedBills } from '@/features/bills/services/bill-storage'
import { setCachedTransactions } from '@/features/finance/services/finance-storage'
import { setCachedQuotations } from '@/features/quotations/services/quotation-storage'
import { getBusinessReportData } from '@/features/reports/services/business-report-data'
import { getFinanceReportData } from '@/features/reports/services/finance-report-data'
import { calculateGrowth } from '@/features/reports/services/report-data-common'
import { getSalesRentalReportData } from '@/features/reports/services/sales-rental-report-data'
import type { FullBill } from '@/lib/types/rental-return'

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
  grandTotal: 1000,
  paidAmount: 0,
  outstandingAmount: 1000,
  rentalStatus: 'RENTING',
  paymentStatus: 'UNPAID',
  items: [],
  ...overrides,
})

afterEach(() => {
  setCachedBills([])
  setCachedTransactions([])
  setCachedCustomers([])
  setCachedQuotations([])
  vi.useRealTimers()
})

describe('report calculations', () => {
  it('does not invent a growth percentage when the previous period has no base', () => {
    expect(calculateGrowth(2200, 0)).toBeNull()
    expect(calculateGrowth(0, 0)).toBeNull()
    expect(calculateGrowth(2200, 1100)).toBe(100)
  })

  it('calculates debt overdue days from payment due date, not rental return date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T07:00:00+07:00'))
    setCachedTransactions([])
    setCachedBills([
      bill({
        id: 'payment-overdue',
        dueDate: '2026-10-10',
        scheduledReturnDate: '2026-10-25',
      }),
      bill({
        id: 'rental-overdue-only',
        dueDate: '2026-10-20',
        scheduledReturnDate: '2026-10-10',
      }),
      bill({
        id: 'missing-payment-due-date',
        dueDate: undefined,
        scheduledReturnDate: '2026-10-10',
      }),
    ])

    const data = getFinanceReportData({
      startDate: new Date('2026-10-01T00:00:00'),
      endDate: new Date('2026-10-16T23:59:59'),
      granularity: 'daily',
    })
    const byId = new Map(data.debtorBills.map((debtor) => [debtor.id, debtor]))

    expect(byId.get('payment-overdue')?.daysOverdue).toBe(6)
    expect(byId.get('rental-overdue-only')?.daysOverdue).toBe(0)
    expect(byId.get('missing-payment-due-date')?.daysOverdue).toBe(0)
  })

  it('aggregates the deposit amounts stated on non-cancelled bills', () => {
    setCachedTransactions([])
    setCachedBills([
      bill({ id: 'bill-with-deposit-1', heldDepositAmount: 500 }),
      bill({ id: 'bill-with-deposit-2', heldDepositAmount: 800 }),
      bill({ id: 'cancelled-bill', rentalStatus: 'CANCELLED', heldDepositAmount: 300 }),
    ])

    const data = getFinanceReportData({
      startDate: new Date('2026-10-01T00:00:00'),
      endDate: new Date('2026-10-16T23:59:59'),
      granularity: 'daily',
    })

    expect(data.billDepositAmount).toBe(1300)
    expect(data.billsWithDepositCount).toBe(2)
  })

  it('uses the shared bill discount and VAT allocation for sales and rental report totals', () => {
    const rentalItem = {
      rentalBillItemId: 'rental-line',
      productId: 'rental-product',
      productCode: 'R-1',
      productName: 'Rental product',
      quantity: 1,
      returnedQty: 0,
      outstandingQty: 1,
      dailyRate: 120,
      lineTotal: 120,
      unit: 'piece',
      defaultRepairFee: 0,
      defaultReplacementFee: 0,
      requiresReturn: true,
      rentalStartDate: '2026-10-15',
      scheduledReturnDate: '2026-10-16',
      status: 'RENTING',
      rentalType: 'DAILY',
    } as const
    const saleItem = {
      ...rentalItem,
      rentalBillItemId: 'sale-line',
      productId: 'sale-product',
      productCode: 'S-1',
      productName: 'Sale product',
      requiresReturn: false,
      rentalType: 'SALE',
      status: 'DELIVERED',
      lineTotal: 60,
    } as const
    setCachedBills([
      bill({
        customerId: 'customer-1',
        billDate: '2026-10-15',
        subtotal: 180,
        billDiscountAmount: 18,
        taxableAmount: 147.27,
        taxAmount: 14.73,
        vatMode: 'INCLUSIVE',
        billAmount: 162,
        grandTotal: 162,
        items: [rentalItem, saleItem],
      }),
      bill({ id: 'cancelled', rentalStatus: 'CANCELLED', items: [rentalItem] }),
      bill({ id: 'draft', rentalStatus: 'DRAFT', items: [rentalItem] }),
    ])
    setCachedQuotations([])
    setCachedCustomers([])
    const filter = {
      startDate: new Date('2026-10-01T00:00:00'),
      endDate: new Date('2026-10-16T23:59:59'),
      granularity: 'daily' as const,
    }

    const salesRental = getSalesRentalReportData(filter)
    const business = getBusinessReportData(filter)

    expect(salesRental.salesRevenue).toBeCloseTo(49.09, 2)
    expect(salesRental.rentalRevenue).toBeCloseTo(98.18, 2)
    expect(salesRental.salesVsRentalTrend.reduce((sum, bucket) => sum + bucket.sales, 0)).toBeCloseTo(49.09, 2)
    expect(salesRental.salesVsRentalTrend.reduce((sum, bucket) => sum + bucket.rental, 0)).toBeCloseTo(98.18, 2)
    expect(salesRental.totalBillsValue).toBe(162)
    expect(business.currentRevenue).toBeCloseTo(147.27, 2)
    expect(business.revenueGrowth).toBeNull()
  })
})
