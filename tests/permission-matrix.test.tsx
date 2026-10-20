// @vitest-environment jsdom
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ACTION_PERMISSIONS, GRANTABLE_ACTIONS, actionAccess } from '@/features/auth/services/permission-matrix'
import { PermissionMatrixPanel } from '@/features/auth/components/PermissionMatrixPanel'
import { GRANTABLE_MENUS } from '@/features/auth/services/permissions'

afterEach(cleanup)

const action = (id: string) => ACTION_PERMISSIONS.find((a) => a.id === id)!
const noop = () => {}
const panelProps = { draftActions: [] as string[], actionGrantsAvailable: true, onToggleAction: noop, dirty: false, saving: false, onToggle: noop, onPresetPos: noop, onSelectAll: noop, onClear: noop, onCancel: noop, onSave: noop }

describe('permission matrix follows the existing server rules (no new permission system)', () => {
  it('OWNER has every action; USER needs one of the menus; owner-only actions stay locked', () => {
    expect(ACTION_PERMISSIONS.every((a) => actionAccess('OWNER', [], a) === 'ALLOWED')).toBe(true)
    expect(actionAccess('USER', [], action('refund'))).toBe('NO_MENU')
    expect(actionAccess('USER', ['finance'], action('refund'), ['REFUND'])).toBe('ALLOWED')
    expect(actionAccess('USER', ['bills'], action('refund'), ['REFUND'])).toBe('ALLOWED')
    expect(actionAccess('USER', ['customers'], action('customer'))).toBe('ALLOWED')
    expect(actionAccess('USER', ['pos'], action('product_price'))).toBe('NO_MENU')
    for (const id of ['audit', 'members', 'settings']) {
      expect(actionAccess('USER', GRANTABLE_MENUS.map((m) => m.code), action(id))).toBe('OWNER_ONLY')
    }
  })

  it('each action uses the same menus and PIN code as the database function that checks it', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../supabase/baseline/00_baseline.sql'), 'utf8')
    const body = (fn: string) => {
      const i = sql.indexOf(`CREATE FUNCTION public.${fn}(`)
      expect(i).toBeGreaterThan(-1)
      return sql.slice(i, sql.indexOf('\n$$;', i))
    }
    for (const a of ACTION_PERMISSIONS.filter((x) => !x.ownerOnly)) {
      const fn = a.rpc.split(/[ ,(]/)[0]
      const menus = [...body(fn).matchAll(/_require_menu\(([^)]*)\)/g)].map((m) => m[1].replace(/'/g, '').split(/,\s*/))[0]
      expect([fn, menus?.sort()]).toEqual([fn, [...a.menus].sort()])
      if (a.pin === 'ALWAYS') expect(body(fn)).toMatch(/_require_pin\(/)
    }
  })

  it('OWNER: no checkboxes, everything shown as full', () => {
    render(<PermissionMatrixPanel {...panelProps} member={{ id: 'o', name: 'Owner', role: 'OWNER', status: 'ACTIVE' }} draftMenus={[]} />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByText('บันทึกสิทธิ์')).toBeNull()
  })

  it('USER: grantable menus get a box, settings / member management are locked (no fake toggle)', () => {
    const onToggle = vi.fn()
    render(
      <PermissionMatrixPanel {...panelProps} onToggle={onToggle} member={{ id: 'u', name: 'Staff', role: 'USER', status: 'ACTIVE' }} draftMenus={['pos']} />
    )
    expect(screen.getAllByRole('checkbox')).toHaveLength(GRANTABLE_MENUS.length + GRANTABLE_ACTIONS.length)
    expect(screen.queryByLabelText('ให้สิทธิ์เมนู settings')).toBeNull()
    expect(screen.queryByLabelText('ให้สิทธิ์เมนู members')).toBeNull()
    expect(screen.getAllByText('เฉพาะเจ้าของร้าน').length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByLabelText('ให้สิทธิ์เมนู finance'))
    expect(onToggle).toHaveBeenCalledWith('finance')
  })

  it('a member waiting for approval cannot be given menus yet', () => {
    render(<PermissionMatrixPanel {...panelProps} member={{ id: 'p', name: 'New', role: 'USER', status: 'PENDING' }} draftMenus={[]} />)
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).every((c) => c.disabled)).toBe(true)
  })
})

