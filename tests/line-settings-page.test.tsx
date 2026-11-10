// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

/** คนใน LINE › ตั้งค่า LINE: connection (Vault, never shown back), staff LINE notices, message texts. */

const SECRET = '0123456789abcdef0123456789abcdef'
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  status: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  ask: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@/lib/db/rpc', () => ({ rpc: mocks.rpc }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        // list reads (LINE members / drivers) resolve to an empty list; single reads use maybeSingle
        const list: Record<string, unknown> = { maybeSingle: mocks.maybeSingle, then: (ok: (v: unknown) => unknown) => ok({ data: [], error: null }) }
        for (const k of ['eq', 'not', 'order']) list[k] = () => list
        return list
      },
    }),
  }),
}))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'o1', role: 'OWNER', status: 'ACTIVE', menus: [] } }) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
vi.mock('@/components/common/ConfirmDialogProvider', () => ({
  useAskText: () => mocks.ask,
  useConfirm: () => async () => true,
}))
vi.mock('@/app/actions/system-secrets', () => ({
  getLineSecretStatus: mocks.status,
  saveLineSecrets: mocks.save,
  clearLineSecrets: mocks.clear,
}))

import { rowToConfig, sectionPatch, type StoreSettingsRow } from '@/features/settings/api/settings-repository'
import { DEFAULT_SYSTEM_CONFIG } from '@/features/settings/services/settings-storage'
import { validateSection } from '@/features/settings/utils/settings-validation'
import { LineSettingsWorkspace } from '@/features/settings/components/LineSettingsWorkspace'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'

function row(policies: Record<string, unknown>): StoreSettingsRow {
  return {
    company_name: 'ร้านเอ', tax_id: null, address: null, phone: null, logo_url: null, timezone: 'Asia/Bangkok',
    vat_enabled: false, vat_rate: null, vat_mode: null, doc_number_formats: {}, policies,
  }
}
const notConfigured = { available: true, lineSecretConfigured: false, lineTokenConfigured: false, liveDelivery: false }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
  mocks.status.mockResolvedValue(notConfigured)
})
afterEach(cleanup)

/** ตั้งค่า LINE → one of its sub-tabs. */
async function openLineSettings(view: string) {
  await act(async () => {
    render(<SystemSettingsProvider><LineSettingsWorkspace /></SystemSettingsProvider>)
  })
  await act(async () => {
    fireEvent.click(within(screen.getByRole('tablist', { name: 'LINE' })).getByRole('tab', { name: view }))
  })
}

describe('ตั้งค่า LINE in คนใน LINE', () => {
  it('a sub-page with settings has its own save; saving sends only that sub-page', async () => {
    mocks.rpc.mockImplementation(async (_fn: string, args: { p_patch: { policies: Record<string, unknown> } }) => row(args.p_patch.policies))
    await openLineSettings('แจ้งเตือนพนักงานทาง LINE')
    const save = screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'เลยกำหนดคืน' }))
    })
    expect(save.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(save)
    })
    expect(mocks.rpc).toHaveBeenCalledWith('settings_update', expect.objectContaining({ p_patch: expect.anything() }))
    const sent = mocks.rpc.mock.calls[0][1].p_patch.policies.line
    expect(sent.notify).toEqual({ RENTAL_OVERDUE: true })
    expect(mocks.toast).toHaveBeenCalledWith('บันทึกแล้ว', expect.stringContaining('แจ้งเตือนพนักงานทาง LINE'), 'SUCCESS')
  })

  it('a sub-page without settings (เชื่อมต่อ LINE OA) has no page save bar', async () => {
    await openLineSettings('เชื่อมต่อ LINE OA')
    expect(screen.queryByRole('button', { name: 'บันทึกการตั้งค่า' })).toBeNull()
  })
})

describe('policies.line in the settings model', () => {
  it('reads notify / templates and keeps the keys this screen does not edit', () => {
    const cfg = rowToConfig(row({ line: { linkMaxFailures: 5, notify: { PAYMENT_DUE: true, LOW_STOCK: false }, templates: { TEST: 'ทดสอบ {ชื่อร้าน}' } } }))
    expect(cfg.line).toEqual({ notify: { PAYMENT_DUE: true }, templates: { TEST: 'ทดสอบ {ชื่อร้าน}' }, other: { linkMaxFailures: 5 } })
    expect(sectionPatch('line', cfg)).toEqual({
      policies: { line: { linkMaxFailures: 5, notify: { PAYMENT_DUE: true }, templates: { TEST: 'ทดสอบ {ชื่อร้าน}' } } },
    })
  })

  it('sends only switched-on types and non-empty texts, in a stable order', () => {
    const cfg = { ...DEFAULT_SYSTEM_CONFIG, line: { notify: { RENTAL_OVERDUE: true, APPOINTMENT_DUE: true, LOW_STOCK: false }, templates: { TASK_NEW: '  ', TASK_DONE: ' เสร็จ {เรื่อง} ' }, other: {} } }
    expect(JSON.stringify(sectionPatch('line', cfg))).toBe(
      JSON.stringify({ policies: { line: { notify: { APPOINTMENT_DUE: true, RENTAL_OVERDUE: true }, templates: { TASK_DONE: 'เสร็จ {เรื่อง}' } } } }),
    )
  })

  it('refuses a text that uses a placeholder its message does not have', () => {
    const cfg = { ...DEFAULT_SYSTEM_CONFIG, line: { notify: {}, templates: { TASK_NEW: 'งาน {ชื่อลูกค้า}' }, other: {} } }
    expect(validateSection('line', cfg)).toMatch(/ตัวแปร/)
    const ok = { ...DEFAULT_SYSTEM_CONFIG, line: { notify: {}, templates: { TASK_NEW: 'งานจาก {ผู้สั่ง}: {เรื่อง}' }, other: {} } }
    expect(validateSection('line', ok)).toBeNull()
  })
})
