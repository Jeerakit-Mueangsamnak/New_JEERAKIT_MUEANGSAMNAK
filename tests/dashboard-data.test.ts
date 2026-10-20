import { describe, expect, it } from 'vitest'
import { computeDashboardMetrics } from '@/features/dashboard/services/dashboard-data'
import { shopLocalDateTimeToIso } from '@/features/appointments/services/appointment-storage'
import type { StatementTransaction } from '@/features/finance/services/finance-storage'
import type { Appointment, Product } from '@/lib/types/rental-pos'
import type { FullBill, FullBillItem } from '@/lib/types/rental-return'

const item = (overrides: Partial<FullBillItem> = {}): FullBillItem => ({
  rentalBillItemId: 'line-rental',
  productId: 'product-rental',
  productCode: 'RENT-1',
  productName: 'Rental item',
  quantity: 1,
  returnedQty: 0,
  outstandingQty: 1,
  dailyRate: 0,
  unit: 'piece',
  defaultRepairFee: 0,
  defaultReplacementFee: 0,
  requiresReturn: true,
  rentalStartDate: '2026-10-15',
  scheduledReturnDate: '2026-10-16',
  status: 'RENTING',
  ...overrides,
})

const bill = (items: FullBillItem[], overrides: Partial<FullBill> = {}): FullBill => ({
  id: 'bill-1',
  customerId: 'customer-1',
  billNo: 'B-1',
  billDate: '2026-10-15',
  customerName: 'Customer one',
  customerPhone: '',
  rentalStartDate: '2026-10-15',
  scheduledReturnDate: '2026-10-16',
  heldDepositAmount: 0,
  paidDepositAmount: 0,
  deposits: [],
  subtotal: 180,
  billDiscountAmount: 18,
  taxableAmount: 147.27,
  taxAmount: 14.73,
  vatMode: 'INCLUSIVE',
  billAmount: 162,
  confirmedAt: '2026-10-14T17:30:00.000Z',
  grandTotal: 162,
  paidAmount: 85,
  outstandingAmount: 77,
  rentalStatus: 'RENTING',
  paymentStatus: 'PARTIAL',
  items,
  ...overrides,
})

const transaction = (overrides: Partial<StatementTransaction>): StatementTransaction => ({
  id: 'tx-1',
  dateTime: '2026-10-15T03:00:00.000Z',
  refNo: 'R-1',
  type: 'INCOME',
  category: 'รับชำระบิล',
  description: '',
  incomeAmount: 0,
  expenseAmount: 0,
  runningBalance: 0,
  channel: 'CASH',
  billId: 'bill-1',
  ...overrides,
})

const appointment = (overrides: Partial<Appointment>): Appointment => ({
  id: 'appointment-1',
  customerName: 'Customer one',
  title: 'Delivery',
  type: 'DELIVERY',
  date: '2026-10-15',
  startTime: '10:00',
  endTime: '11:00',
  status: 'SCHEDULED',
  ...overrides,
})

const product = (overrides: Partial<Product>): Product => ({
  id: 'product-1',
  code: 'P-1',
  name: 'Product one',
  category: 'Equipment',
  unit: 'piece',
  rentalType: 'DAILY',
  normalPrice: 0,
  dailyPrice: 0,
  defaultDamageFee: 0,
  defaultLossFee: 0,
  totalQuantity: 0,
  availableQuantity: 0,
  rentedQuantity: 0,
  damagedQuantity: 0,
  lostQuantity: 0,
  minimumStock: 0,
  status: 'ACTIVE',
  ...overrides,
})

