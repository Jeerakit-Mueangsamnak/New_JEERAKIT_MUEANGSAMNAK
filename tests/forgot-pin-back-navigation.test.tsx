// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mockState = vi.hoisted(() => ({
  role: 'OWNER',
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mockState.back, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/features/auth/components/AuthLayout', () => ({
  AuthLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner', role: mockState.role, email: 'owner@example.invalid' } }),
}))
vi.mock('@/features/auth/contexts/AppLockContext', () => ({
  useAppLock: () => ({ refreshLockState: vi.fn(), unlockApp: vi.fn() }),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/services/pin-lock', () => ({ recoverOwnerPin: vi.fn(), validatePinFormat: vi.fn() }))

import ForgotPinPage from '@/app/forgot-pin/page'

afterEach(() => {
  cleanup()
  mockState.role = 'OWNER'
  mockState.back.mockClear()
})

describe('Forgot PIN back button', () => {
  it('shows bottom-right back on the owner recovery screen and navigates back', () => {
    render(<ForgotPinPage />)
    const button = screen.getByRole('button', { name: 'ย้อนกลับ' })
    expect(button.className).toContain('fixed bottom-3 right-3')
    fireEvent.click(button)
    expect(mockState.back).toHaveBeenCalledOnce()
  })

  it('shows the same back control for a non-owner, without providing PIN recovery', () => {
    mockState.role = 'USER'
    render(<ForgotPinPage />)
    expect(screen.getByText('ให้เจ้าของร้านล้าง PIN ให้ที่เมนูจัดการสิทธิ์ แล้วตั้ง PIN ใหม่')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))
    expect(mockState.back).toHaveBeenCalledOnce()
  })
})