describe('risky actions are real per-USER grants (default deny)', () => {
  it('USER: menu without the grant = not granted; Void and Refund, price and stock are separate', () => {
    expect(actionAccess('USER', ['bills', 'finance'], action('refund'))).toBe('NOT_GRANTED')
    expect(actionAccess('USER', ['bills', 'finance'], action('refund'), ['BILL_VOID'])).toBe('NOT_GRANTED')
    expect(actionAccess('USER', ['bills'], action('bill_void'), ['BILL_VOID'])).toBe('ALLOWED')
    expect(actionAccess('USER', ['products'], action('product_price'), ['STOCK_ADJUST'])).toBe('NOT_GRANTED')
    expect(actionAccess('USER', ['products'], action('stock_adjust'), ['STOCK_ADJUST'])).toBe('ALLOWED')
    expect(actionAccess('USER', [], action('refund'), ['REFUND'])).toBe('NO_MENU')
    expect(ACTION_PERMISSIONS.filter((a) => a.grant).map((a) => a.grant).sort()).toEqual([...GRANTABLE_ACTIONS].sort())
  })

  it('every grant is checked by the server functions of that action (migration), before the PIN', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261007131509_member_action_grants.sql'), 'utf8')
    const body = (fn: string) => {
      const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`)
      expect(i, fn).toBeGreaterThan(-1)
      return sql.slice(i, sql.indexOf('\n$$;', i))
    }
    const expected: Record<string, string[]> = {
      PRODUCT_PRICE_CHANGE: ['product_set_price'],
      STOCK_ADJUST: ['stock_adjust', 'convert_damaged_stock'],
      BILL_VOID: ['bill_void', 'bill_cancel'],
      REFUND: ['refund_pay'],
      EXPENSE: ['expense_create', 'expense_void'],
      WRITE_OFF: ['write_off_record'],
    }
    for (const [code, fns] of Object.entries(expected)) {
      for (const fn of fns) {
        const b = body(fn)
        const at = b.indexOf(`_require_action('${code}')`)
        expect(at, `${fn} checks ${code}`).toBeGreaterThan(-1)
        expect(at, `${fn}: grant before PIN`).toBeLessThan(b.indexOf('_require_pin('))
      }
    }
  })

  it('USER: a risky action box is enabled only with a related menu and toggles the grant', () => {
    const onToggleAction = vi.fn()
    render(
      <PermissionMatrixPanel {...panelProps} onToggleAction={onToggleAction}
        member={{ id: 'u', name: 'Staff', role: 'USER', status: 'ACTIVE' }} draftMenus={['bills']} draftActions={['REFUND']} />
    )
    const refund = screen.getByLabelText('ให้สิทธิ์ REFUND') as HTMLInputElement
    expect(refund.checked).toBe(true)
    expect(refund.disabled).toBe(false)
    expect((screen.getByLabelText('ให้สิทธิ์ PRODUCT_PRICE_CHANGE') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('ให้สิทธิ์ EXPENSE') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('ให้สิทธิ์ BILL_VOID'))
    expect(onToggleAction).toHaveBeenCalledWith('BILL_VOID')
  })

  it('before the migration is applied the action boxes stay disabled', () => {
    render(
      <PermissionMatrixPanel {...panelProps} actionGrantsAvailable={false}
        member={{ id: 'u', name: 'Staff', role: 'USER', status: 'ACTIVE' }} draftMenus={['bills', 'finance', 'products']} />
    )
    expect(GRANTABLE_ACTIONS.every((c) => (screen.getByLabelText(`ให้สิทธิ์ ${c}`) as HTMLInputElement).disabled)).toBe(true)
  })

  it('OWNER: full, no action boxes', () => {
    render(<PermissionMatrixPanel {...panelProps} member={{ id: 'o', name: 'Owner', role: 'OWNER', status: 'ACTIVE' }} draftMenus={[]} />)
    expect(screen.queryByLabelText('ให้สิทธิ์ REFUND')).toBeNull()
  })
})

describe('UI buttons follow the same rule (hint only — the server still checks)', () => {
  it('canRunAction: OWNER always; USER needs a related menu AND the grant', async () => {
    const { canRunAction } = await import('@/features/auth/hooks/useActionPermission')
    expect(canRunAction({ role: 'OWNER', menus: [] }, [], 'REFUND')).toBe(true)
    expect(canRunAction({ role: 'USER', menus: ['bills'] }, [], 'REFUND')).toBe(false)
    expect(canRunAction({ role: 'USER', menus: [] }, ['REFUND'], 'REFUND')).toBe(false)
    expect(canRunAction({ role: 'USER', menus: ['bills'] }, ['REFUND'], 'REFUND')).toBe(true)
    expect(canRunAction({ role: 'USER', menus: ['bills'] }, ['REFUND'], 'BILL_VOID')).toBe(false)
    expect(canRunAction({ role: 'USER', menus: ['products'] }, ['STOCK_ADJUST'], 'PRODUCT_PRICE_CHANGE')).toBe(false)
    expect(canRunAction(null, ['REFUND'], 'REFUND')).toBe(false)
  })
})
