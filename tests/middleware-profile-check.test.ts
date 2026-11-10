import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type ProfileReply = { data: { status: string; is_approved?: boolean | null } | null; error: { message: string } | null } | 'throw' | 'hang'

const fake = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: { data: { status: 'ACTIVE', is_approved: true }, error: null } as ProfileReply,
  auth: 'ok' as 'ok' | 'error' | 'throw' | 'hang' | 'invalid',
  supabaseUrl: 'https://project.supabase.co',
  supabasePublicKey: 'sb_publishable_test',
  profileQueries: 0,
  signOut: vi.fn(async () => ({ error: null })),
  refreshedCookie: false,
}))

vi.mock('@/lib/supabase/env', async (orig) => ({
  ...(await orig<object>()),
  getSupabaseUrl: () => fake.supabaseUrl,
  getSupabasePublicKey: () => fake.supabasePublicKey,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: { name: string; value: string; options?: object }[]) => void } }) => ({
    auth: {
      getClaims: async () => {
        if (fake.auth === 'throw') throw new TypeError('fetch failed')
        if (fake.auth === 'hang') return new Promise(() => {})
        if (fake.auth === 'error') return { data: null, error: { name: 'AuthRetryableFetchError', status: 0 } }
        // A forged / broken token: verified locally, no status code
        if (fake.auth === 'invalid') return { data: null, error: { name: 'AuthInvalidJwtError' } }
        // getClaims may refresh an expired token and write new cookies; they must reach the response
        if (fake.refreshedCookie) opts.cookies.setAll([{ name: 'sb-test-auth-token', value: 'refreshed', options: { path: '/' } }])
        return { data: fake.user ? { claims: { sub: fake.user.id } } : null, error: null }
      },
      signOut: fake.signOut,
    },
    from: () => {
      let signal: AbortSignal | undefined
      const builder = {
        select: () => builder,
        eq: () => builder,
        abortSignal: (s: AbortSignal) => {
          signal = s
          return builder
        },
        maybeSingle: () => {
          fake.profileQueries += 1
          const reply = fake.profile
          if (reply === 'throw') return Promise.reject(new TypeError('fetch failed'))
          if (reply === 'hang') {
            return new Promise((resolve) => {
              signal?.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError: aborted' } }))
            })
          }
          return Promise.resolve(reply)
        },
      }
      return builder
    },
  }),
}))

import { clearMemberStatusCache, updateSession } from '@/lib/supabase/middleware'

const page = (path: string) => new NextRequest(`http://localhost:3000${path}`, { headers: { accept: 'text/html' } })
const isPassThrough = (res: Response) => res.status === 200 && res.headers.get('x-middleware-next') === '1'
const loginRedirect = (res: Response) => res.status === 307 && new URL(res.headers.get('location') ?? '').pathname === '/login'

beforeEach(() => {
  fake.user = { id: 'user-a' }
  fake.profile = { data: { status: 'ACTIVE', is_approved: true }, error: null }
  fake.auth = 'ok'
  fake.supabaseUrl = 'https://project.supabase.co'
  fake.supabasePublicKey = 'sb_publishable_test'
  fake.signOut.mockClear()
  fake.refreshedCookie = false
  fake.profileQueries = 0
  clearMemberStatusCache()
})

