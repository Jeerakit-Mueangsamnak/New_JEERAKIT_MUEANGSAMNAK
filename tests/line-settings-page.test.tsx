// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

/** Settings › LINE: connection (Vault, never shown back), staff LINE notices, message texts. */

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
vi.mock('@/components/common/ConfirmDialogProvider', () => ({ useAskText: () => mocks.ask }))
vi.mock('@/app/actions/system-secrets', () => ({
  getLineSecretStatus: mocks.status,
  saveLineSecrets: mocks.save,
  clearLineSecrets: mocks.clear,
}))

import { rowToConfig, sectionPatch, type StoreSettingsRow } from '@/features/settings/api/settings-repository'
import { DEFAULT_SYSTEM_CONFIG } from '@/features/settings/services/settings-storage'
import { validateSection } from '@/features/settings/utils/settings-validation'
import SettingsPage from '@/app/settings/page'
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

/** LINE tab → one of its sub-tabs. */
async function openLineTab(view = 'ตั้งค่าการเชื่อมต่อ') {
  await act(async () => {
    render(<SystemSettingsProvider><SettingsPage /></SystemSettingsProvider>)
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'LINE' }))
  })
  await pickLineView(view)
}
async function pickLineView(view: string) {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('tablist', { name: 'LINE' })).getByRole('tab', { name: view }))
  })
}

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

describe('Settings › LINE screen', () => {
  it('shows the connection state and test mode, never a value', async () => {
    mocks.status.mockResolvedValue({ available: true, lineSecretConfigured: true, lineTokenConfigured: false, liveDelivery: false })
    await openLineTab()
    const status = screen.getByTestId('line-status')
    expect(status.textContent).toContain('ตั้งแล้ว')
    expect(status.textContent).toContain('ยังไม่ตั้ง')
    expect(status.textContent).toContain('ทดสอบ (ไม่ส่งถึง LINE จริง)')
    expect((screen.getByLabelText('Channel Secret') as HTMLInputElement).type).toBe('password')
    expect((screen.getByLabelText('Channel Access Token') as HTMLInputElement).value).toBe('')
    expect((screen.getByDisplayValue(/\/api\/line\/webhook$/) as HTMLInputElement).readOnly).toBe(true)
  })

  it('saves credentials through the Vault action and clears what was typed', async () => {
    mocks.save.mockResolvedValue({ ...notConfigured, lineSecretConfigured: true })
    await openLineTab()
    fireEvent.change(screen.getByLabelText('Channel Secret'), { target: { value: SECRET } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'บันทึกการเชื่อมต่อ' }))
    })
    expect(mocks.save).toHaveBeenCalledWith({ lineSecret: SECRET, lineToken: undefined })
    expect((screen.getByLabelText('Channel Secret') as HTMLInputElement).value).toBe('')
    expect(document.body.innerHTML).not.toContain(SECRET)
    // credentials never go through settings_update
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('clearing asks for a reason first; no reason, nothing cleared', async () => {
    mocks.status.mockResolvedValue({ ...notConfigured, lineSecretConfigured: true, lineTokenConfigured: true })
    mocks.ask.mockResolvedValueOnce(null)
    await openLineTab()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ล้างการเชื่อมต่อ' }))
    })
    expect(mocks.clear).not.toHaveBeenCalled()
    mocks.ask.mockResolvedValueOnce('เปลี่ยน OA')
    mocks.clear.mockResolvedValue(notConfigured)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ล้างการเชื่อมต่อ' }))
    })
    expect(mocks.clear).toHaveBeenCalledWith('เปลี่ยน OA')
  })

  it('a staff notice switch and a message text save together with the section save', async () => {
    mocks.rpc.mockResolvedValue(row({ line: { notify: { APPOINTMENT_DUE: true }, templates: { TASK_NEW: 'มีงาน: {เรื่อง}' } } }))
    await openLineTab('แจ้งเตือน')
    expect(screen.queryByLabelText('สั่งงานใหม่')).toBeNull() // texts live in their own section
    fireEvent.click(screen.getByRole('switch', { name: 'นัดหมายใกล้ถึง' }))
    await pickLineView('บล็อกข้อความ')
    expect(screen.queryByRole('switch', { name: 'นัดหมายใกล้ถึง' })).toBeNull()
    fireEvent.change(screen.getByLabelText('สั่งงานใหม่'), { target: { value: 'มีงาน: {เรื่อง}' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    })
    expect(mocks.rpc).toHaveBeenCalledWith('settings_update', {
      p_patch: { policies: { line: { notify: { APPOINTMENT_DUE: true }, templates: { TASK_NEW: 'มีงาน: {เรื่อง}' } } } },
      p_reason: 'แก้การตั้งค่า LINE',
    })
  })

  it('a wrong placeholder is stopped before the server', async () => {
    await openLineTab('บล็อกข้อความ')
    fireEvent.change(screen.getByLabelText('สั่งงานใหม่'), { target: { value: 'งาน {ชื่อลูกค้า}' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('บันทึกไม่สำเร็จ', expect.stringMatching(/ตัวแปร/), 'ERROR')
  })
})
