import { describe, expect, it } from 'vitest'
import { effectiveAutoLockSeconds } from '@/features/auth/services/pin-lock'
import { auditCategoryOf } from '@/features/audits/services/audit-storage'
import { DEFAULT_NOTIFICATION_PREFS, normalizeNotificationPrefs } from '@/features/notifications/services/notification-prefs'

// Settings / permissions check 2026-10-18: central values set by the OWNER win over personal ones.
describe('effectiveAutoLockSeconds (personal choice never outlasts the OWNER options)', () => {
  const allowed = [30, 60, 120, 300]

  it('keeps the member choice while the OWNER still allows it', () => {
    expect(effectiveAutoLockSeconds(60, allowed, 300)).toBe(60)
  })

  it('falls back to the shop default when the choice was removed (e.g. "never")', () => {
    expect(effectiveAutoLockSeconds(0, allowed, 300)).toBe(300)
    expect(effectiveAutoLockSeconds(600, allowed, 120)).toBe(120)
  })

  it('uses the first allowed time when the default is not allowed either', () => {
    expect(effectiveAutoLockSeconds(0, allowed, 600)).toBe(30)
  })

  it('leaves the value alone when the server sent no options', () => {
    expect(effectiveAutoLockSeconds(0, [], 300)).toBe(0)
  })
})

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

describe('normalizeNotificationPrefs (own notification switches, ตั้งค่าส่วนตัว)', () => {
  it('starts from the defaults when nothing is saved', () => {
    expect(normalizeNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect(normalizeNotificationPrefs('x')).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })

  it('keeps saved switches and days, and drops broken values', () => {
    const p = normalizeNotificationPrefs({
      paymentReminder: { enabled: false, daysBefore: 5 },
      lowStockReminder: { enabled: false, daysBefore: 9 },
      returnReminder: { enabled: 'yes', daysBefore: -1 },
      unknown: { enabled: true },
    })
    expect(p.paymentReminder).toEqual({ enabled: false, daysBefore: 5 })
    expect(p.lowStockReminder).toEqual({ enabled: false })
    expect(p.returnReminder).toEqual({ enabled: true, daysBefore: 1 })
    expect(p).not.toHaveProperty('unknown')
  })
})
