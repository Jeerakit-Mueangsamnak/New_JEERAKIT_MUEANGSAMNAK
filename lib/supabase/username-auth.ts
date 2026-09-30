import 'server-only'

import { createAdminClient, validateSupabaseAdminConfig } from '@/lib/supabase/admin'

interface RateLimitEntry {
  count: number
  firstAttempt: number
  lockedUntil: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 60 * 1000
const LOCKOUT_MS = 5 * 60 * 1000

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, '').toLowerCase()
}

export function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now()
  const entry = rateLimitStore.get(key)
  if (!entry) return { allowed: true }

  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) }
  }

  if (now - entry.firstAttempt > WINDOW_MS) {
    rateLimitStore.delete(key)
  }
  return { allowed: true }
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now()
  const entry = rateLimitStore.get(key)
  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, firstAttempt: now, lockedUntil: 0 })
    return
  }

  entry.count += 1
  if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = now + LOCKOUT_MS
}

export function clearRateLimit(key: string): void {
  rateLimitStore.delete(key)
}

export function resetAllRateLimits(): void {
  rateLimitStore.clear()
}

export async function resolveUsernameToEmail(username: string): Promise<{
  success: boolean
  email?: string
  error?: string
}> {
  try {
    const cleanUsername = normalizeUsername(username || '')
    if (!cleanUsername) {
      return { success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }
    }

    const configCheck = validateSupabaseAdminConfig()
    if (!configCheck.isValid) {
      return {
        success: false,
        error: configCheck.error || 'การตั้งค่า Supabase ไม่ถูกต้อง กรุณาตรวจสอบ Environment Variables',
      }
    }

    const rateLimitKey = `resolve:${cleanUsername}`
    if (!checkRateLimit(rateLimitKey).allowed) {
      return { success: false, error: 'มีการพยายามตรวจสอบชื่อผู้ใช้บ่อยเกินไป กรุณารอสักครู่' }
    }

    const adminClient = createAdminClient()
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, email, username')
      .eq('username', cleanUsername)
      .maybeSingle()

    if (profileError) {
      console.error('Supabase profile lookup error:', profileError)
      return { success: false, error: 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล Supabase' }
    }

    if (profile?.email) {
      clearRateLimit(rateLimitKey)
      return { success: true, email: profile.email }
    }

    recordFailedAttempt(rateLimitKey)
    return { success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }
  } catch (err: unknown) {
    console.error('Error resolving username to email:', err)
    const msg = err instanceof Error ? err.message : 'การตั้งค่า Supabase ไม่ถูกต้อง กรุณาตรวจสอบระบบ'
    if (msg.includes('Supabase') || msg.includes('KEY') || msg.includes('URL')) {
      return { success: false, error: msg }
    }
    return { success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }
  }
}
