'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { buildCurrentUser } from '@/features/auth/services/auth-utils'
import { hasMenu as userHasMenu, type MenuCode } from '@/features/auth/services/permissions'
import { logout } from '@/app/actions/auth'
import type { CurrentUser, UserRole } from '@/lib/types/rental-pos'

export interface AuthContextType {
  user: CurrentUser | null
  session: Session | null
  loading: boolean
  role: UserRole | null
  /** UI hint only; the database enforces the same rule through RLS/RPC (_require_menu) */
  hasMenu: (code: MenuCode) => boolean
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  role: null,
  hasMenu: () => false,
  signOut: async () => {},
  refreshUser: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [role, setRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = useMemo(() => createClient(), [])
  // Last user built from a profile that was actually read; a slow or failed read keeps it.
  const userRef = useRef<CurrentUser | null>(null)
  // Only the newest profile load (or a sign-out after it) may set state.
  const profileRequestRef = useRef(0)
  // Session epoch: any auth call started in an older epoch must not set state.
  const authEpochRef = useRef(0)
  // Identity generation: bumped whenever the account changes, so a refresh that started
  // under an older account cannot apply its result after a switch.
  const identityGenRef = useRef(0)
  // Refresh generation: bumped when a refresh starts or when an account switch is observed,
  // so an older refresh cannot cancel or overwrite a newer account's pending profile.
  const refreshGenRef = useRef(0)
  const latestProfileLoadRef = useRef<Promise<void> | null>(null)

  const clearAuthState = useCallback(() => {
    authEpochRef.current += 1
    identityGenRef.current += 1
    refreshGenRef.current += 1
    profileRequestRef.current += 1
    latestProfileLoadRef.current = null
    userRef.current = null
    setUser(null)
    setRole(null)
    setSession(null)
  }, [])

  const readProfile = useCallback(async (authUser: User, currentSession: Session | null): Promise<void> => {
    const requestId = ++profileRequestRef.current
    const isLatest = () => requestId === profileRequestRef.current
    const lastKnown = userRef.current?.id === authUser.id ? userRef.current : null

    const apply = (nextUser: CurrentUser) => {
      if (userRef.current && userRef.current.id !== nextUser.id) {
        // The account changed: invalidate any refresh that started under the previous one.
        identityGenRef.current += 1
      }
      userRef.current = nextUser
      setUser(nextUser)
      setRole(nextUser.role)
      setSession(currentSession)
    }
    // Timeout / network / query error says nothing about the profile: keep the last one read.
    const keepLastKnown = () => {
      if (lastKnown) {
        setSession(currentSession)
        return
      }
      // First load with nothing read yet: unknown status fails closed (PENDING), as before
      apply(buildCurrentUser(authUser, null))
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const profilePromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle()

      // RLS returns only the signed-in user's own menu grants
      const grantsPromise = supabase
        .from('user_menu_access')
        .select('menu_code')
        .eq('user_id', authUser.id)

      const TIMED_OUT = { timedOut: true as const }
      const timeoutPromise = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), 3000)
      })

      const [result, grantsResult] = await Promise.all([
        Promise.race([profilePromise, timeoutPromise]),
        Promise.race([grantsPromise, timeoutPromise]),
      ])
      if (!isLatest()) return

      if ('timedOut' in result || result.error) {
        keepLastKnown()
        return
      }
      // Menus that failed to load keep the last known grants instead of dropping to none
      const grantsFailed = 'timedOut' in grantsResult || Boolean(grantsResult.error)
      const menuCodes = grantsFailed
        ? lastKnown?.menus ?? []
        : (grantsResult.data ?? []).map((row: { menu_code: string }) => row.menu_code)

