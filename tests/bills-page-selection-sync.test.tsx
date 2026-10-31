// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', status: 'ACTIVE', role: 'USER' }, loading: false }),
}))
vi.mock('@/features/auth/services/pin-lock', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/services/pin-lock')>('@/features/auth/services/pin-lock')
  return {
    ...actual,
    // the user's own auto-lock time (PROFILE value) = 60 s
    fetchPinStatus: vi.fn(async () => ({ pinSet: true, blocked: false, failedAttempts: 0, lockedUntil: null, autoLockSeconds: 60, autoLockOptions: [60] })),
  }
})

import { AppLockProvider, useAppLock } from '@/features/auth/contexts/AppLockContext'
import { fetchPinStatus, setAppLockedState, setLastActivity } from '@/features/auth/services/pin-lock'

function Probe() {
  const { isLocked, loading, lockApp } = useAppLock()
  return <><output data-testid="lock">{loading ? 'loading' : isLocked ? 'locked' : 'open'}</output><button onClick={lockApp}>ล็อกด้วยตนเอง</button></>
}

const T0 = Date.parse('2026-10-07T10:00:00+07:00')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // This tab was already open (a reopened tab is tested on its own in 17)
  sessionStorage.setItem('pos_tab_open:u1', '1')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('15. auto-lock survives background, sleep and a reopened session', () => {
  it('reopening the app after the idle time opens it locked (asks for the PIN)', async () => {
    setLastActivity('u1', T0 - 2 * 60_000) // last used 2 min ago on this device
    render(<AppLockProvider><Probe /></AppLockProvider>)
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('locked'))
  })

  it('coming back from the background / sleep after the idle time locks at once', async () => {
    render(<AppLockProvider><Probe /></AppLockProvider>)
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('open'))
    // the page was hidden and timers did not run; the device clock moved on 61 s
    vi.setSystemTime(T0 + 61_000)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('locked'))
  })

  it('a short break does not lock', async () => {
    render(<AppLockProvider><Probe /></AppLockProvider>)
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('open'))
    vi.setSystemTime(T0 + 30_000)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(screen.getByTestId('lock').textContent).toBe('open')
  })
})

describe('17. tab switching does not lock instantly; manual and reopened-tab locks remain', () => {
  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })

  it('switching tabs briefly does not lock the app', async () => {
    render(<AppLockProvider><Probe /></AppLockProvider>)
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('open'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.getByTestId('lock').textContent).toBe('open')
    vi.setSystemTime(T0 + 10_000)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('open'))
  })

  it('the explicit lock button still locks the app', async () => {
    render(<AppLockProvider><Probe /></AppLockProvider>)
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('open'))
    fireEvent.click(screen.getByRole('button', { name: 'ล็อกด้วยตนเอง' }))
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('locked'))
  })

  it('a page swiped away / tab closed and opened again (no tab marker) asks for the PIN', async () => {
    sessionStorage.clear() // the browser drops it with the closed tab
    render(<AppLockProvider><Probe /></AppLockProvider>)
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('locked'))
  })

  it('a reload / full page load in the same tab does not lock', async () => {
    render(<AppLockProvider><Probe /></AppLockProvider>)
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('open'))
    act(() => {
      window.dispatchEvent(new Event('beforeunload'))
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByTestId('lock').textContent).toBe('open')
    cleanup()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    render(<AppLockProvider><Probe /></AppLockProvider>) // the reloaded page: same tab, marker kept
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('open'))
  })
})

describe('16. a locked device stays locked when the PIN status cannot be read', () => {
  it('reload while locked + my_pin_status fails -> still locked (fail closed)', async () => {
    setAppLockedState('u1', true)
    vi.mocked(fetchPinStatus).mockRejectedValueOnce(new Error('network'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AppLockProvider><Probe /></AppLockProvider>)
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('locked'))
    err.mockRestore()
  })

  it('an unlocked device is not locked by a failed status read', async () => {
    vi.mocked(fetchPinStatus).mockRejectedValueOnce(new Error('network'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AppLockProvider><Probe /></AppLockProvider>)
    await waitFor(() => expect(screen.getByTestId('lock').textContent).toBe('open'))
    err.mockRestore()
  })
})
