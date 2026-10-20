// @vitest-environment jsdom
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
  user: { id: 'u1', role: 'USER', status: 'ACTIVE', menus: ['settings', 'pos'] } as Record<string, unknown>,
}))
vi.mock('@/lib/db/rpc', () => ({ rpc: mocks.rpc }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: (t: string) => (mocks.from(t), { select: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
}))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import {
  fetchSharedSystemConfig,
  rowToConfig,
  saveSettingsSection,
  sectionPatch,
  type StoreSettingsRow,
} from '@/features/settings/api/settings-repository'
import { DEFAULT_SYSTEM_CONFIG, type SystemConfig } from '@/features/settings/services/settings-storage'
import { applySectionSaved, applyServerUpdate, initSectionDrafts, isSectionDirty } from '@/features/settings/utils/section-drafts'
import { GRANTABLE_MENUS, hasMenu, menuForPath } from '@/features/auth/services/permissions'
import { calculateBillTotals, validateDiscountCeiling } from '@/lib/calculation-service'
import { ThemeProvider, useTheme } from '@/lib/contexts/ThemeContext'
import { SETTINGS_REGISTRY, REMOVED_SETTING_FIELDS } from '@/features/settings/settings-registry'
import { isIdleExpired } from '@/features/auth/services/pin-lock'
import SettingsPage from '@/app/settings/page'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'

const ROOT = path.resolve(__dirname, '..')

function row(over: Partial<StoreSettingsRow> = {}): StoreSettingsRow {
  return {
    company_name: null, tax_id: null, address: null, phone: null, logo_url: null, timezone: 'Asia/Bangkok',
    vat_enabled: false, vat_rate: null, vat_mode: null, doc_number_formats: {}, policies: {}, ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})
afterEach(cleanup)

describe('PERMISSION: shop settings are OWNER only', () => {
  const owner = { role: 'OWNER', status: 'ACTIVE', menus: [] } as never
  const user = { role: 'USER', status: 'ACTIVE', menus: ['settings', 'pos'] } as never

  it('1. a USER cannot open /settings even with an old settings grant; settings is not grantable', () => {
    expect(menuForPath('/settings')).toBe('settings')
    expect(hasMenu(user, 'settings')).toBe(false)
    expect(GRANTABLE_MENUS.map((m) => m.code)).not.toContain('settings')
  })

  it('1. the page itself refuses a USER (not only the hidden menu)', () => {
    mocks.user = { id: 'u1', role: 'USER', status: 'ACTIVE', menus: ['settings'] }
    render(<SystemSettingsProvider><SettingsPage /></SystemSettingsProvider>)
    expect(screen.getByText('ตั้งค่าระบบเปิดได้เฉพาะเจ้าของร้าน')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /บันทึก/ })).toBeNull()
  })

  it('2. the OWNER opens it and saves a section through settings_update', async () => {
    expect(hasMenu(owner, 'settings')).toBe(true)
    mocks.user = { id: 'o1', role: 'OWNER', status: 'ACTIVE', menus: [] }
    mocks.rpc.mockResolvedValue(row({ company_name: 'ร้านใหม่' }))
    render(<SystemSettingsProvider><SettingsPage /></SystemSettingsProvider>)
    const nameInput = screen.getAllByRole('textbox')[0] as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'ร้านใหม่' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    })
    expect(mocks.rpc).toHaveBeenCalledWith('settings_update', expect.objectContaining({ p_reason: 'แก้ข้อมูลกิจการ' }))
    expect(mocks.rpc.mock.calls[0][1].p_patch.company_name).toBe('ร้านใหม่')
  })

  it('3. /account is open to every member (own profile only)', () => {
    expect(menuForPath('/account')).toBeNull()
    const own = SETTINGS_REGISTRY.filter((d) => d.scope !== 'SYSTEM')
    expect(own.every((d) => d.permission === 'SELF')).toBe(true)
    expect(SETTINGS_REGISTRY.filter((d) => d.scope === 'SYSTEM').every((d) => d.permission === 'OWNER')).toBe(true)
  })
})

