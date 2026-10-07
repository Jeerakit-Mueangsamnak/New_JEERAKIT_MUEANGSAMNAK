// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { AuthProvider, useAuth } from '@/features/auth/contexts/AuthContext'

type FakeSession = { user: { id: string; email: string }; access_token: string }
type AuthCallback = (event: string, session: FakeSession | null) => Promise<void> | void
type ProfileReply = { data: Record<string, unknown> | null; error?: { message: string } | null }

const fake = vi.hoisted(() => ({
  session: null as FakeSession | null,
  callback: null as AuthCallback | null,
  /** Each profile read takes the next reply; a reply can be a pending promise the test resolves later. */
  profileReplies: [] as Array<Promise<ProfileReply> | ProfileReply>,
}))

vi.mock('@/lib/supabase/client', () => {
  const from = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => (table === 'user_menu_access' ? Promise.resolve({ data: [{ menu_code: 'POS' }], error: null }) : builder),
      maybeSingle: () => {
        const next = fake.profileReplies.shift() ?? ACTIVE
        return next instanceof Promise ? next : Promise.resolve(next)
      },
    }
    return builder
  }
  const ACTIVE: ProfileReply = { data: { role: 'OWNER', status: 'ACTIVE', is_approved: true }, error: null }
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
    from,
  }
  return { createClient: () => client }
})
vi.mock('@/app/actions/auth', () => ({ logout: vi.fn(async () => {}) }))

const ACTIVE: ProfileReply = { data: { role: 'OWNER', status: 'ACTIVE', is_approved: true }, error: null }
const sessionFor = (id: string, token = 't1'): FakeSession => ({ user: { id, email: `${id}@shop.test` }, access_token: token })

function deferred() {
  let resolve!: (v: ProfileReply) => void
  const promise = new Promise<ProfileReply>((r) => { resolve = r })
  return { promise, resolve }
}

function Probe() {
  const { user, session, role, loading } = useAuth()
  if (!loading) seen.push(session ? 'session' : 'no-session')
  return (
    <output data-testid="auth">
      {user ? `${user.id}|${user.status}|${role}` : 'none'}|{session ? session.access_token : 'no-session'}
    </output>
  )
}
const seen: string[] = []
const auth = () => screen.getByTestId('auth').textContent

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}
async function mount(userId: string | null = 'user-a') {
  fake.session = userId ? sessionFor(userId) : null
  render(<AuthProvider><Probe /></AuthProvider>)
  await settle()
}
async function fire(event: string, session: FakeSession | null) {
  fake.session = session
  await act(async () => {
    const pending = fake.callback?.(event, session)
    await vi.advanceTimersByTimeAsync(0)
    await pending
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fake.session = null
  fake.callback = null
  fake.profileReplies = []
  seen.length = 0
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('P1-A3 profile load: slow, failed or out-of-order reads', () => {
  it('a profile read slower than 3 s keeps the ACTIVE user (not PENDING/null)', async () => {
    await mount()
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t1')
    fake.profileReplies.push(new Promise<ProfileReply>(() => {})) // never answers
    await act(async () => {
      void fake.callback?.('TOKEN_REFRESHED', sessionFor('user-a', 't2'))
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t2')
  })

  it('an older read answering after a newer one does not overwrite it', async () => {
    await mount()
    const older = deferred()
    fake.profileReplies.push(older.promise, { data: { role: 'USER', status: 'SUSPENDED', is_approved: true }, error: null })
    await act(async () => {
      void fake.callback?.('SIGNED_IN', sessionFor('user-a', 't-old'))
      void fake.callback?.('USER_UPDATED', sessionFor('user-a', 't-new'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-a|SUSPENDED|USER|t-new')
    await act(async () => {
      older.resolve(ACTIVE)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-a|SUSPENDED|USER|t-new')
  })

  it('a temporary profile query error keeps the last profile', async () => {
    await mount()
    fake.profileReplies.push({ data: null, error: { message: 'fetch failed' } })
    await fire('TOKEN_REFRESHED', sessionFor('user-a', 't2'))
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t2')
  })

  it('first sign-in with no profile row (or no answer) stays PENDING as before', async () => {
    fake.profileReplies.push({ data: null, error: null })
    await mount()
    expect(auth()).toBe('user-a|PENDING|USER|t1')

    cleanup()
    fake.profileReplies.push(new Promise<ProfileReply>(() => {}), new Promise<ProfileReply>(() => {}))
    fake.session = sessionFor('user-b')
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(auth()).toBe('user-b|PENDING|USER|t1')
  })

  it('a profile that really says SUSPENDED is applied', async () => {
    await mount()
    fake.profileReplies.push({ data: { role: 'USER', status: 'SUSPENDED', is_approved: true }, error: null })
    await fire('USER_UPDATED', sessionFor('user-a', 't2'))
    expect(auth()).toBe('user-a|SUSPENDED|USER|t2')
  })

  it('sign-out clears state, and a profile read still in flight cannot bring the user back', async () => {
    await mount()
    const late = deferred()
    fake.profileReplies.push(late.promise)
    await act(async () => {
      void fake.callback?.('TOKEN_REFRESHED', sessionFor('user-a', 't2'))
      await vi.advanceTimersByTimeAsync(0)
    })
    await fire('SIGNED_OUT', null)
    expect(auth()).toBe('none|no-session')
    await act(async () => {
      late.resolve(ACTIVE)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('none|no-session')
  })

  it('page load: the first check never reports "no session" while a newer profile load is still running', async () => {
    const newer = deferred()
    fake.profileReplies.push(ACTIVE, newer.promise)
    fake.session = sessionFor('user-a')
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => {
      void fake.callback?.('INITIAL_SESSION', sessionFor('user-a'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(seen).not.toContain('no-session')
    await act(async () => {
      newer.resolve(ACTIVE)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t1')
    expect(seen).not.toContain('no-session')
  })
})