      apply(buildCurrentUser(authUser, result.data ?? null, menuCodes))
    } catch {
      if (isLatest()) keepLastKnown()
    } finally {
      clearTimeout(timer)
    }
  }, [supabase])

  const loadUserProfile = useCallback((authUser: User, currentSession: Session | null): Promise<void> => {
    const run = readProfile(authUser, currentSession)
    latestProfileLoadRef.current = run
    // A superseded load resolves only once the newest one has set the user, so callers
    // (initAuth → loading=false) never see "no session" in between.
    return run.then(async () => {
      let latest = latestProfileLoadRef.current
      while (latest && latest !== run) {
        await latest
        if (latestProfileLoadRef.current === latest) break
        latest = latestProfileLoadRef.current
      }
    })
  }, [readProfile])

  const refreshUser = useCallback(async () => {
    // Any auth call that started before this run is stale, including one that answers
    // after a sign-out or an account switch: the run only applies its profile while the
    // epoch, the identity generation and its own refresh generation are unchanged.
    const epoch = authEpochRef.current
    const identityGen = identityGenRef.current
    const refreshGen = ++refreshGenRef.current
    const isStale = () =>
      epoch !== authEpochRef.current ||
      identityGen !== identityGenRef.current ||
      refreshGen !== refreshGenRef.current
    const expectedUserId = userRef.current?.id ?? null
    const isForeign = (userId: string | undefined | null) =>
      expectedUserId !== null && userId !== expectedUserId
    // A user and a session must belong to the same account; pairing A's user with B's session
    // would otherwise be applied as a valid profile.
    const isPaired = (userId: string, sessionUserId: string | undefined) =>
      sessionUserId === undefined || sessionUserId === userId

    try {
      const { data: userData } = await supabase.auth.getUser()
      if (isStale()) return
      if (userData?.user) {
        if (isForeign(userData.user.id)) return
        const { data: sessionData } = await supabase.auth.getSession()
        if (isStale()) return
        const session = sessionData?.session ?? null
        if (!isPaired(userData.user.id, session?.user?.id)) return
        await loadUserProfile(userData.user, session)
      } else {
        const { data: sessionData } = await supabase.auth.getSession()
        if (isStale()) return
        const nextUser = sessionData?.session?.user
        // A user that is not the account this run started under belongs to someone else now
        if (isForeign(nextUser?.id)) return
        if (nextUser && sessionData.session) {
          await loadUserProfile(nextUser, sessionData.session)
        } else {
          clearAuthState()
        }
      }
    } catch {
      if (isStale()) return
      // A failed check is not a sign-out: keep a user that was already read
      if (!userRef.current) clearAuthState()
    } finally {
      if (!isStale()) setLoading(false)
    }
  }, [supabase, loadUserProfile, clearAuthState])

  useEffect(() => {
    let isMounted = true

    // Initial session load with safety timer
    const initAuth = async () => {
      const safetyTimer = setTimeout(() => {
        if (isMounted) setLoading(false)
      }, 4000)

      try {
        const { data } = await supabase.auth.getSession()
        if (!isMounted) return
        const initialSession: Session | null = data?.session ?? null
        if (initialSession?.user) {
          await loadUserProfile(initialSession.user, initialSession)
        } else {
          const { data: userData } = await supabase.auth.getUser()
          if (!isMounted) return
          if (userData?.user) {
            const { data: sessionData } = await supabase.auth.getSession()
            await loadUserProfile(userData.user, sessionData?.session ?? null)
          } else {
            clearAuthState()
          }
        }
      } catch {
        if (isMounted && !userRef.current) {
          clearAuthState()
        }
      } finally {
        clearTimeout(safetyTimer)
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    initAuth()

    // Listen to Auth State Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event: AuthChangeEvent, currentSession: Session | null) => {
        if (!isMounted) return
        if (currentSession?.user) {
          // A different account is signing in without a sign-out: invalidate any auth call
          // (e.g. a hung refreshUser) that started under the previous account, so it cannot
          // cancel or overwrite this account's pending profile.
          if (userRef.current && userRef.current.id !== currentSession.user.id) {
            identityGenRef.current += 1
            refreshGenRef.current += 1
          }
          await loadUserProfile(currentSession.user, currentSession)
        } else {
          clearAuthState()
        }
        setLoading(false)
      }
    )

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [supabase, loadUserProfile, clearAuthState])

  const signOut = useCallback(async () => {
    try {
      await logout()
    } catch {
      // Ignore server action error
    }
    try {
      await supabase.auth.signOut()
    } catch {
      // Ignore network errors during signout
    } finally {
      clearAuthState()
      window.location.href = '/login'
    }
  }, [supabase, clearAuthState])

  const hasMenu = useCallback(
    (code: MenuCode) => userHasMenu(user, code),
    [user]
  )

  const contextValue = useMemo<AuthContextType>(() => ({
    user,
    session,
    loading,
    role,
    hasMenu,
    signOut,
    refreshUser,
  }), [user, session, loading, role, hasMenu, signOut, refreshUser])

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
