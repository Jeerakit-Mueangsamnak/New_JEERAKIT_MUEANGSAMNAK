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
import { checkAndExpireReservations } from '@/features/bills/services/bill-workflow-service'
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
    try {
      checkAndExpireReservations()
    } catch {
      // ignore on early boot
    }
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
    window.addEventListener('storage', reloadSettings)
    const settingsChannel = supabase
      .channel('shared-system-settings')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'system_settings', filter: 'id=eq.default' },
        async () => {
          const shared = await fetchSharedSystemConfig()
          if (active && shared) setSettings(setCachedSystemSettings(shared))
        }
      )
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(settingsChannel)
      window.removeEventListener('app_settings_changed', handleSettingsChanged)
      window.removeEventListener('storage', reloadSettings)
    }
  }, [reloadSettings])

  const updateSettings = useCallback(
    async (newConfig: SystemConfig, actor: ActorInfo, reason?: string): Promise<SystemConfig> => {
      await saveSharedSystemConfig(newConfig)
      const saved = saveSystemSettings(newConfig, actor, reason)
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
