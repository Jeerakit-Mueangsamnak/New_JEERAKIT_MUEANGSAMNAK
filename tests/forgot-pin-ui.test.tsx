// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  role: 'OWNER',
  back: vi.fn(),
  replace: vi.fn(),
  unlockApp: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mocks.back, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/features/auth/components/AuthLayout', () => ({
  AuthLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'owner@example.test', role: mocks.role } }),
}))
vi.mock('@/features/auth/contexts/AppLockContext', () => ({
  useAppLock: () => ({ refreshLockState: vi.fn(), unlockApp: mocks.unlockApp }),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/services/pin-lock', () => ({
  recoverOwnerPin: vi.fn(),
  validatePinFormat: vi.fn(),
}))

import ForgotPinPage from '@/app/forgot-pin/page'

beforeEach(() => {
  mocks.role = 'OWNER'
  mocks.back.mockClear()
  mocks.replace.mockClear()
  mocks.unlockApp.mockClear()
})
afterEach(cleanup)

describe('Forgot PIN navigation', () => {
  it('shows a bottom-right back button without bypassing the app lock', () => {
    render(<ForgotPinPage />)
    const backButton = screen.getByRole('button', { name: 'ย้อนกลับ' })
    expect(backButton.className).toContain('fixed bottom-3 right-3')
    fireEvent.click(backButton)
    expect(mocks.back.mock.calls.length + mocks.replace.mock.calls.length).toBe(1)
    expect(mocks.unlockApp).not.toHaveBeenCalled()
  })

  it('keeps the bottom-right back button when a non-owner opens recovery', () => {
    mocks.role = 'USER'
    render(<ForgotPinPage />)
    expect(screen.getByText(/ให้เจ้าของร้านล้าง PIN/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'ย้อนกลับ' }).className).toContain('fixed bottom-3 right-3')
  })
})
