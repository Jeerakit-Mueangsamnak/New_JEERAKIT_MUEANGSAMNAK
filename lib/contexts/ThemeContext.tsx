'use client'

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { logger } from '@/lib/utils/logger'

export type ThemeMode = 'light' | 'dark'

interface ThemeContextType {
  theme: ThemeMode
  isDark: boolean
  toggleTheme: () => void
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const THEME_STORAGE_KEY = 'rental_pos_theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light')

  // Initialize theme from localStorage or document element
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
      if (stored === 'light' || stored === 'dark') {
        setThemeState(stored)
        if (stored === 'dark') {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
      } else {
        // Default to light mode
        setThemeState('light')
        document.documentElement.classList.remove('dark')
        localStorage.setItem(THEME_STORAGE_KEY, 'light')
      }
    } catch {
      setThemeState('light')
      document.documentElement.classList.remove('dark')
    }
  }, [])

  // Where the last tap / click happened: the theme switch grows from there (owner 2026-11-16).
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const remember = (e: PointerEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointerdown', remember, { capture: true, passive: true })
    return () => window.removeEventListener('pointerdown', remember, { capture: true })
  }, [])

  const setTheme = useCallback((newTheme: ThemeMode) => {
    const commit = () => {
      flushSync(() => setThemeState(newTheme))
      try {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme)
      } catch (e) {
        logger.error('Failed to save theme to localStorage:', e)
      }
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    }
    const root = document.documentElement
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
    const same = root.classList.contains('dark') === (newTheme === 'dark')
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (same || reduceMotion || typeof doc.startViewTransition !== 'function') {
      commit()
      return
    }
    // A circle grows from the tap point until the new colours cover the screen (browsers without
    // View Transitions just switch at once).
    const { innerWidth: w, innerHeight: h } = window
    const x = lastPointer.current?.x ?? w - 40
    const y = lastPointer.current?.y ?? 28
    const radius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y))
    const transition = doc.startViewTransition(commit)
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 450, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
        )
      })
      .catch(() => undefined)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')
  }, [setTheme])

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