describe('P1-A2 middleware member check', () => {
  it('missing Supabase configuration blocks protected pages but leaves public pages reachable', async () => {
    fake.supabasePublicKey = ''
    const protectedResponse = await updateSession(page('/bills'))
    expect(protectedResponse.status).toBe(503)
    expect(isPassThrough(protectedResponse)).toBe(false)
    expect(await protectedResponse.text()).toContain('การเชื่อมต่อไม่ครบถ้วน')
    expect(fake.profileQueries).toBe(0)

    const publicResponse = await updateSession(page('/login'))
    expect(isPassThrough(publicResponse)).toBe(true)
  })

  it('profile query error: no sign-out, and the protected page is not served (503, retry)', async () => {
    fake.profile = { data: null, error: { message: 'connection reset' } }
    const res = await updateSession(page('/bills'))
    expect(fake.signOut).not.toHaveBeenCalled()
    expect(isPassThrough(res)).toBe(false)
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('5')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toContain('ลองใหม่')
  })

  it('profile query that throws is handled the same way (no sign-out, 503)', async () => {
    fake.profile = 'throw'
    const res = await updateSession(page('/pos'))
    expect(fake.signOut).not.toHaveBeenCalled()
    expect(res.status).toBe(503)
  })

  it('profile query that hangs times out into 503 without sign-out', async () => {
    vi.useFakeTimers()
    try {
      fake.profile = 'hang'
      const pending = updateSession(page('/pos'))
      await vi.advanceTimersByTimeAsync(5000)
      const res = await pending
      expect(fake.signOut).not.toHaveBeenCalled()
      expect(res.status).toBe(503)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a 503 still carries refreshed auth cookies so the session is not lost', async () => {
    fake.refreshedCookie = true
    fake.profile = { data: null, error: { message: 'timeout' } }
    const res = await updateSession(page('/bills'))
    expect(res.status).toBe(503)
    expect(res.headers.get('set-cookie')).toContain('sb-test-auth-token=refreshed')
  })

  it('ACTIVE and approved member passes through', async () => {
    const res = await updateSession(page('/bills'))
    expect(isPassThrough(res)).toBe(true)
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it.each(['SUSPENDED', 'PENDING', 'INACTIVE'])('%s member is signed out and sent to login', async (status) => {
    fake.profile = { data: { status, is_approved: true }, error: null }
    const res = await updateSession(page('/bills'))
    expect(fake.signOut).toHaveBeenCalledOnce()
    expect(loginRedirect(res)).toBe(true)
  })

  it('no profile row (query succeeded) keeps the old rule: signed out and sent to login', async () => {
    fake.profile = { data: null, error: null }
    const res = await updateSession(page('/bills'))
    expect(fake.signOut).toHaveBeenCalledOnce()
    expect(loginRedirect(res)).toBe(true)
  })

  it('no session goes to login without a profile check', async () => {
    fake.user = null
    fake.profile = 'throw'
    const res = await updateSession(page('/bills'))
    expect(loginRedirect(res)).toBe(true)
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it('public routes are untouched', async () => {
    fake.user = null
    const res = await updateSession(page('/login'))
    expect(isPassThrough(res)).toBe(true)
  })

  it.each([false, null, undefined])('ACTIVE but is_approved=%s is blocked like PENDING (sign-out, login)', async (approved) => {
    fake.profile = { data: { status: 'ACTIVE', is_approved: approved as boolean | null }, error: null }
    const res = await updateSession(page('/bills'))
    expect(fake.signOut).toHaveBeenCalledOnce()
    expect(loginRedirect(res)).toBe(true)
  })
})

describe('faster page switches: member status kept for 30 s', () => {
  it('the next page within 30 s does not ask the database again', async () => {
    expect(isPassThrough(await updateSession(page('/bills')))).toBe(true)
    fake.profile = 'throw'
    expect(isPassThrough(await updateSession(page('/pos')))).toBe(true)
    expect(fake.profileQueries).toBe(1)
  })

  it('a member suspended meanwhile is cut off once the 30 s are over', async () => {
    vi.useFakeTimers()
    try {
      expect(isPassThrough(await updateSession(page('/bills')))).toBe(true)
      fake.profile = { data: { status: 'SUSPENDED', is_approved: true }, error: null }
      vi.advanceTimersByTime(30_001)
      const res = await updateSession(page('/bills'))
      expect(fake.signOut).toHaveBeenCalledOnce()
      expect(loginRedirect(res)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a refusal is never kept: a suspended member is checked again on the next request', async () => {
    fake.profile = { data: { status: 'SUSPENDED', is_approved: true }, error: null }
    expect(loginRedirect(await updateSession(page('/bills')))).toBe(true)
    expect(loginRedirect(await updateSession(page('/bills')))).toBe(true)
    expect(fake.profileQueries).toBe(2)
  })

  it('another user is checked for themselves', async () => {
    await updateSession(page('/bills'))
    fake.user = { id: 'user-b' }
    fake.profile = { data: { status: 'PENDING', is_approved: false }, error: null }
    expect(loginRedirect(await updateSession(page('/bills')))).toBe(true)
  })

  it('an invalid token goes to login (not 503) and never reaches the member check', async () => {
    fake.auth = 'invalid'
    const res = await updateSession(page('/bills'))
    expect(loginRedirect(res)).toBe(true)
    expect(fake.profileQueries).toBe(0)
  })
})

describe('auth server unreachable (getClaims)', () => {
  it.each(['error', 'throw'] as const)('getClaims %s on a protected page: 503, no sign-out, not served', async (mode) => {
    fake.auth = mode
    const res = await updateSession(page('/bills'))
    expect(res.status).toBe(503)
    expect(isPassThrough(res)).toBe(false)
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it('getClaims that hangs times out into 503', async () => {
    vi.useFakeTimers()
    try {
      fake.auth = 'hang'
      const pending = updateSession(page('/pos'))
      await vi.advanceTimersByTimeAsync(5000)
      const res = await pending
      expect(res.status).toBe(503)
      expect(fake.signOut).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['error', 'throw'] as const)('getClaims %s on a public route still lets the page open', async (mode) => {
    fake.auth = mode
    const res = await updateSession(page('/login'))
    expect(isPassThrough(res)).toBe(true)
  })

  it('a definite "no session" answer still goes to login (not 503)', async () => {
    fake.user = null
    const res = await updateSession(page('/bills'))
    expect(loginRedirect(res)).toBe(true)
  })
})
