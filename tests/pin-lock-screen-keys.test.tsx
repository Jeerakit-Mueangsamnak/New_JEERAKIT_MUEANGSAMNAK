// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const authRole = vi.hoisted(() => ({ current: 'OWNER' }))

vi.mock('@/features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'nid', fullName: 'นิด', avatarUrl: '/avatar.png', role: authRole.current }, signOut: vi.fn() }),
}))
vi.mock('@/features/auth/contexts/AppLockContext', () => ({
  useAppLock: () => ({ verifyPin: vi.fn(async () => ({ ok: true })), unlockApp: vi.fn(), status: null, pinBlocked: false }),
}))

import { PinLockScreen } from '@/features/auth/components/PinLockScreen'

afterEach(() => {
  cleanup()
  authRole.current = 'OWNER'
})

describe('lock screen keys never reach the field typed in before locking (owner 2026-10-26)', () => {
  it('a PIN digit goes to the lock screen only, not to a focused field in an open window', () => {
    const fieldKeys = vi.fn()
    render(
      <>
        <input data-testid="field" onKeyDown={fieldKeys} />
        <PinLockScreen />
      </>
    )
    const field = screen.getByTestId('field')
    field.focus()

    const notPrevented = fireEvent.keyDown(field, { key: '1' })

    expect(notPrevented).toBe(false) // the browser does not type the digit into the field
    expect(fieldKeys).not.toHaveBeenCalled()
    expect(screen.getAllByText('•')).toHaveLength(1) // it counted as the first PIN digit
  })

  it('Escape clears the PIN without reaching the window underneath', () => {
    const fieldKeys = vi.fn()
    render(
      <>
        <input data-testid="field" onKeyDown={fieldKeys} />
        <PinLockScreen />
      </>
    )
    const field = screen.getByTestId('field')
    fireEvent.keyDown(field, { key: '4' })
    fireEvent.keyDown(field, { key: 'Escape' })

    expect(fieldKeys).not.toHaveBeenCalled()
    expect(screen.queryAllByText('•')).toHaveLength(0)
  })

  it('shows centred PIN boxes, no eye/clear/header, and a persistent delete icon', () => {
    const { container } = render(<PinLockScreen />)

    expect(screen.queryByText('หน้าจอล็อก (App Lock)')).toBeNull()
    expect(container.textContent).not.toMatch(/เพื่อเข้าใช้งาน|เซสชันบัญชีผู้ใช้ปลอดภัย/)
    expect(container.querySelector('[role="status"]')).toBeNull() // no empty placeholder spacing
    expect(screen.getByText('@nid').className).toContain('fixed top-3 right-3')
    expect(screen.queryByRole('button', { name: /แสดง PIN|ซ่อน PIN/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'ล้าง' })).toBeNull()

    const keypad = container.querySelector('.grid.grid-cols-3')
    const forgot = screen.getByRole('link', { name: 'ลืม PIN?' })
    expect(keypad?.children[9].contains(forgot)).toBe(true) // below digit 7

    const deleteButton = screen.getByRole('button', { name: 'ลบตัวเลข' }) as HTMLButtonElement
    expect(deleteButton).toBeDefined()
    expect(deleteButton.disabled).toBe(true) // empty PIN, but icon must remain visible
    expect(deleteButton.className).not.toContain('disabled:opacity-0')

    const logoutButton = screen.getByRole('button', { name: 'ออกจากระบบ' })
    expect(logoutButton.className).toContain('fixed bottom-3 right-3')
    const avatar = screen.getByRole('img', { name: 'นิด' })
    expect(avatar.parentElement?.className).toContain('12dvh')
    expect(avatar.parentElement?.className).not.toContain('border-2')

    fireEvent.click(screen.getByRole('button', { name: 'ตัวเลข 1' }))
    expect(deleteButton.disabled).toBe(false)
    fireEvent.click(deleteButton)
    expect(screen.queryAllByText('•')).toHaveLength(0)
  })

  it('explains that a non-owner must ask the owner to reset a forgotten PIN', () => {
    authRole.current = 'USER'
    render(<PinLockScreen />)

    expect(screen.getByText('แจ้งเจ้าของร้าน')).toBeDefined()
    expect(screen.queryByRole('link', { name: 'ลืม PIN?' })).toBeNull()
  })

  it('other keys are left alone', () => {
    const fieldKeys = vi.fn()
    render(
      <>
        <input data-testid="field" onKeyDown={fieldKeys} />
        <PinLockScreen />
      </>
    )
    expect(fireEvent.keyDown(screen.getByTestId('field'), { key: 'Tab' })).toBe(true)
    expect(fieldKeys).toHaveBeenCalledTimes(1)
  })
})
