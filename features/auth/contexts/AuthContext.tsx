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
  const latestProfileLoadRef = useRef<Promise<void> | null>(null)

  const clearAuthState = useCallback(() => {
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
    try {
      const { data: userData } = await supabase.auth.getUser()
      if (userData?.user) {
        const { data: sessionData } = await supabase.auth.getSession()
        await loadUserProfile(userData.user, sessionData?.session ?? null)
      } else {
        const { data: sessionData } = await supabase.auth.getSession()
        if (sessionData?.session?.user) {
          await loadUserProfile(sessionData.session.user, sessionData.session)
        } else {
          clearAuthState()
        }
      }
    } catch {
      // A failed check is not a sign-out: keep a user that was already read
      if (!userRef.current) clearAuthState()
    } finally {
      setLoading(false)
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
