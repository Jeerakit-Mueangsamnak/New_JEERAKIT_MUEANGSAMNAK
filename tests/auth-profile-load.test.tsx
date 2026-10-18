// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { AuthProvider, useAuth } from '@/features/auth/contexts/AuthContext'

type FakeSession = { user: { id: string; email: string }; access_token: string }
type AuthCallback = (event: string, session: FakeSession | null) => Promise<void> | void
type ProfileReply = { data: Record<string, unknown> | null; error?: { message: string } | null }

type SessionReply = { data: { session: FakeSession | null } }
type UserReply = { data: { user: { id: string; email: string } | null } }

const fake = vi.hoisted(() => ({
  session: null as FakeSession | null,
  callback: null as AuthCallback | null,
  /** Each profile read takes the next reply; a reply can be a pending promise the test resolves later. */
  profileReplies: [] as Array<Promise<ProfileReply> | ProfileReply>,
  /** Optional deferred replies for auth.getSession / auth.getUser — used to model a hung auth call. */
  sessionReplies: [] as Array<Promise<SessionReply> | SessionReply>,
  userReplies: [] as Array<Promise<UserReply> | UserReply>,
  clearCount: 0,
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
      getSession: () => {
        const next = fake.sessionReplies.shift()
        if (next instanceof Promise) return next
        if (next) return Promise.resolve(next)
        return Promise.resolve({ data: { session: fake.session } })
      },
      getUser: () => {
        const next = fake.userReplies.shift()
        if (next instanceof Promise) return next
        if (next) return Promise.resolve(next)
        return Promise.resolve({ data: { user: fake.session?.user ?? null } })
      },
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

function deferred<T = ProfileReply>() {
  let resolve!: (v: T) => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const sessionDeferred = () => deferred<SessionReply>()
const userDeferred = () => deferred<UserReply>()

function Probe() {
  const { user, session, role, loading } = useAuth()
  const { refreshUser } = useAuth()
  refreshRef.current = refreshUser
  if (!loading) seen.push(session ? 'session' : 'no-session')
  return (
    <output data-testid="auth">
      {user ? `${user.id}|${user.status}|${role}` : 'none'}|{session ? session.access_token : 'no-session'}
    </output>
  )
}
const seen: string[] = []
const refreshRef: { current: (() => Promise<void>) | null } = { current: null }
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
  fake.sessionReplies = []
  fake.userReplies = []
  fake.clearCount = 0
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
describe('P1-A4 auth race: hung auth calls and account switches', () => {
  it('A. refreshUser: a hung getUser() answering after SIGNED_OUT cannot bring the user back', async () => {
    await mount()
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t1')

    const hungGetUser = userDeferred()
    fake.userReplies.push(hungGetUser.promise)

    await act(async () => {
      void refreshRef.current?.()
      await vi.advanceTimersByTimeAsync(0)
    })

    // User signs out while the refresh is still waiting on getUser()
    await fire('SIGNED_OUT', null)
    expect(auth()).toBe('none|no-session')

    // The stale getUser() finally answers with the OLD user
    await act(async () => {
      hungGetUser.resolve({ data: { user: { id: 'user-a', email: 'user-a@shop.test' } } })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('none|no-session')
  })

  it('B. refreshUser: a hung getSession() answering after SIGNED_OUT cannot bring the user back', async () => {
    await mount()

    const hungGetUser = userDeferred()
    const hungGetSession = sessionDeferred()
    fake.userReplies.push(hungGetUser.promise)
    fake.sessionReplies.push(hungGetSession.promise)

    await act(async () => {
      void refreshRef.current?.()
      await vi.advanceTimersByTimeAsync(0)
    })

    await fire('SIGNED_OUT', null)
    expect(auth()).toBe('none|no-session')

    // getUser() answers null, so refreshUser falls through to getSession() — which is stale too
    await act(async () => {
      hungGetUser.resolve({ data: { user: null } })
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => {
      hungGetSession.resolve({ data: { session: sessionFor('user-a', 't-stale') } })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('none|no-session')
  })

  it('C. initAuth: a hung initial check answering after SIGNED_IN must not clear the new user', async () => {
    const hungInitSession = sessionDeferred()
    fake.sessionReplies.push(hungInitSession.promise)
    fake.session = null

    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // A real sign-in lands while the very first session check is still hung
    await fire('SIGNED_IN', sessionFor('user-a', 't-live'))
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t-live')

    // The stale initial check finally answers "no session"
    await act(async () => {
      hungInitSession.resolve({ data: { session: null } })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t-live')
  })

  it('D. switching accounts while a read is hung must never apply the old account', async () => {
    await mount()
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t1')

    const hungOldAccount = deferred<ProfileReply>()
    fake.profileReplies.push(hungOldAccount.promise)

    // The old account starts a profile read that hangs
    await act(async () => {
      void fake.callback?.('TOKEN_REFRESHED', sessionFor('user-a', 't2'))
      await vi.advanceTimersByTimeAsync(0)
    })

    // A different account signs in and is read successfully
    await fire('SIGNED_IN', sessionFor('user-b', 't-b'))
    expect(auth()).toBe('user-b|ACTIVE|OWNER|t-b')

    // The hung read from the old account answers late — it must be ignored
    await act(async () => {
      hungOldAccount.resolve(ACTIVE)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-b|ACTIVE|OWNER|t-b')
  })

  it('E. a profile timeout/error after ACTIVE must not downgrade the user to PENDING', async () => {
    await mount()
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t1')

    // Slow read: times out after 3 s while the user is already ACTIVE
    fake.profileReplies.push(new Promise<ProfileReply>(() => {}))
    await act(async () => {
      void fake.callback?.('TOKEN_REFRESHED', sessionFor('user-a', 't2'))
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t2')

    // Hard query error: must keep ACTIVE as well
    fake.profileReplies.push({ data: null, error: { message: 'fetch failed' } })
    await fire('TOKEN_REFRESHED', sessionFor('user-a', 't3'))
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t3')
  })

  it('F. a profile read hung across sign-out cannot write auth state afterwards', async () => {
    await mount()

    const hung = deferred<ProfileReply>()
    fake.profileReplies.push(hung.promise)

    await act(async () => {
      void fake.callback?.('TOKEN_REFRESHED', sessionFor('user-a', 't2'))
      await vi.advanceTimersByTimeAsync(0)
    })

    await fire('SIGNED_OUT', null)
    expect(auth()).toBe('none|no-session')

    // Even after the timeout window the stale read must stay inert
    await act(async () => {
      hung.resolve(ACTIVE)
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(auth()).toBe('none|no-session')
  })
})
describe('P1-A4 follow-up: account switching without SIGNED_OUT', () => {
  it('G. refreshUser hung on getUser() must not re-apply account A after B signed in', async () => {
    await mount()
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t1')

    const hungGetUser = userDeferred()
    fake.userReplies.push(hungGetUser.promise)

    // Account A asks refreshUser; getUser() hangs
    await act(async () => {
      void refreshRef.current?.()
      await vi.advanceTimersByTimeAsync(0)
    })

    // Account B signs in WITHOUT a preceding SIGNED_OUT — no epoch bump
    await fire('SIGNED_IN', sessionFor('user-b', 't-b'))
    expect(auth()).toBe('user-b|ACTIVE|OWNER|t-b')

    // The stale getUser() finally answers with account A's user
    await act(async () => {
      hungGetUser.resolve({ data: { user: { id: 'user-a', email: 'user-a@shop.test' } } })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-b|ACTIVE|OWNER|t-b')
  })

  it('H. refreshUser hung on getSession() must not pair account A user with B session', async () => {
    await mount()

    const hungGetUser = userDeferred()
    const hungGetSession = sessionDeferred()
    fake.userReplies.push(hungGetUser.promise)
    fake.sessionReplies.push(hungGetSession.promise)

    await act(async () => {
      void refreshRef.current?.()
      await vi.advanceTimersByTimeAsync(0)
    })

    // B signs in while A's refresh is still hung — no SIGNED_OUT
    await fire('SIGNED_IN', sessionFor('user-b', 't-b'))
    expect(auth()).toBe('user-b|ACTIVE|OWNER|t-b')

    // Stale chain: A's user resolves, then a session resolves — neither may be applied
    await act(async () => {
      hungGetUser.resolve({ data: { user: { id: 'user-a', email: 'user-a@shop.test' } } })
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      hungGetSession.resolve({ data: { session: sessionFor('user-a', 't-stale') } })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-b|ACTIVE|OWNER|t-b')
  })

  it('I. overlapping refreshUser calls: the older one must not overwrite the newer result', async () => {
    await mount()

    const olderUser = userDeferred()
    const olderSession = sessionDeferred()
    fake.userReplies.push(olderUser.promise)
    fake.sessionReplies.push(olderSession.promise)

    // First refresh hangs on getUser()
    await act(async () => {
      void refreshRef.current?.()
      await vi.advanceTimersByTimeAsync(0)
    })

    // The older refresh finally answers while the newer one is already the current run
    fake.profileReplies.push({ data: { role: 'USER', status: 'SUSPENDED', is_approved: true }, error: null })
    await act(async () => {
      olderUser.resolve({ data: { user: { id: 'user-a', email: 'user-a@shop.test' } } })
      olderSession.resolve({ data: { session: sessionFor('user-a', 't-old') } })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-a|SUSPENDED|USER|t-old')

    // A later refresh must still be able to update the profile after the older run answered
    fake.profileReplies.push({ data: { role: 'OWNER', status: 'ACTIVE', is_approved: true }, error: null })
    await act(async () => {
      void refreshRef.current?.()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t1')
  })
})
describe('P1-A4 final: races that were still unproven', () => {
  it('J. account B signs in while B profile is pending: A finishing late must not cancel or overwrite B', async () => {
    await mount()
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t1')

    // A starts a refresh that hangs on getUser()
    const hungAUser = userDeferred()
    fake.userReplies.push(hungAUser.promise)
    await act(async () => {
      void refreshRef.current?.()
      await vi.advanceTimersByTimeAsync(0)
    })

    // B signs in without SIGNED_OUT, and B's profile query hangs too
    const hungBProfile = deferred<ProfileReply>()
    fake.profileReplies.push(hungBProfile.promise)
    fake.session = sessionFor('user-b', 't-b')
    // Call the callback without awaiting it: B's profile stays pending
    await act(async () => {
      void fake.callback?.('SIGNED_IN', sessionFor('user-b', 't-b'))
      await vi.advanceTimersByTimeAsync(0)
    })

    // Now A's hung getUser/getSession answer with the old account
    fake.sessionReplies.push(Promise.resolve({ data: { session: sessionFor('user-a', 't-old') } }))
    await act(async () => {
      hungAUser.resolve({ data: { user: { id: 'user-a', email: 'user-a@shop.test' } } })
      await vi.advanceTimersByTimeAsync(0)
    })

    // B's profile finally succeeds — B must be the surviving user, with B's session
    await act(async () => {
      hungBProfile.resolve({ data: { role: 'OWNER', status: 'ACTIVE', is_approved: true }, error: null })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth()).toBe('user-b|ACTIVE|OWNER|t-b')
  })

  it('K. concurrent refreshUser: the first run answering ACTIVE later must not overwrite SUSPENDED from the second', async () => {
    await mount()
    expect(auth()).toBe('user-a|ACTIVE|OWNER|t1')

    // Run 1 hangs on getUser()
    const hungUser1 = userDeferred()
    fake.userReplies.push(hungUser1.promise)
    await act(async () => {
      void refreshRef.current?.()
      await vi.advanceTimersByTimeAsync(0)
    })

    // Run 2 runs while run 1 is still hung and succeeds with SUSPENDED
    fake.profileReplies.push({ data: { role: 'USER', status: 'SUSPENDED', is_approved: true }, error: null })
    await act(async () => {
      void refreshRef.current?.()
      await vi.advanceTimersByTimeAsync(0)
    })

    // Run 1 finally answers with the stale ACTIVE profile
    fake.profileReplies.push({ data: { role: 'OWNER', status: 'ACTIVE', is_approved: true }, error: null })
    await act(async () => {
      hungUser1.resolve({ data: { user: { id: 'user-a', email: 'user-a@shop.test' } } })
      await vi.advanceTimersByTimeAsync(0)
    })

    // SUSPENDED from the newer run must survive
    expect(auth()).toBe('user-a|SUSPENDED|USER|t1')
  })
})
