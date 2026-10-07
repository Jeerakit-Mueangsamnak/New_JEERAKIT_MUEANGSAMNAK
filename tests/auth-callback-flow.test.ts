import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const exchangeCodeForSession = vi.fn()
const verifyOtp = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession, verifyOtp },
  }),
}))

import { GET } from '@/app/auth/callback/route'
import { getSupabasePublicKey, safeRedirectPath } from '@/lib/supabase/env'
import { isPublicRoute } from '@/features/auth/services/public-routes'

const ORIGIN = 'http://localhost:3000'

async function callback(query: string) {
  const res = await GET(new NextRequest(`${ORIGIN}/auth/callback${query}`))
  const location = res.headers.get('location') || ''
  return location.replace(ORIGIN, '')
}

describe('Auth callback (/auth/callback)', () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset().mockResolvedValue({ data: {}, error: null })
    verifyOtp.mockReset().mockResolvedValue({ data: {}, error: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exchanges a PKCE code for a real session and follows next=/verify-email to the verified state', async () => {
    expect(await callback('?code=abc&next=/verify-email')).toBe('/verify-email?status=verified')
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc')
  })

  it('password recovery code lands on /reset-password', async () => {
    expect(await callback('?code=abc&next=/reset-password')).toBe('/reset-password')
  })

  it('verifies token_hash links by type (cross-device safe)', async () => {
    expect(await callback('?token_hash=t1&type=recovery')).toBe('/reset-password')
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 't1' })
    expect(await callback('?token_hash=t2&type=signup')).toBe('/verify-email?status=verified')
    expect(await callback('?token_hash=t3&type=magiclink')).toBe('/pos')
  })

  it('expired / invalid links go to the matching error state', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: 'flow_state_expired', message: 'expired' } })
    expect(await callback('?code=bad&next=/reset-password')).toBe('/reset-password?status=invalid-link')
    expect(await callback('?code=bad')).toBe('/login?reason=invalid-link')
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: 'bad_code_verifier', message: 'bad' } })
    expect(await callback('?code=bad&next=/verify-email')).toBe('/verify-email?status=invalid-link')

    verifyOtp.mockResolvedValue({ data: {}, error: { code: 'otp_expired', message: 'expired' } })
    expect(await callback('?token_hash=x&type=magiclink')).toBe('/login?reason=invalid-link')
  })

  it('email confirmed but sign-in step timed out (flow_state_expired): tell the user to sign in, never for password recovery', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: 'flow_state_expired', message: 'expired' } })
    expect(await callback('?code=late&next=/verify-email')).toBe('/verify-email?status=verified')
    expect(await callback('?code=late&next=/reset-password')).toBe('/reset-password?status=invalid-link')
    expect(await callback('?code=late')).toBe('/login?reason=invalid-link')
  })

  it('Supabase error params never attempt an exchange', async () => {
    expect(await callback('?error=access_denied&error_code=otp_expired&next=/reset-password')).toBe(
      '/reset-password?status=invalid-link'
    )
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('no code/token at all is treated as an invalid link', async () => {
    expect(await callback('')).toBe('/login?reason=invalid-link')
  })

  it('blocks open redirects via next', async () => {
    expect(await callback('?code=abc&next=//evil.example.com')).toBe('/pos')
    expect(await callback('?code=abc&next=https://evil.example.com')).toBe('/pos')
  })
})

describe('Auth helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('safeRedirectPath only allows same-site paths', () => {
    expect(safeRedirectPath('/pos')).toBe('/pos')
    expect(safeRedirectPath('//evil.com')).toBe('/pos')
    expect(safeRedirectPath('/\\evil.com')).toBe('/pos')
    expect(safeRedirectPath(null, '/login')).toBe('/login')
    expect(safeRedirectPath('/\t/evil.com')).toBe('/pos')
    expect(safeRedirectPath('/\n/evil.com')).toBe('/pos')
    expect(safeRedirectPath('/\r\n/evil.com')).toBe('/pos')
    expect(safeRedirectPath('/a\\..\\/evil.com')).toBe('/pos')
    expect(safeRedirectPath('/bills?tab=open#x')).toBe('/bills?tab=open#x')
  })

  it('public routes include auth pages and the callback but not protected pages', () => {
    for (const p of ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/auth/callback']) {
      expect(isPublicRoute(p)).toBe(true)
    }
    for (const p of ['/pos', '/', '/settings', '/loginx', '/auth']) {
      expect(isPublicRoute(p)).toBe(false)
    }
  })

  it('public key prefers the publishable key and falls back to the anon key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test')
    expect(getSupabasePublicKey()).toBe('anon-test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-test')
    expect(getSupabasePublicKey()).toBe('publishable-test')
  })
})
