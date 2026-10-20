'use server'

import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient, validateSupabaseAdminConfig } from '@/lib/supabase/admin'
import { getSupabasePublicKey } from '@/lib/supabase/env'
import {
  checkRateLimit,
  clearRateLimit,
  normalizeUsername,
  recordFailedAttempt,
  resolveUsernameToEmail,
} from '@/lib/supabase/username-auth'

export interface AuthActionResult<T = unknown> {
  success: boolean
  error?: string
  data?: T
}

/**
 * Login with username and password:
 * 1. Checks Supabase configuration (returns config error if invalid)
 * 2. Resolves username to email strictly on the server using admin client
 * 3. Authenticates using Supabase Auth signInWithPassword via SSR client
 * 4. Sets session cookies automatically
 * 5. Returns unified error "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" on any credential failure
 */
export async function loginWithUsername(formData: {
  username: string
  password: string
}): Promise<AuthActionResult> {
  try {
    const rawUsername = formData.username || ''
    const rawPassword = formData.password || ''

    if (!rawUsername.trim() || !rawPassword) {
      return {
        success: false,
        error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      }
    }

    // Check Supabase public key configuration for SSR client
    const publishableKey = getSupabasePublicKey()
    if (!publishableKey || publishableKey.includes('placeholder')) {
      return {
        success: false,
        error: 'การตั้งค่า Supabase Publishable Key ไม่ถูกต้อง กรุณาตรวจสอบ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_ANON_KEY)',
      }
    }

    const cleanUsername = await normalizeUsername(rawUsername)
    const loginRateLimitKey = `login:${cleanUsername}`
    const loginLimitCheck = await checkRateLimit(loginRateLimitKey)
    if (!loginLimitCheck.allowed) {
      return {
        success: false,
        error: 'มีการพยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่ก่อนลองใหม่อีกครั้ง',
      }
    }

    // 1. Resolve username to email strictly on the server
    const resolveResult = await resolveUsernameToEmail(rawUsername)
    if (!resolveResult.success || !resolveResult.email) {
      await recordFailedAttempt(loginRateLimitKey)
      return {
        success: false,
        error: resolveResult.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      }
    }

    // 2. Validate password and establish session via SSR client
    let serverClient
    try {
      serverClient = await createServerSupabase()
    } catch (serverClientErr: unknown) {
      console.error('Failed to create server Supabase client:', serverClientErr)
      return {
        success: false,
        error: 'การตั้งค่าระบบ Server Session ไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่าระบบ',
      }
    }

    const { data: signInData, error: signInError } = await serverClient.auth.signInWithPassword({
      email: resolveResult.email,
      password: rawPassword,
    })

    if (signInError) {
      // Correct password but email not yet confirmed (Supabase "Confirm email" is enabled)
      if (signInError.code === 'email_not_confirmed') {
        return {
          success: false,
          error: 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล กรุณากดลิงก์ยืนยันในอีเมลก่อนเข้าสู่ระบบ',
        }
      }

      // Network / Supabase outage — not a credential problem, so do not count it as a failed attempt
      if (signInError.name === 'AuthRetryableFetchError' || !signInError.status || signInError.status >= 500) {
        console.error('Supabase Auth unavailable during login:', signInError.message)
        return {
          success: false,
          error: 'ไม่สามารถเชื่อมต่อ Supabase Auth ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
        }
      }

      await recordFailedAttempt(loginRateLimitKey)
      const errMsg = (signInError.message || '').toLowerCase()
      // Differentiate config / API key / infrastructure errors from credential errors
      if (
        signInError.status === 401 ||
        errMsg.includes('api key') ||
        errMsg.includes('jwt') ||
        errMsg.includes('unauthorized') ||
        errMsg.includes('url')
      ) {
        return {
          success: false,
          error: `การตั้งค่า Supabase Auth ไม่ถูกต้อง: ${signInError.message}`,
        }
      }

      // Credential failure (e.g. invalid password)
      return {
        success: false,
        error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      }
    }

    if (!signInData?.session) {
      await recordFailedAttempt(loginRateLimitKey)
      return {
        success: false,
        error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      }
    }

    await clearRateLimit(loginRateLimitKey)

    // Correct password, but only an OWNER-approved ACTIVE member may hold a session
    if (resolveResult.memberStatus !== 'ACTIVE') {
      try {
        await serverClient.auth.signOut()
      } catch {
        // The session cookie is still cleared by the next middleware pass
      }
      return {
        success: false,
        error:
          resolveResult.memberStatus === 'SUSPENDED'
            ? 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อเจ้าของร้าน'
            : 'บัญชีนี้ยังรอเจ้าของร้านอนุมัติ เมื่ออนุมัติแล้วจึงจะเข้าสู่ระบบได้',
      }
    }

    return {
      success: true,
      data: {
        userId: signInData.user.id,
      },
    }
  } catch (err: unknown) {
    console.error('Unexpected error in loginWithUsername:', err)
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('Supabase') || msg.includes('KEY') || msg.includes('URL')) {
      return {
        success: false,
        error: msg,
      }
    }
    return {
      success: false,
      error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
    }
  }
}

