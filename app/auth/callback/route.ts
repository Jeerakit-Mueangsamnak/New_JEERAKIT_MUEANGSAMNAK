import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { safeRedirectPath } from '@/lib/supabase/env'

/**
 * Central Supabase Auth callback for every email link:
 * - Email verification (signup / email change)  -> /verify-email?status=verified
 * - Password recovery                           -> /reset-password
 * - Magic Link / invite                         -> /pos
 *
 * Supports both link styles Supabase can send:
 * - PKCE:        ?code=...                      -> exchangeCodeForSession
 * - Token hash:  ?token_hash=...&type=...       -> verifyOtp (works across devices/browsers)
 *
 * The session is written to cookies by the SSR server client, so the next request
 * (middleware + AuthProvider) sees a real Supabase session.
 */

const OTP_TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

function successPathFor(type: EmailOtpType | null, next: string | null): string {
  if (next) return safeRedirectPath(next)
  switch (type) {
    case 'recovery':
      return '/reset-password'
    case 'signup':
    case 'email':
    case 'email_change':
      return '/verify-email?status=verified'
    default:
      return '/pos'
  }
}

function failurePathFor(type: EmailOtpType | null, next: string | null): string {
  const target = type === 'recovery' ? '/reset-password' : next ? safeRedirectPath(next) : ''
  if (target.startsWith('/reset-password')) return '/reset-password?status=invalid-link'
  if (target.startsWith('/verify-email') || type === 'signup' || type === 'email' || type === 'email_change') {
    return '/verify-email?status=invalid-link'
  }
  return '/login?reason=invalid-link'
}

function withVerifiedStatus(path: string): string {
  // Verification links that carry `next=/verify-email` should land on the success state
  return path === '/verify-email' ? '/verify-email?status=verified' : path
}

/**
 * Origin the browser actually used. `nextUrl.origin` can be the bind address
 * (e.g. http://0.0.0.0:3000 with `next dev -H 0.0.0.0`), so prefer the Host headers.
 */
function requestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (!host) return request.nextUrl.origin
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(/:$/, '')
  return `${proto}://${host}`
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const origin = requestOrigin(request)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const rawType = searchParams.get('type')
  const type = OTP_TYPES.includes(rawType as EmailOtpType) ? (rawType as EmailOtpType) : null
  const next = searchParams.get('next')

  // Supabase reports expired/invalid links via error params on the redirect
  if (searchParams.get('error') || searchParams.get('error_code')) {
    return NextResponse.redirect(new URL(failurePathFor(type, next), origin))
  }

  try {
    const supabase = await createServerSupabase()

    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      if (!error) {
        return NextResponse.redirect(new URL(withVerifiedStatus(successPathFor(type, next)), origin))
      }
      console.error('Auth callback verifyOtp failed:', error.code || error.message)
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) {
        return NextResponse.redirect(new URL(withVerifiedStatus(successPathFor(type, next)), origin))
      }
      console.error('Auth callback code exchange failed:', error.code || error.message)
      // Supabase has already confirmed the email by the time it redirects here. If only the
      // sign-in step timed out (flow state lives ~5 minutes), the address IS verified: tell the
      // user to sign in. Never do this for password recovery, which needs the session.
      if (
        error.code === 'flow_state_expired' &&
        failurePathFor(type, next).startsWith('/verify-email')
      ) {
        return NextResponse.redirect(new URL('/verify-email?status=verified', origin))
      }
    }
  } catch (err) {
    console.error('Auth callback error:', err instanceof Error ? err.message : err)
  }

  return NextResponse.redirect(new URL(failurePathFor(type, next), origin))
}
