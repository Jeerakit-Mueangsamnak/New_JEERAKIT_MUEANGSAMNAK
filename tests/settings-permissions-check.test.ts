import { describe, expect, it } from 'vitest'
import { auditCategoryOf } from '@/features/audits/services/audit-storage'

describe('auditCategoryOf (audit tabs filter by the real entity type)', () => {
  it('groups database entity types under the audit tabs', () => {
    expect(auditCategoryOf('BILL')).toBe('BILL')
    expect(auditCategoryOf('QUOTATION')).toBe('BILL')
    expect(auditCategoryOf('CUSTOMER_DOCUMENT')).toBe('CUSTOMER')
    expect(auditCategoryOf('PRODUCT')).toBe('STOCK')
    expect(auditCategoryOf('STOCK_COUNT')).toBe('STOCK')
    expect(auditCategoryOf('MEMBER')).toBe('MEMBER')
    expect(auditCategoryOf('REFUND')).toBe('FINANCE')
    expect(auditCategoryOf('EXPENSE')).toBe('FINANCE')
  })

  it('puts settings and unknown types under SYSTEM', () => {
    expect(auditCategoryOf('STORE_SETTINGS')).toBe('SYSTEM')
    expect(auditCategoryOf('LINE_CHANNEL')).toBe('SYSTEM')
    expect(auditCategoryOf(undefined)).toBe('SYSTEM')
  })
})