/**
 * Site origin used to build Supabase email links (must be in Supabase Auth "Redirect URLs").
 * Priority: NEXT_PUBLIC_SITE_URL -> request Origin -> VERCEL_URL -> localhost.
 */
async function getSiteUrl(): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '')
  if (configured) return configured

  try {
    const { headers } = await import('next/headers')
    const origin = (await headers()).get('origin')
    if (origin) return origin.replace(/\/+$/, '')
  } catch {
    // Outside a request context (tests / scripts)
  }

  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
}

/**
 * Register user:
 * 1. Normalizes fields
 * 2. Checks username uniqueness (case-insensitive, server-side via admin client)
 * 3. Signs up with Supabase Auth (username / first / last name in user metadata)
 * 4. The DB trigger on auth.users creates the linked public.profiles row
 * 5. Supabase sends the confirmation email; its link returns through /auth/callback
 */
export async function registerUser(formData: {
  firstName: string
  lastName: string
  email: string
  username: string
  password: string
}): Promise<AuthActionResult> {
  try {
    const firstName = (formData.firstName || '').trim()
    const lastName = (formData.lastName || '').trim()
    const rawEmail = (formData.email || '').trim()
    const rawUsername = (formData.username || '').trim()
    const password = formData.password || ''

    if (!rawEmail || !rawUsername || !password) {
      return {
        success: false,
        error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน',
      }
    }

    const cleanUsername = normalizeUsername(rawUsername)
    const cleanEmail = rawEmail.toLowerCase()

    // Validation
    if (cleanUsername.length < 3) {
      return {
        success: false,
        error: 'ชื่อผู้ใช้งานต้องมีความยาวอย่างน้อย 3 ตัวอักษร',
      }
    }

    if (password.length < 8) {
      return {
        success: false,
        error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร',
      }
    }

    const configCheck = validateSupabaseAdminConfig()
    if (!configCheck.isValid) {
      return {
        success: false,
        error: configCheck.error || 'การตั้งค่า Supabase ไม่ถูกต้อง กรุณาตรวจสอบ Environment Variables',
      }
    }

    // Check if username already exists in profiles (never proceed if the lookup itself failed,
    // otherwise an Auth user could be created without a usable username mapping)
    const adminClient = createAdminClient()
    const { data: existingProfile, error: profileLookupError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('username', cleanUsername)
      .maybeSingle()

    if (profileLookupError) {
      console.error('Register profile lookup error:', profileLookupError)
      if (profileLookupError.code === 'PGRST205' || profileLookupError.code === '42P01') {
        return {
          success: false,
          error: 'ฐานข้อมูล Supabase ยังไม่มีตาราง profiles (ยังไม่ได้ apply migration) กรุณาติดต่อผู้ดูแลระบบ',
        }
      }
      return {
        success: false,
        error: 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล Supabase',
      }
    }

    if (existingProfile) {
      return {
        success: false,
        error: 'ชื่อผู้ใช้งานนี้ถูกใช้งานแล้ว กรุณาเลือกชื่อผู้ใช้อื่น',
      }
    }

    // Call Supabase Auth signUp
    const siteUrl = await getSiteUrl()
    const serverClient = await createServerSupabase()
    const { data: signUpData, error: signUpError } = await serverClient.auth.signUp({
      email: cleanEmail,
      password: password,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?next=/verify-email`,
        data: {
          username: cleanUsername,
          first_name: firstName,
          last_name: lastName,
        },
      },
    })

    if (signUpError || !signUpData.user) {
      console.error('Supabase signUp error:', signUpError?.code || signUpError?.message)
      // The profile trigger rejects duplicate usernames (unique index) -> Auth reports a DB error
      if (signUpError?.code === 'unexpected_failure' || /database error/i.test(signUpError?.message || '')) {
        return {
          success: false,
          error: 'ชื่อผู้ใช้งานนี้ถูกใช้งานแล้ว หรือระบบสร้างโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        }
      }
      if (signUpError?.code === 'user_already_exists' || signUpError?.code === 'email_exists') {
        return {
          success: false,
          error: 'อีเมลนี้ถูกใช้ลงทะเบียนแล้ว',
        }
      }
      if (signUpError?.code === 'weak_password') {
        return {
          success: false,
          error: 'รหัสผ่านไม่ปลอดภัยพอตามนโยบายของระบบ กรุณาตั้งรหัสผ่านใหม่',
        }
      }
      return {
        success: false,
        error: 'ไม่สามารถลงทะเบียนได้ กรุณาลองใหม่อีกครั้ง',
      }
    }

    // With "Confirm email" enabled Supabase hides existing emails by returning a user with no identities
    if (Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
      return {
        success: false,
        error: 'อีเมลนี้ถูกใช้ลงทะเบียนแล้ว',
      }
    }

    return {
      success: true,
    }
  } catch (err: unknown) {
    console.error('Unexpected error in registerUser:', err)
    return {
      success: false,
      error: 'เกิดข้อผิดพลาดในการลงทะเบียน กรุณาลองใหม่อีกครั้ง',
    }
  }
}

/**
 * Forgot password:
 * Sends a password reset email using Supabase Auth.
 * The email link returns through /auth/callback, which creates the recovery session
 * and then forwards to /reset-password.
 */
export async function resetPasswordForEmail(email: string): Promise<AuthActionResult> {
  try {
    const rawEmail = (email || '').trim()
    if (!rawEmail) {
      return { success: false, error: 'กรุณากรอกอีเมล' }
    }

    const serverClient = await createServerSupabase()
    const siteUrl = await getSiteUrl()

    const { error } = await serverClient.auth.resetPasswordForEmail(rawEmail.toLowerCase(), {
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    })

    if (error) {
      // Don't expose if account exists or not, standard practice for security
      // Just log it and return generic success or specific non-enumeration errors if any
      console.error('Reset password error:', error)
      return { success: false, error: 'ไม่สามารถส่งลิงก์รีเซ็ตรหัสผ่านได้ กรุณาลองใหม่อีกครั้ง' }
    }

    return { success: true }
  } catch (err: unknown) {
    console.error('Reset password exception:', err)
    return { success: false, error: 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ' }
  }
}

/**
 * Update password (for reset password flow / change password):
 * Uses the active session to update the user's password.
 */
export async function updatePassword(password: string): Promise<AuthActionResult> {
  try {
    if (!password || password.length < 8) {
      return { success: false, error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร' }
    }

    const serverClient = await createServerSupabase()

    // Must have a real Supabase session (recovery session from /auth/callback, or a logged-in user)
    const { data: userData } = await serverClient.auth.getUser()
    if (!userData?.user) {
      return {
        success: false,
        error: 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่อีกครั้ง',
      }
    }

    const { error } = await serverClient.auth.updateUser({
      password: password,
    })

    if (error) {
      console.error('Update password error:', error.code || error.message)
      if (error.code === 'same_password') {
        return { success: false, error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' }
      }
      if (error.code === 'weak_password') {
        return { success: false, error: 'รหัสผ่านไม่ปลอดภัยพอตามนโยบายของระบบ กรุณาตั้งรหัสผ่านใหม่' }
      }
      return { success: false, error: 'ไม่สามารถเปลี่ยนรหัสผ่านได้ กรุณาลองใหม่อีกครั้ง' }
    }

    return { success: true }
  } catch (err: unknown) {
    console.error('Update password exception:', err)
    return { success: false, error: 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ' }
  }
}

/**
 * Signed-in user changes their own password: the current password is checked first
 * (with a throw-away client that keeps no session), then the new one is saved.
 */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<AuthActionResult> {
  try {
    if (!currentPassword) return { success: false, error: 'กรุณากรอกรหัสผ่านเดิม' }
    const serverClient = await createServerSupabase()
    const { data: userData } = await serverClient.auth.getUser()
    const email = userData?.user?.email
    if (!email) return { success: false, error: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง' }

    const { createClient } = await import('@supabase/supabase-js')
    const { getSupabaseUrl } = await import('@/lib/supabase/env')
    const probe = createClient(getSupabaseUrl(), getSupabasePublicKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: verifyError } = await probe.auth.signInWithPassword({ email, password: currentPassword })
    if (verifyError) return { success: false, error: 'รหัสผ่านเดิมไม่ถูกต้อง' }
    await probe.auth.signOut({ scope: 'local' })

    return updatePassword(newPassword)
  } catch (err: unknown) {
    console.error('Change password exception:', err)
    return { success: false, error: 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ' }
  }
}

/**
 * Re-export getCurrentUser for Server Actions and server modules
 */
export async function getCurrentUser() {
  const { getCurrentUser: getAuthUser } = await import('@/features/auth/services/auth')
  return getAuthUser()
}

/**
 * Server action to sign out and clear SSR session cookies
 */
export async function logout(): Promise<AuthActionResult> {
  try {
    const serverClient = await createServerSupabase()
    await serverClient.auth.signOut()
    return {
      success: true,
    }
  } catch {
    return {
      success: false,
      error: 'เกิดข้อผิดพลาดในการออกจากระบบ',
    }
  }
}