describe('dashboard data uses saved records and bill amounts consistently', () => {
  it('allocates bill discount by line value and removes inclusive VAT from product revenue', () => {
    const metrics = computeDashboardMetrics(
      [],
      [bill([
        item({ lineTotal: 120 }),
        item({
          rentalBillItemId: 'line-sale',
          productId: 'product-sale',
          productCode: 'SALE-1',
          productName: 'Sale item',
          requiresReturn: false,
          rentalType: 'SALE',
          itemType: 'SALE',
          status: 'DELIVERED',
          lineTotal: 60,
        }),
      ])],
      [],
      [],
      [],
      [],
      new Map(),
      'Asia/Bangkok',
      new Date('2026-10-15T03:00:00.000Z')
    )

    expect(metrics.rentalRevenue).toBeCloseTo(98.18, 2)
    expect(metrics.salesRevenue).toBeCloseTo(49.09, 2)
    expect(metrics.topRevenueProducts).toHaveLength(2)
    expect(metrics.topRevenueProducts[0].revenue).toBeCloseTo(98.18, 2)
    expect(metrics.topRevenueProducts[1].revenue).toBeCloseTo(49.09, 2)
    expect(metrics.topRentedProducts).toHaveLength(1)
    expect(metrics.topRentedProducts[0]).toMatchObject({ name: 'Rental item', rentalCount: 1 })
  })

  it('keeps bill value, net receipts, VAT, and refunds as separate measures', () => {
    const metrics = computeDashboardMetrics(
      [
        transaction({ id: 'payment-1', incomeAmount: 100 }),
        transaction({
          id: 'refund-1',
          type: 'EXPENSE',
          category: 'คืนเงินลูกค้า',
          incomeAmount: 0,
          expenseAmount: 15,
        }),
      ],
      [bill([item({ lineTotal: 180 })])],
      [],
      [],
      [],
      [],
      new Map(),
      'Asia/Bangkok',
      new Date('2026-10-15T03:00:00.000Z')
    )

    expect(metrics.monthlyTrend.at(-1)).toMatchObject({
      revenue: 147.27,
      receivedAmount: 85,
      billsCount: 1,
    })
    expect(metrics.netCashReceived).toBe(85)
    expect(metrics.topCustomers[0]).toMatchObject({
      billedAmount: 147.27,
      vatAmount: 14.73,
      receivedAmount: 85,
      outstandingAmount: 77,
    })
  })

  it('counts only non-cancelled appointments whose saved date is today in the shop timezone', () => {
    const metrics = computeDashboardMetrics(
      [],
      [],
      [],
      [],
      [],
      [
        appointment({ id: 'today-delivery', type: 'DELIVERY', date: '2026-10-15' }),
        appointment({ id: 'today-return', type: 'RETURN', date: '2026-10-15' }),
        appointment({ id: 'cancelled', type: 'DELIVERY', date: '2026-10-15', status: 'CANCELLED' }),
        appointment({ id: 'yesterday', date: '2026-10-14' }),
      ],
      new Map(),
      'Asia/Bangkok',
      new Date('2026-10-14T17:30:00.000Z')
    )

    expect(metrics.todayTasksCount).toBe(2)
    expect(metrics.todayDeliveriesCount).toBe(1)
    expect(metrics.todayReturnsCount).toBe(1)
  })

  it('uses each product reorder point for the dashboard low-stock list', () => {
    const metrics = computeDashboardMetrics(
      [],
      [],
      [
        product({ id: 'at-reorder-point', availableQuantity: 2, minimumStock: 2 }),
        product({ id: 'above-reorder-point', availableQuantity: 3, minimumStock: 2 }),
        product({ id: 'no-reorder-point', availableQuantity: 0, minimumStock: 0 }),
      ],
      [],
      [],
      [],
      new Map(),
      'Asia/Bangkok',
      new Date('2026-10-15T03:00:00.000Z')
    )

    expect(metrics.stockUrgentList.filter(({ id }) => id.startsWith('low-')).map(({ id }) => id))
      .toEqual(['low-at-reorder-point'])
  })

  it('reads reserved inventory quantity from product stock balances, separate from bill delivery items', () => {
    const metrics = computeDashboardMetrics(
      [],
      [],
      [product({ availableQuantity: 2, rentedQuantity: 3, reservedQuantity: 4 })],
      [],
      [],
      [],
      new Map(),
      'Asia/Bangkok',
      new Date('2026-10-15T03:00:00.000Z')
    )

    expect(metrics.reservedStock).toBe(4)
    expect(metrics.rentedOrReservedStock).toBe(7)
    expect(metrics.assetStatusData.find(({ label }) => label === 'จองคิว')?.count).toBe(4)
    expect(metrics.stockDonutData.find(({ label }) => label === 'จองคิว')?.value).toBe(4)
    expect(metrics.pendingBillDeliveryItemCount).toBe(0)
  })

  it('labels the stock alert total as damaged plus lost inventory', () => {
    const metrics = computeDashboardMetrics(
      [],
      [],
      [product({ damagedQuantity: 2, lostQuantity: 3 })],
      [],
      [],
      [],
      new Map(),
      'Asia/Bangkok',
      new Date('2026-10-15T03:00:00.000Z')
    )

    expect(metrics.stockAlertsSummary.damagedCount).toBe(2)
  })

  it('does not count a cancelled paid bill as an active paid bill', () => {
    const metrics = computeDashboardMetrics(
      [],
      [
        bill([item({ lineTotal: 180 })], { paymentStatus: 'PAID' }),
        bill([item({ lineTotal: 180 })], {
          id: 'cancelled-bill',
          billNo: 'B-CANCELLED',
          rentalStatus: 'CANCELLED',
          paymentStatus: 'PAID',
        }),
      ],
      [],
      [],
      [],
      [],
      new Map(),
      'Asia/Bangkok',
      new Date('2026-10-15T03:00:00.000Z')
    )

    expect(metrics.billStatusCounts.paid).toBe(1)
    expect(metrics.billStatusCounts.cancelled).toBe(1)
  })
})

describe('appointment shop timezone conversion', () => {
  it('converts the shop wall-clock time using the store timezone, not the browser timezone', () => {
    expect(shopLocalDateTimeToIso('2026-10-15', '10:00', 'Asia/Bangkok'))
      .toBe('2026-10-15T03:00:00.000Z')
  })

  it('rejects a nonexistent wall-clock time instead of silently shifting it', () => {
    expect(() => shopLocalDateTimeToIso('2026-03-08', '02:30', 'America/New_York'))
      .toThrow(/does not exist in shop timezone/)
  })
})
