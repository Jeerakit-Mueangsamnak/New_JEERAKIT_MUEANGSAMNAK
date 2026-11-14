import 'server-only'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Sign-in slow-down (owner 2026-11-12, audit follow-up): counted in the database so every server instance shares
 * it (migration 20261112150000, service_role only). Never a permanent lock:
 * - 10 wrong passwords for one user name from one device address within 15 minutes → that pair waits 15 minutes
 *   (someone at another address — the real staff member — can still sign in);
 * - 30 wrong passwords from one address (any user names) → that address waits 15 minutes.
 * Only hashes are stored, never the user name or the address. If the counter cannot be reached (e.g. the
 * migration is not applied yet) sign-in works as before.
 */

const PAIR_LIMIT = 10
const ADDRESS_LIMIT = 30

export interface LoginThrottleKeys {
  keys: string[]
  limits: number[]
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex')

async function clientAddress(): Promise<string> {
  try {
    const h = await headers()
    const forwarded = h.get('cf-connecting-ip') || h.get('x-real-ip') || h.get('x-forwarded-for')?.split(',')[0]
    return (forwarded || '').trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function loginThrottleKeys(username: string): Promise<LoginThrottleKeys> {
  const address = await clientAddress()
  return {
    keys: [hash(`pair:${username.trim().toLowerCase()}|${address}`), hash(`address:${address}`)],
    limits: [PAIR_LIMIT, ADDRESS_LIMIT],
  }
}

/** Seconds still to wait before another try (0 = may try). */
export async function loginWaitSeconds(t: LoginThrottleKeys): Promise<number> {
  try {
    const { data, error } = await createAdminClient().rpc('login_throttle_wait', { p_keys: t.keys })
    return error ? 0 : Math.max(0, Number(data) || 0)
  } catch {
    return 0
  }
}

/** Counts a wrong try, or clears the user name + address pair after a correct password. */
export async function recordLoginAttempt(t: LoginThrottleKeys, success: boolean): Promise<void> {
  try {
    await createAdminClient().rpc('login_throttle_record', { p_keys: t.keys, p_limits: t.limits, p_success: success })
  } catch {
    // the slow-down is a guard, not part of signing in
  }
}

export function loginWaitMessage(seconds: number): string {
  return `ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอประมาณ ${Math.max(1, Math.ceil(seconds / 60))} นาทีแล้วลองใหม่`
}
