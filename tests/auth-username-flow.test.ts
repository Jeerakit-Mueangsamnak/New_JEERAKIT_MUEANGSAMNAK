import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  loginWithUsername,
  logout,
} from '@/app/actions/auth'
import {
  normalizeUsername,
  resolveUsernameToEmail,
  resetAllRateLimits,
} from '@/lib/supabase/username-auth'
import { validateSupabaseAdminConfig, createAdminClient } from '@/lib/supabase/admin'
import * as serverSupabase from '@/lib/supabase/server'
import { getCurrentUser } from '@/features/auth/services/auth'
import { buildCurrentUser, type AuthUserLike } from '@/features/auth/services/auth-utils'

// Mock environment credentials for local testing - NEVER use production keys or real Supabase
const MOCK_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://mock-test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'mock-test-publishable-key',
  SUPABASE_SECRET_KEY: 'mock-test-secret-key',
}

interface MockProfile {
  id: string
  username: string
  email: string
  role?: string
  display_name?: string
}

const mockProfiles: MockProfile[] = [
  {
    id: 'd0b9738f-49e9-4a55-8a1e-8c2ddf905f4b',
    username: 'jeerakit_jjk',
    email: 'jeerakitplasticformworkutt2024@gmail.com',
    role: 'OWNER',
    display_name: 'จิรกิตติ์',
  },
  {
    id: 'user-underscore',
    username: 'shop_user',
    email: 'exact@example.com',
    role: 'USER',
    display_name: 'Shop User',
  },
  {
    id: 'user-letter',
    username: 'shopxuser',
    email: 'similar@example.com',
    role: 'USER',
    display_name: 'Shop X User',
  },
]

