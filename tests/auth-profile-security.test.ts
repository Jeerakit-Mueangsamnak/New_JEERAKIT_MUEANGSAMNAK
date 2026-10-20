import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildCurrentUser } from '@/features/auth/services/auth-utils'

// The Auth/Profile SQL that is applied to Supabase Cloud (no business tables).
const sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase', 'auth-only', '01_auth_profiles.sql'), 'utf-8')
const sqlNoComments = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

describe('Auth/Profile SQL (supabase/auth-only/01_auth_profiles.sql)', () => {
  it('creates no business tables', () => {
    const tables = [...sqlNoComments.matchAll(/CREATE\s+TABLE\s+public\.(\w+)/gi)].map((m) => m[1])
    expect(tables).toEqual(['profiles'])
  })

  it('profiles: roles are only OWNER/USER, statuses only PENDING/ACTIVE/SUSPENDED, new accounts start PENDING', () => {
    expect(sqlNoComments).toMatch(/CHECK\s*\(role IN \('OWNER', 'USER'\)\)/)
    expect(sqlNoComments).toMatch(/CHECK\s*\(status IN \('PENDING', 'ACTIVE', 'SUSPENDED'\)\)/)
    expect(sqlNoComments).toMatch(/status\s+text NOT NULL DEFAULT 'PENDING'/)
  })

  it('signup trigger never reads the role or status from user metadata', () => {
    expect(sqlNoComments).not.toMatch(/raw_user_meta_data\s*->>\s*'(role|status)'/i)
    expect(sqlNoComments).toMatch(/'USER', 'PENDING'\)/)
  })

  it('anon has no access; authenticated can read (RLS) and edit only name/avatar columns', () => {
    expect(sqlNoComments).toMatch(/REVOKE ALL ON public\.profiles FROM PUBLIC, anon, authenticated/)
    expect(sqlNoComments).toMatch(/GRANT SELECT ON public\.profiles TO authenticated/)
    expect(sqlNoComments).toMatch(
      /GRANT UPDATE \(first_name, last_name, display_name, avatar_url\) ON public\.profiles TO authenticated/
    )
    expect(sqlNoComments).not.toMatch(/GRANT\s+(ALL|UPDATE|INSERT|DELETE)\s+ON\s+public\.profiles\s+TO\s+authenticated/i)
  })

  it('RLS is enabled and the only policies are own-row/owner read and own-row update', () => {
    expect(sqlNoComments).toMatch(/ALTER TABLE public\.profiles ENABLE ROW LEVEL SECURITY/)
    const policies = [...sqlNoComments.matchAll(/CREATE POLICY (\w+)/g)].map((m) => m[1])
    expect(policies).toEqual(['profiles_select_own_or_owner', 'profiles_update_own'])
    expect(sqlNoComments).not.toMatch(/USING\s*\(\s*true\s*\)/i)
  })

  it('every SECURITY DEFINER function pins an empty search_path', () => {
    const functions = sqlNoComments.split(/CREATE FUNCTION/).slice(1)
    for (const fn of functions.filter((f) => /SECURITY DEFINER/.test(f))) {
      expect(fn).toMatch(/SET search_path = ''/)
    }
  })

  it('helper functions are not callable by anon; profiles cannot be hard deleted', () => {
    expect(sqlNoComments).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role/)
    expect(sqlNoComments).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_active_member\(\), public\.is_owner\(\) TO authenticated, service_role/)
    expect(sqlNoComments).toMatch(/BEFORE DELETE ON public\.profiles/)
    expect(sqlNoComments).toMatch(/ON DELETE RESTRICT/)
    expect(sqlNoComments).not.toMatch(/ON DELETE CASCADE/)
  })

  it('username is unique and stored lower-case', () => {
    expect(sqlNoComments).toMatch(/CREATE UNIQUE INDEX profiles_username_uidx ON public\.profiles \(username\)/)
    expect(sqlNoComments).toMatch(/username = lower\(btrim\(username\)\)/)
  })
})

describe('Application role trust (defense in depth)', () => {
  it('buildCurrentUser defaults to USER even if the client spoofs the role in metadata', () => {
    const spoofedAuthUser = {
      id: 'usr-attacker-01',
      email: 'attacker@example.com',
      user_metadata: { role: 'OWNER' },
    }
    expect(buildCurrentUser(spoofedAuthUser, { role: 'USER' }).role).toBe('USER')
    expect(buildCurrentUser(spoofedAuthUser, null).role).toBe('USER')
  })
})
