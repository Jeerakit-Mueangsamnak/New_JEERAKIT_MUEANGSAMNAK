import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isPublicRoute } from '@/features/auth/services/public-routes'
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase/env'

const PROFILE_CHECK_TIMEOUT_MS = 5000
const AUTH_CHECK_TIMEOUT_MS = 5000

/** 503 "try again" when the session or member status could not be read; keeps any refreshed auth cookies. */
function profileCheckUnavailable(request: NextRequest, supabaseResponse: NextResponse) {
  const wantsPage = (request.headers.get('accept') ?? '').includes('text/html')
  const body = wantsPage
    ? '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ตรวจสอบสิทธิ์ไม่สำเร็จ</title></head>' +
      '<body style="font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f8fafc;color:#334155">' +
      '<div style="text-align:center;padding:16px"><p style="font-weight:700">ตรวจสอบสิทธิ์ผู้ใช้ไม่สำเร็จชั่วคราว</p>' +
      '<p style="font-size:14px">ยังอยู่ในระบบตามเดิม กรุณาลองใหม่อีกครั้ง</p>' +
      '<button onclick="location.reload()" style="margin-top:8px;padding:8px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer">ลองใหม่</button></div></body></html>'
    : 'Profile check unavailable'
  const response = new NextResponse(body, {
    status: 503,
    headers: {
      'Content-Type': wantsPage ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '5',
    },
  })
  supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  return response
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = getSupabaseUrl()
  const supabasePublishableKey = getSupabasePublicKey()

  if (!supabaseUrl || !supabasePublishableKey) {
    return supabaseResponse
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // IMPORTANT: Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.
  let hasUser = false
  let authUnreachable = false
  let userId: string | null = null
  let authTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const authTimeout = new Promise<'timeout'>((resolve) => {
      authTimer = setTimeout(() => resolve('timeout'), AUTH_CHECK_TIMEOUT_MS)
    })
    const answer = await Promise.race([supabase.auth.getUser(), authTimeout])
    if (answer === 'timeout') {
      authUnreachable = true
    } else {
      const { data, error } = answer
      hasUser = Boolean(data?.user)
      userId = data?.user?.id ?? null
      // Network/5xx failures must not log people out; only a definite "no session" blocks access
      authUnreachable = Boolean(error) && (error?.name === 'AuthRetryableFetchError' || !error?.status || error.status >= 500)
    }
  } catch {
    // Supabase unreachable: the session is unknown (handled below, never as signed out)
    authUnreachable = true
  } finally {
    clearTimeout(authTimer)
  }

  const redirectToLogin = () => {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    const redirectResponse = NextResponse.redirect(loginUrl)
    // Carry over any cookie changes (e.g. cleared stale session) made by Supabase above
    supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  if (isPublicRoute(request.nextUrl.pathname)) {
    return supabaseResponse
  }

  // Auth server unreachable: neither sign out nor let a protected page through; ask to retry.
  if (authUnreachable) {
    return profileCheckUnavailable(request, supabaseResponse)
  }

  // Server-side protected-route guard (AuthShell keeps the same rule on the client)
  if (!hasUser) {
    return redirectToLogin()
  }

  // A session alone is not enough: only an ACTIVE member may use protected routes.
  // Re-checked on every request so a member suspended mid-session is cut off.
  if (userId) {
    let profile: { status?: string | null; is_approved?: boolean | null } | null = null
    let profileUnreadable = false
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), PROFILE_CHECK_TIMEOUT_MS)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('status, is_approved')
        .eq('id', userId)
        .abortSignal(abort.signal)
        .maybeSingle()
      profile = data
      profileUnreadable = Boolean(error)
    } catch {
      profileUnreadable = true
    } finally {
      clearTimeout(timer)
    }

    // Query error / timeout says nothing about the member: keep the session (no sign-out),
    // but still fail closed — the page is not served until the status can be read.
    if (profileUnreadable) {
      return profileCheckUnavailable(request, supabaseResponse)
    }

    // Same rule as the app (normalizeMemberStatus): ACTIVE and approved. Anything else that was
    // read — PENDING, SUSPENDED, not approved, or no profile row — is not allowed in.
    // The session is ended too, otherwise /login would bounce a signed-in client back here.
    if (profile?.status !== 'ACTIVE' || profile?.is_approved !== true) {
      try {
        await supabase.auth.signOut()
      } catch {
        // Cookies are still cleared below if Supabase answered
      }
      return redirectToLogin()
    }
  }

  return supabaseResponse
}
