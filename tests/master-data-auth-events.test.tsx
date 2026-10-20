// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthProvider } from '@/features/auth/contexts/AuthContext'
import { MasterDataProvider } from '@/components/common/MasterDataProvider'

type FakeSession = { user: { id: string; email: string }; access_token: string }
type AuthCallback = (event: string, session: FakeSession | null) => Promise<void> | void

const fake = vi.hoisted(() => ({
  session: null as FakeSession | null,
  callback: null as AuthCallback | null,
  loads: [] as string[],
  currentUserId: '' as string,
  profileFails: false,
}))

// AuthProvider talks to Supabase only through this client; it delivers auth events the same way supabase-js does.
vi.mock('@/lib/supabase/client', () => {
  const query = (table: string) => {
    const builder = {
      select: () => builder,
      eq: (_col: string, value: string) => {
        if (table === 'user_menu_access') return Promise.resolve({ data: [] })
        fake.currentUserId = value
        return builder
      },
      maybeSingle: () =>
        Promise.resolve(
          fake.profileFails
            ? { data: null, error: { message: 'fetch failed' } }
            : { data: { id: fake.currentUserId, role: 'OWNER', status: 'ACTIVE', is_approved: true }, error: null }
        ),
    }
    return builder
  }
  const client = {
    auth: {
      getSession: async () => ({ data: { session: fake.session } }),
      getUser: async () => ({ data: { user: fake.session?.user ?? null } }),
      onAuthStateChange: (cb: AuthCallback) => {
        fake.callback = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: async () => ({ error: null }),
    },
    from: query,
  }
  return { createClient: () => client }
})
vi.mock('@/app/actions/auth', () => ({ logout: vi.fn(async () => {}) }))

// The provider's reload = loadAllBusinessData; count it through the first fetch it makes.
vi.mock('@/features/settings/api/settings-repository', () => ({
  fetchSharedSystemConfig: vi.fn(async () => {
    fake.loads.push(fake.session?.user.id ?? 'none')
    return null
  }),
}))
vi.mock('@/features/notifications/services/notification-storage', async (orig) => ({
  ...(await orig<object>()),
  runNotificationScan: vi.fn(async () => {}),
  fetchNotificationsFromSupabase: vi.fn(async () => []),
}))
vi.mock('@/features/products/api/product-repository', async (orig) => ({
  ...(await orig<object>()),
  fetchProductsFromSupabase: vi.fn(async () => []),
  fetchCategoriesFromSupabase: vi.fn(async () => []),
  fetchUnitsFromSupabase: vi.fn(async () => []),
}))
vi.mock('@/features/customers/api/customer-repository', async (orig) => ({
  ...(await orig<object>()),
  fetchCustomersFromSupabase: vi.fn(async () => [{ id: 'c1', customerName: 'Loaded customer' }]),
}))
vi.mock('@/features/bills/services/bill-storage', async (orig) => ({ ...(await orig<object>()), fetchBillsFromSupabase: vi.fn(async () => []) }))
vi.mock('@/features/quotations/services/quotation-storage', async (orig) => ({ ...(await orig<object>()), fetchQuotationsFromSupabase: vi.fn(async () => []) }))
vi.mock('@/features/appointments/services/appointment-storage', async (orig) => ({ ...(await orig<object>()), fetchAppointmentsFromSupabase: vi.fn(async () => []) }))
vi.mock('@/features/finance/services/finance-storage', async (orig) => ({ ...(await orig<object>()), fetchTransactionsFromSupabase: vi.fn(async () => []) }))

import { loadCustomers } from '@/features/customers/services/customer-storage'

const sessionFor = (id: string, token = 't1'): FakeSession => ({ user: { id, email: `${id}@shop.test` }, access_token: token })

/** A page with unsaved work: an open "modal" holding a half-filled form. */
function Workspace() {
  const [open, setOpen] = React.useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>open form</button>
      {open && (
        <div role="dialog">
          <input aria-label="customer name" />
        </div>
      )}
    </div>
  )
}

async function mountSignedIn(userId = 'user-a') {
  fake.session = sessionFor(userId)
  render(
    <AuthProvider>
      <MasterDataProvider>
        <Workspace />
      </MasterDataProvider>
    </AuthProvider>
  )
  await screen.findByRole('button', { name: 'open form' })
}

async function fire(event: string, session: FakeSession | null) {
  fake.session = session
  await act(async () => {
    await fake.callback?.(event, session)
  })
}

async function fillForm() {
  fireEvent.click(screen.getByRole('button', { name: 'open form' }))
  fireEvent.change(screen.getByLabelText('customer name'), { target: { value: 'สมศรี ยังไม่บันทึก' } })
}

beforeEach(() => {
  fake.session = null
  fake.callback = null
  fake.loads = []
  fake.profileFails = false
})
afterEach(cleanup)

describe('P1-A1 master data survives auth events of the same user', () => {
  it('INITIAL_SESSION loads shop data once on first sign-in', async () => {
    await mountSignedIn()
    await fire('INITIAL_SESSION', sessionFor('user-a'))
    expect(fake.loads).toEqual(['user-a'])
    expect(loadCustomers()).toEqual([expect.objectContaining({ id: 'c1' })])
  })

  it('TOKEN_REFRESHED for the same user keeps the open form and its typed value', async () => {
    await mountSignedIn()
    await fillForm()
    await fire('TOKEN_REFRESHED', sessionFor('user-a', 't2'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText('customer name') as HTMLInputElement).value).toBe('สมศรี ยังไม่บันทึก')
    expect(screen.queryByText('กำลังโหลดข้อมูลระบบ...')).toBeNull()
    expect(fake.loads).toEqual(['user-a'])
  })

  it('any event with a new session object for the same user does not reload the app', async () => {
    await mountSignedIn()
    await fillForm()
    for (const event of ['SIGNED_IN', 'USER_UPDATED', 'TOKEN_REFRESHED', 'SIGNED_IN']) {
      await fire(event, sessionFor('user-a', `t-${event}-${Math.random()}`))
    }
    expect((screen.getByLabelText('customer name') as HTMLInputElement).value).toBe('สมศรี ยังไม่บันทึก')
    expect(fake.loads).toEqual(['user-a'])
  })

  it('a different user id reloads shop data for that user', async () => {
    await mountSignedIn()
    await fire('SIGNED_IN', sessionFor('user-b'))
    await waitFor(() => expect(fake.loads).toEqual(['user-a', 'user-b']))
    await screen.findByRole('button', { name: 'open form' })
  })

  it('SIGNED_OUT clears cached shop data, and signing in again loads it again', async () => {
    await mountSignedIn()
    expect(loadCustomers()).toHaveLength(1)
    await fire('SIGNED_OUT', null)
    expect(loadCustomers()).toEqual([])
    await fire('SIGNED_IN', sessionFor('user-a', 't3'))
    await waitFor(() => expect(fake.loads).toEqual(['user-a', 'user-a']))
    expect(loadCustomers()).toHaveLength(1)
  })

  it('TOKEN_REFRESHED whose profile read fails keeps the user, the shop data and the open form (P1-A3)', async () => {
    await mountSignedIn()
    await fillForm()
    fake.profileFails = true
    await fire('TOKEN_REFRESHED', sessionFor('user-a', 't2'))
    expect((screen.getByLabelText('customer name') as HTMLInputElement).value).toBe('สมศรี ยังไม่บันทึก')
    expect(loadCustomers()).toHaveLength(1)
    expect(fake.loads).toEqual(['user-a'])
  })
})