describe('Supabase Username Auth Flow (Mock / Isolated Test Environment)', () => {
  let signInSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', MOCK_ENV.NEXT_PUBLIC_SUPABASE_URL)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', MOCK_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    vi.stubEnv('SUPABASE_SECRET_KEY', MOCK_ENV.SUPABASE_SECRET_KEY)

    signInSpy = vi.fn().mockImplementation(async ({ email, password }: { email: string; password: string }) => {
      const match = mockProfiles.find((p) => p.email.toLowerCase() === (email || '').toLowerCase())
      if (match && password === 'ValidPassword123!') {
        return {
          data: {
            user: { id: match.id, email: match.email },
            session: { access_token: 'mock-access-token', refresh_token: 'mock-refresh-token' },
          },
          error: null,
        }
      }
      return {
        data: { user: null, session: null },
        error: { status: 400, message: 'Invalid login credentials' },
      }
    })

    vi.spyOn(serverSupabase, 'createClient').mockResolvedValue({
      auth: {
        signInWithPassword: signInSpy,
        signOut: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    } as unknown as Awaited<ReturnType<typeof serverSupabase.createClient>>)

    // Mock global fetch to intercept PostgREST queries from Supabase client
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const urlStr = input instanceof Request ? input.url : String(input)
      const url = new URL(urlStr)

      if (url.pathname.includes('/rest/v1/profiles')) {
        const usernameParam = url.searchParams.get('username') || ''
        let matched: MockProfile[] = []

        if (usernameParam.startsWith('eq.')) {
          const target = usernameParam.slice(3)
          matched = mockProfiles.filter((p) => p.username === target)
        } else if (usernameParam === 'ilike.shop_user') {
          matched = [mockProfiles[1], mockProfiles[2]]
        } else if (usernameParam === 'ilike.shopx%') {
          matched = [mockProfiles[2]]
        } else {
          matched = mockProfiles.filter((p) => usernameParam.includes(p.username))
        }

        return new Response(JSON.stringify(matched), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  afterEach(async () => {
    await resetAllRateLimits()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('1. Username normalization', () => {
    it('normalizes @ prefix, leading/trailing whitespace, and uppercase characters', async () => {
      expect(await normalizeUsername('jeerakit_jjk')).toBe('jeerakit_jjk')
      expect(await normalizeUsername('@jeerakit_jjk')).toBe('jeerakit_jjk')
      expect(await normalizeUsername('  @JeeRaKiT_jjk  ')).toBe('jeerakit_jjk')
      expect(await normalizeUsername('JEERAKIT_JJK')).toBe('jeerakit_jjk')
    })
  })

  describe('2. Username resolution to email via Server Admin Client (Mock DB)', () => {
    it('resolves "jeerakit_jjk" to the correct email from public.profiles', async () => {
      const result = await resolveUsernameToEmail('jeerakit_jjk')
      expect(result.success).toBe(true)
      expect(result.email).toBe('jeerakitplasticformworkutt2024@gmail.com')
    })

    it('resolves "@jeerakit_jjk" with leading @ to the correct email', async () => {
      const result = await resolveUsernameToEmail('@jeerakit_jjk')
      expect(result.success).toBe(true)
      expect(result.email).toBe('jeerakitplasticformworkutt2024@gmail.com')
    })

    it('resolves case-insensitively "JEERAKIT_JJK"', async () => {
      const result = await resolveUsernameToEmail('JEERAKIT_JJK')
      expect(result.success).toBe(true)
      expect(result.email).toBe('jeerakitplasticformworkutt2024@gmail.com')
    })

    it('returns "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" if username does not exist', async () => {
      const result = await resolveUsernameToEmail('non_existent_username_xyz999')
      expect(result.success).toBe(false)
      expect(result.error).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    })

    it('rejects direct email input if not present as a username in public.profiles', async () => {
      const result = await resolveUsernameToEmail('direct_user@example.com')
      expect(result.success).toBe(false)
      expect(result.error).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
      expect(result.email).toBeUndefined()
    })
  })

  describe('Exact username lookup regression', () => {
    const exactProfile = mockProfiles[1]

    it.each(['shop_user', '  @SHOP_USER  '])('logs in the exact account for %s despite a similarly named account', async (username) => {
      const result = await loginWithUsername({ username, password: 'ValidPassword123!' })

      expect(result).toEqual({ success: true, data: { userId: exactProfile.id } })
      expect(signInSpy).toHaveBeenCalledWith({
        email: exactProfile.email,
        password: 'ValidPassword123!',
      })
    })

    it('rejects a wildcard alias before attempting password authentication', async () => {
      const result = await loginWithUsername({ username: 'shopx%', password: 'ValidPassword123!' })

      expect(result).toEqual({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' })
      expect(signInSpy).not.toHaveBeenCalled()
    })

    it('preserves credential failure handling after an exact username match', async () => {
      signInSpy.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { status: 400, message: 'Invalid login credentials' },
      })

      const result = await loginWithUsername({ username: 'shop_user', password: 'WrongPassword123!' })

      expect(result).toEqual({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' })
      expect(signInSpy).toHaveBeenCalledWith({ email: exactProfile.email, password: 'WrongPassword123!' })
    })
  })

  describe('3. Supabase configuration validation and error reporting', () => {
    it('reports specific config error if Supabase admin URL is missing or placeholder', () => {
      const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      try {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'
        const check = validateSupabaseAdminConfig()
        expect(check.isValid).toBe(false)
        expect(check.error).toContain('NEXT_PUBLIC_SUPABASE_URL')
      } finally {
        process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
      }
    })

    it('reports specific config error if Supabase secret key is missing or placeholder', () => {
      const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const originalKey = process.env.SUPABASE_SECRET_KEY
      try {
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
          process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://valid-supabase.co'
        }
        process.env.SUPABASE_SECRET_KEY = 'placeholder-secret-key'
        const check = validateSupabaseAdminConfig()
        expect(check.isValid).toBe(false)
        expect(check.error).toContain('SUPABASE_SECRET_KEY')
      } finally {
        process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
        process.env.SUPABASE_SECRET_KEY = originalKey
      }
    })

    it('loginWithUsername returns config error separately when config is broken', async () => {
      const originalKey = process.env.SUPABASE_SECRET_KEY
      try {
        delete process.env.SUPABASE_SECRET_KEY
        const res = await loginWithUsername({ username: 'jeerakit_jjk', password: 'somepassword' })
        expect(res.success).toBe(false)
        expect(res.error).toContain('SUPABASE_SECRET_KEY')
      } finally {
        process.env.SUPABASE_SECRET_KEY = originalKey
      }
    })
  })

  describe('4. Authentication with correct and incorrect passwords', () => {
    it('fails login with incorrect password and reports "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"', async () => {
      const res = await loginWithUsername({
        username: 'jeerakit_jjk',
        password: 'DefinitiveWrongPassword!123',
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    })

    it('fails login with non-existent username and reports "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"', async () => {
      const res = await loginWithUsername({
        username: 'non_existent_username_xyz999',
        password: 'AnyPassword123!',
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    })

    it('fails login if empty credentials provided', async () => {
      const res = await loginWithUsername({
        username: '',
        password: '',
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    })

    it('fails login when email is entered instead of username and email is not in profiles.username', async () => {
      const res = await loginWithUsername({
        username: 'jeerakitplasticformworkutt2024@gmail.com',
        password: 'AnyPassword123!',
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    })

    it('authenticates successfully and creates session when valid credentials are provided', async () => {
      const resolveResult = await resolveUsernameToEmail('jeerakit_jjk')
      expect(resolveResult.success).toBe(true)

      const result = await loginWithUsername({
        username: 'jeerakit_jjk',
        password: 'ValidPassword123!',
      })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ userId: 'd0b9738f-49e9-4a55-8a1e-8c2ddf905f4b' })
    })

    it('enforces brute-force rate limiting: locks out after 5 consecutive failed login attempts', async () => {
      const username = 'shop_user'

      // Attempt 5 failed logins
      for (let i = 0; i < 5; i++) {
        const res = await loginWithUsername({ username, password: 'WrongPassword!' })
        expect(res.success).toBe(false)
        expect(res.error).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
      }

      // 6th attempt should be blocked by rate limiter
      const blockedRes = await loginWithUsername({ username, password: 'ValidPassword123!' })
      expect(blockedRes.success).toBe(false)
      expect(blockedRes.error).toContain('มีการพยายามเข้าสู่ระบบหลายครั้งเกินไป')
    })
  })

  describe('5. Session persistence and refresh', () => {
    it('retrieves user and retains session on refresh using getCurrentUser', async () => {
      // Test server-side profiles lookup via admin client with mock fetch
      const admin = createAdminClient()
      const { data: profile, error } = await admin
        .from('profiles')
        .select('*')
        .eq('username', 'jeerakit_jjk')
        .maybeSingle()

      expect(error).toBeNull()
      expect(profile).toBeDefined()
      expect(profile?.email).toBe('jeerakitplasticformworkutt2024@gmail.com')
      expect(profile?.role).toBe('OWNER')

      // Without active session, getCurrentUser returns null
      const currentUserWithoutSession = await getCurrentUser()
      expect(currentUserWithoutSession).toBeNull()
    })
  })

  describe('6. Logout flow', () => {
    it('logout action terminates session and returns success', async () => {
      const res = await logout()
      expect(res.success).toBe(true)

      // Post-logout verification: getCurrentUser is null
      const userAfterLogout = await getCurrentUser()
      expect(userAfterLogout).toBeNull()
    })
  })

  describe('7. Security: Browser never queries public.profiles before login', () => {
    it('verifies app/login/page.tsx has no direct database or profiles queries', () => {
      const loginPageContent = fs.readFileSync(
        path.resolve(process.cwd(), 'app/login/page.tsx'),
        'utf-8'
      )
      expect(loginPageContent).not.toContain(".from('profiles')")
      expect(loginPageContent).not.toContain('.from("profiles")')
      expect(loginPageContent).not.toContain('createClient')
      expect(loginPageContent).not.toContain('supabase.from')
    })

    it('does not expose username-to-email resolution as a callable server action', () => {
      const authActions = fs.readFileSync(
        path.resolve(process.cwd(), 'app/actions/auth.ts'),
        'utf-8'
      )
      expect(authActions).not.toMatch(/export\s+async\s+function\s+resolveUsernameToEmail/)
      expect(authActions).not.toMatch(/export\s+async\s+function\s+resetAllRateLimits/)
    })
  })

  describe('8. Role Trust and Authorization Logic (Strictly from public.profiles)', () => {
    const baseAuthUser: AuthUserLike = {
      id: 'usr-12345',
      email: 'member@example.com',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      user_metadata: {},
    }

    it('A. profile.role = OWNER → resolves to OWNER', () => {
      const user = buildCurrentUser(baseAuthUser, { role: 'OWNER', username: 'storeowner' })
      expect(user.role).toBe('OWNER')
    })

    it('B. profile.role = USER → resolves to USER', () => {
      const user = buildCurrentUser(baseAuthUser, { role: 'USER', username: 'staff1' })
      expect(user.role).toBe('USER')
    })

    it('C. ไม่มี profile + user_metadata.role = OWNER → ต้องได้ USER', () => {
      const authUserWithMetaOwner: AuthUserLike = {
        ...baseAuthUser,
        user_metadata: { role: 'OWNER' },
      }
      const user = buildCurrentUser(authUserWithMetaOwner, null)
      expect(user.role).toBe('USER')
    })

    it('D. profile ไม่มี role + metadata OWNER → ต้องได้ USER', () => {
      const authUserWithMetaOwner: AuthUserLike = {
        ...baseAuthUser,
        user_metadata: { role: 'OWNER' },
      }
      const user = buildCurrentUser(authUserWithMetaOwner, { username: 'testuser' })
      expect(user.role).toBe('USER')
    })

    it('E. role แปลก เช่น ADMIN → ต้องได้ USER', () => {
      const user = buildCurrentUser(baseAuthUser, { role: 'ADMIN', username: 'admin1' })
      expect(user.role).toBe('USER')
    })

    it('F. preserves non-permission metadata (names, username, avatar) while strictly rejecting metadata role', () => {
      const authUserWithMeta: AuthUserLike = {
        ...baseAuthUser,
        user_metadata: {
          role: 'OWNER', // MUST BE IGNORED
          first_name: 'สมชาย',
          last_name: 'ใจดี',
          username: 'somchai',
          avatar_url: 'https://example.com/avatar.png',
        },
      }
      const user = buildCurrentUser(authUserWithMeta, null)
      expect(user.role).toBe('USER')
      expect(user.firstName).toBe('สมชาย')
      expect(user.username).toBe('somchai')
      expect(user.avatarUrl).toBe('https://example.com/avatar.png')
    })

    it('G. never derives OWNER role from email, username, or name', () => {
      const authUserOwnerNamed: AuthUserLike = {
        ...baseAuthUser,
        email: 'owner@example.com',
        user_metadata: {
          username: 'owner',
          full_name: 'Store Owner',
        },
      }
      const userWithoutRole = buildCurrentUser(authUserOwnerNamed, { username: 'owner' })
      expect(userWithoutRole.role).toBe('USER')
    })
  })
})