describe('DEVICE: theme', () => {
  it('4. theme is stored in this browser only and never sent to the server', () => {
    function Pick() {
      const { setTheme } = useTheme()
      return <button onClick={() => setTheme('dark')}>dark</button>
    }
    render(<ThemeProvider><Pick /></ThemeProvider>)
    fireEvent.click(screen.getByText('dark'))
    expect(localStorage.getItem('rental_pos_theme')).toBe('dark')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('SAVE: one section at a time', () => {
  it('5. saving section A sends only A keys (business never sends VAT, numbering or other policies)', async () => {
    mocks.rpc.mockResolvedValue(row())
    await saveSettingsSection('business', DEFAULT_SYSTEM_CONFIG)
    const patch = mocks.rpc.mock.calls[0][1].p_patch
    expect(Object.keys(patch).sort()).toEqual(['address', 'company_name', 'logo_url', 'phone', 'policies', 'tax_id'])
    expect(Object.keys(patch.policies)).toEqual(['business_profile'])
    expect(Object.keys(sectionPatch('taxDiscount', DEFAULT_SYSTEM_CONFIG)).sort()).toEqual(['policies', 'vat_mode', 'vat_rate'])
    expect(Object.keys(sectionPatch('documentNumbering', DEFAULT_SYSTEM_CONFIG))).toEqual(['doc_number_formats'])
    expect(Object.keys(sectionPatch('payment', DEFAULT_SYSTEM_CONFIG).policies as object).sort()).toEqual(['allow_overpayment', 'payment_receiving'])
    for (const s of ['business', 'taxDiscount', 'payment', 'salesRental', 'product', 'documentNumbering', 'notifications', 'shopSecurity'] as const) {
      expect(JSON.stringify(sectionPatch(s, DEFAULT_SYSTEM_CONFIG))).not.toContain('vat_enabled')
      expect(JSON.stringify(sectionPatch(s, DEFAULT_SYSTEM_CONFIG))).not.toContain('app_config')
    }
  })

  it('5. after a save of A, the unsaved draft of B is still there', () => {
    let d = initSectionDrafts(DEFAULT_SYSTEM_CONFIG)
    d = { ...d, product: { ...d.product, draft: { ...d.product.draft, product: { defaultReorderPoint: 9 } } } }
    const saved: SystemConfig = { ...DEFAULT_SYSTEM_CONFIG, business: { ...DEFAULT_SYSTEM_CONFIG.business, businessName: 'A' } }
    d = applySectionSaved(d, 'business', saved)
    expect(d.business.draft.business.businessName).toBe('A')
    expect(isSectionDirty(d.product, 'product')).toBe(true)
    expect(d.product.draft.product.defaultReorderPoint).toBe(9)
  })

  it('6. a server update refreshes clean sections but never overwrites a dirty one (conflict kept)', () => {
    let d = initSectionDrafts(DEFAULT_SYSTEM_CONFIG)
    d = { ...d, business: { ...d.business, draft: { ...d.business.draft, business: { ...d.business.draft.business, phone: 'mine' } } } }
    const remote: SystemConfig = {
      ...DEFAULT_SYSTEM_CONFIG,
      business: { ...DEFAULT_SYSTEM_CONFIG.business, phone: 'theirs' },
      notifications: { ...DEFAULT_SYSTEM_CONFIG.notifications, returnReminder: { enabled: false, daysBefore: 4 } },
    }
    d = applyServerUpdate(d, remote)
    expect(d.business.draft.business.phone).toBe('mine')
    expect(d.business.conflict).toBe(true)
    expect(d.notifications.draft.notifications.returnReminder).toEqual({ enabled: false, daysBefore: 4 })
    expect(d.notifications.conflict).toBe(false)
  })
})

describe('READ: one row, new source first, old app_config as fallback', () => {
  it('reads company columns, policy groups, numbering and VAT rate/mode', async () => {
    mocks.maybeSingle.mockResolvedValue({
      error: null,
      data: row({
        company_name: 'ร้านเอ', vat_enabled: true, vat_rate: '7.00', vat_mode: 'INCLUSIVE',
        doc_number_formats: { BILL: { prefix: 'ABC', digits: 3 } },
        policies: {
          business_profile: { email: 'new@shop.th' },
          app_config: { business: { email: 'old@shop.th', bankName: 'ธนาคารเดิม', businessName: 'ชื่อเดิม' } },
          discount_limit_enabled: true, discount_limit_percent: 15, allow_backorder: true,
        },
      }),
    })
    const cfg = await fetchSharedSystemConfig()
    expect(cfg?.business).toMatchObject({ businessName: 'ร้านเอ', email: 'new@shop.th', bankName: 'ธนาคารเดิม' })
    expect(cfg?.taxDiscount).toEqual({ vatRate: 7, vatMode: 'INCLUSIVE', discountLimitEnabled: true, discountLimitPercent: 15 })
    expect(cfg?.documentNumbering.BILL).toEqual({ prefix: 'ABC', digits: 3 })
    expect(cfg?.documentNumbering.QUOTATION).toEqual({ prefix: 'QT', digits: 3 })
    expect(cfg?.salesRental.allowBackorder).toBe(true)
  })

  it('signed out / no access → null', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    await expect(fetchSharedSystemConfig()).resolves.toBeNull()
  })

  it('old productStock.defaultMinimumStock is only a fallback for the new-product reorder point', () => {
    expect(rowToConfig(row({ policies: { app_config: { productStock: { defaultMinimumStock: 5 } } } })).product.defaultReorderPoint).toBe(5)
    expect(rowToConfig(row({ policies: { default_reorder_point: 1, app_config: { productStock: { defaultMinimumStock: 5 } } } })).product.defaultReorderPoint).toBe(1)
  })
})

describe('NO HARDCODED FALLBACKS', () => {
  it('11. no VAT without the OWNER rate, even when the bill switches VAT on', () => {
    const t = calculateBillTotals({ settings: DEFAULT_SYSTEM_CONFIG, items: [{ lineTotal: 100 }], enableVat: true })
    expect(t.vatRate).toBe(0)
    expect(t.vatAmount).toBe(0)
  })

  it('12. no 50% discount ceiling when the OWNER limit is off', () => {
    const t = calculateBillTotals({ settings: DEFAULT_SYSTEM_CONFIG, items: [{ lineTotal: 100 }], discount: 80 })
    expect(t.isDiscountExceeded).toBe(false)
    expect(() => validateDiscountCeiling(100, 80, DEFAULT_SYSTEM_CONFIG)).not.toThrow()
  })

  it('11/12. the old literal fallbacks are gone from the source', () => {
    const files = ['lib/calculation-service.ts', 'app/pos/page.tsx', 'features/quotations/services/quotation-storage.ts', 'features/pos/components/CartPanel.tsx']
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      expect(src).not.toMatch(/(\?\?|\|\|)\s*7\)\s*\/\s*100/)
      expect(src).not.toMatch(/maximumDiscountPercent\s*\?\?\s*50/)
    }
  })
})

describe('REMOVED SETTINGS', () => {
  const sourceFiles = (dir: string): string[] =>
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = path.join(dir, e.name)
      if (e.isDirectory()) return sourceFiles(rel)
      return /\.(ts|tsx)$/.test(e.name) ? [rel] : []
    })
  const files = ['app', 'components', 'features', 'lib'].flatMap(sourceFiles)
    .filter((f) => !f.endsWith('settings-registry.ts') && !f.endsWith('database.types.ts'))

  it('13. Settings has no printing section; the print flow keeps its own renderer', () => {
    const page = fs.readFileSync(path.join(ROOT, 'app/settings/page.tsx'), 'utf8')
    expect(page).not.toMatch(/การพิมพ์|paperSize|showQRCode|defaultCopies|footerText/)
    expect('documentPrinting' in DEFAULT_SYSTEM_CONFIG).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'lib/print/print-service.ts'))).toBe(true)
  })

  it('14. no payment-channel switches: every channel the POS supports stays available', async () => {
    expect(JSON.stringify(DEFAULT_SYSTEM_CONFIG)).not.toContain('paymentMethods')
    const { toServerMethod } = await vi.importActual<typeof import('@/features/bills/services/bill-service')>('@/features/bills/services/bill-service')
    expect(['CASH', 'TRANSFER', 'QR', 'CARD'].map(toServerMethod)).toEqual(['CASH', 'TRANSFER', 'QR', 'CARD'])
    const selector = fs.readFileSync(path.join(ROOT, 'features/pos/components/payment/PaymentMethodSelector.tsx'), 'utf8')
    const checkout = fs.readFileSync(path.join(ROOT, 'app/pos/checkout/page.tsx'), 'utf8')
    expect(selector).toContain("export type PaymentMethodType = 'CASH' | 'TRANSFER' | 'QR' | 'UNPAID'")
    expect(checkout).toContain('type PaymentMethodType')
  })

  it('16. no code still reads a removed settings group or field', () => {
    const groups = /\b(financePayment|productStock|documentPrinting|rentalBilling)\.|\.branding\b|getDefaultMinimumStock|saveSharedSystemConfig|saveSystemSettings/
    const fields = new RegExp(
      `\\.(${REMOVED_SETTING_FIELDS.filter((f) => !['paperSize', 'allowPartialReturn', 'allowPartialPayment', 'allowContinueAfterPaid', 'paymentMethods', 'vatEnabled'].includes(f)).join('|')})\\b`
    )
    const offenders = files.flatMap((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      // the repository reads one old key as a documented fallback; vatEnabled now means the bill's own VAT
      const text = f.endsWith('settings-repository.ts') ? src.replace(/legacy\.productStock\?\.defaultMinimumStock/g, '') : src
      return groups.test(text) || fields.test(text) ? [f] : []
    })
    expect(offenders).toEqual([])
  })
})

describe('AUTO-LOCK', () => {
  it('15. idle time is measured from the last activity, so background / sleep / reopen still lock', () => {
    const last = Date.parse('2026-10-07T10:00:00Z')
    expect(isIdleExpired(last, last + 59_000, 60)).toBe(false)
    expect(isIdleExpired(last, last + 60_000, 60)).toBe(true)
    expect(isIdleExpired(last, last + 10 * 3600_000, 0)).toBe(false) // never
    expect(isIdleExpired(null, last, 60)).toBe(false)
  })
})
