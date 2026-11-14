// Sign-in slow-down (owner 2026-11-12): keys are hashes of user name + device address and of the address alone;
// the server asks the shared counter; if the counter cannot be reached, signing in works as before.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rpc = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }) }))

beforeEach(() => rpc.mockReset())

describe('login throttle', () => {
  it('keys: one per user name + address and one per address, hashed (no user name or address stored)', async () => {
    const { loginThrottleKeys } = await import('@/lib/supabase/login-throttle')
    const a = await loginThrottleKeys('Staff_01')
    const b = await loginThrottleKeys('staff_01 ')
    expect(a.keys).toHaveLength(2)
    expect(a.keys).toEqual(b.keys) // same person typed differently
    expect(a.limits).toEqual([10, 30])
    expect(a.keys.join()).not.toMatch(/staff|203\.0\.113\.7/i)
    const other = await loginThrottleKeys('someone_else')
    expect(other.keys[0]).not.toBe(a.keys[0])
    expect(other.keys[1]).toBe(a.keys[1]) // same address
  })

  it('wait: what the counter says; 0 when it cannot be reached', async () => {
    const { loginThrottleKeys, loginWaitSeconds, loginWaitMessage } = await import('@/lib/supabase/login-throttle')
    const t = await loginThrottleKeys('staff_01')
    rpc.mockResolvedValueOnce({ data: 600, error: null })
    expect(await loginWaitSeconds(t)).toBe(600)
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    expect(await loginWaitSeconds(t)).toBe(0)
    rpc.mockRejectedValueOnce(new Error('offline'))
    expect(await loginWaitSeconds(t)).toBe(0)
    expect(loginWaitMessage(600)).toContain('10 นาที')
  })

  it('record: sends both keys with their limits and whether the password was right', async () => {
    const { loginThrottleKeys, recordLoginAttempt } = await import('@/lib/supabase/login-throttle')
    const t = await loginThrottleKeys('staff_01')
    rpc.mockResolvedValue({ data: 0, error: null })
    await recordLoginAttempt(t, false)
    expect(rpc).toHaveBeenCalledWith('login_throttle_record', { p_keys: t.keys, p_limits: [10, 30], p_success: false })
  })
})
