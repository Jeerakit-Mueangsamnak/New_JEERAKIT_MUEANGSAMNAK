// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  view: 'finance' as string | null,
  load: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => mocks.view }) }))
vi.mock('@/components/common/MasterDataProvider', () => ({ loadAllBusinessData: mocks.load }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('@/features/reports/services/report-data', () => ({
  getFinanceReportData: () => ({}),
  getSalesRentalReportData: () => ({}),
  getOperationsReportData: () => ({}),
  getStockReportData: () => ({}),
  getBusinessReportData: () => ({}),
}))
vi.mock('@/features/reports/components/ReportFilter', () => ({
  ReportFilter: ({ onRefresh }: { onRefresh: () => void }) => <button onClick={onRefresh}>รีเฟรช</button>,
}))
vi.mock('@/features/reports/components/FinanceReportView', () => ({ FinanceReportView: () => <div>รายงานการเงิน</div> }))
vi.mock('@/features/reports/components/SalesRentalReportView', () => ({ SalesRentalReportView: () => <div /> }))
vi.mock('@/features/reports/components/OperationsReportView', () => ({ OperationsReportView: () => <div /> }))
vi.mock('@/features/reports/components/StockReportView', () => ({ StockReportView: () => <div /> }))
vi.mock('@/features/reports/components/BusinessReportView', () => ({ BusinessReportView: () => <div /> }))

import ReportsPage from '@/app/reports/page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.view = 'finance'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(cleanup)

describe('reports page (audit UX-16 / UX-17)', () => {
  it('a refresh that fails says so (the old data stays on screen)', async () => {
    mocks.load.mockRejectedValue(new Error('network'))
    render(<ReportsPage />)
    await act(async () => {
      fireEvent.click(screen.getByText('รีเฟรช'))
    })
    expect(mocks.showToast).toHaveBeenCalledWith('รีเฟรชรายงานไม่สำเร็จ', expect.any(String), 'ERROR')
    expect(screen.getByText('รายงานการเงิน')).toBeTruthy()
  })

  it('a refresh that works shows no error', async () => {
    mocks.load.mockResolvedValue(undefined)
    render(<ReportsPage />)
    await act(async () => {
      fireEvent.click(screen.getByText('รีเฟรช'))
    })
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('a report name that does not exist shows a message instead of a blank page', () => {
    mocks.view = 'no-such-report'
    render(<ReportsPage />)
    expect(screen.getByRole('alert').textContent).toContain('ไม่พบรายงานที่เลือก')
  })

  it('a real report shows no such message', () => {
    render(<ReportsPage />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
