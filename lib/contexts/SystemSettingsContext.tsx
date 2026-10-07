'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  SystemConfig,
  DEFAULT_SYSTEM_CONFIG,
  loadSystemSettings,
  saveSystemSettings,
  setCachedSystemSettings,
  ActorInfo,
} from '@/features/settings/services/settings-storage'
import { fetchSharedSystemConfig, saveSharedSystemConfig } from '@/features/settings/api/settings-repository'
import { createClient } from '@/lib/supabase/client'

interface SystemSettingsContextValue {
  settings: SystemConfig
  isLoaded: boolean
  updateSettings: (newConfig: SystemConfig, actor: ActorInfo, reason?: string) => Promise<SystemConfig>
  reloadSettings: () => void
}

const SystemSettingsContext = createContext<SystemSettingsContextValue>({
  settings: DEFAULT_SYSTEM_CONFIG,
  isLoaded: false,
  updateSettings: async () => DEFAULT_SYSTEM_CONFIG,
  reloadSettings: () => {},
})

export function SystemSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SystemConfig>(DEFAULT_SYSTEM_CONFIG)
  const [isLoaded, setIsLoaded] = useState(false)

  const reloadSettings = useCallback(() => {
    const loaded = loadSystemSettings()
    setSettings(loaded)
    setIsLoaded(true)
  }, [])

  useEffect(() => {
    let active = true
    const supabase = createClient()
    async function hydrateSettings() {
      setSettings(loadSystemSettings())
      try {
        // store_settings is readable only by signed-in ACTIVE members: do not ask before login
        // (an anonymous read is refused by the database).
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const shared = await fetchSharedSystemConfig()
        if (!active) return
        if (shared) {
          const loaded = setCachedSystemSettings(shared)
          setSettings(loaded)
        }
      } catch (error) {
        console.error('Failed to load shared system settings:', error)
      } finally {
        if (active) setIsLoaded(true)
      }
    }

    void hydrateSettings()

    const handleSettingsChanged = (e: Event) => {
      const customEvent = e as CustomEvent<SystemConfig>
      if (customEvent.detail) {
        setSettings(customEvent.detail)
      } else {
        reloadSettings()
      }
    }

    window.addEventListener('app_settings_changed', handleSettingsChanged)
    // Reload the shop settings whenever the signed-in user changes (login, logout, refresh).
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') void hydrateSettings()
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
      window.removeEventListener('app_settings_changed', handleSettingsChanged)
    }
  }, [reloadSettings])

  const updateSettings = useCallback(
    // The actor is taken from the signed-in session on the server (audit); kept for callers.
    async (newConfig: SystemConfig, _actor: ActorInfo, reason?: string): Promise<SystemConfig> => {
      await saveSharedSystemConfig(newConfig, reason)
      const saved = saveSystemSettings(newConfig)
      setSettings(saved)
      return saved
    },
    []
  )

  return (
    <SystemSettingsContext.Provider
      value={{
        settings,
        isLoaded,
        updateSettings,
        reloadSettings,
      }}
    >
      {children}
    </SystemSettingsContext.Provider>
  )
}

export function useSystemSettings() {
  const context = useContext(SystemSettingsContext)
  return context
}
