'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  SystemConfig,
  SettingsSection,
  DEFAULT_SYSTEM_CONFIG,
  loadSystemSettings,
  setCachedSystemSettings,
} from '@/features/settings/services/settings-storage'
import { saveSettingsSection } from '@/features/settings/api/settings-repository'

/**
 * Read side of the shop settings. Loading has ONE owner: MasterDataProvider fetches
 * store_settings (sign-in, tab refocus) and puts it in the settings cache; this provider only
 * follows that cache and saves one section at a time (the saved row comes back from the
 * server, so nothing is fetched again).
 */
interface SystemSettingsContextValue {
  settings: SystemConfig
  isLoaded: boolean
  saveSection: (section: SettingsSection, draft: SystemConfig) => Promise<SystemConfig>
}

const SystemSettingsContext = createContext<SystemSettingsContextValue>({
  settings: DEFAULT_SYSTEM_CONFIG,
  isLoaded: false,
  saveSection: async () => DEFAULT_SYSTEM_CONFIG,
})

export function SystemSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SystemConfig>(() => loadSystemSettings())
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    setSettings(loadSystemSettings())
    const handleSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent<SystemConfig>).detail
      setSettings(detail ?? loadSystemSettings())
      setIsLoaded(true)
    }
    window.addEventListener('app_settings_changed', handleSettingsChanged)
    return () => window.removeEventListener('app_settings_changed', handleSettingsChanged)
  }, [])

  const saveSection = useCallback(async (section: SettingsSection, draft: SystemConfig): Promise<SystemConfig> => {
    const saved = await saveSettingsSection(section, draft)
    return setCachedSystemSettings(saved)
  }, [])

  return <SystemSettingsContext.Provider value={{ settings, isLoaded, saveSection }}>{children}</SystemSettingsContext.Provider>
}

export function useSystemSettings() {
  return useContext(SystemSettingsContext)
}
