'use client'

import { useEffect } from 'react'

/**
 * Keeps a LINE list up to date without a รีเฟรช button (owner 2026-11-17): loads at once, again when the
 * shop comes back to the screen (focus / tab visible), and every `intervalMs` while the screen is visible.
 * `load` should be stable (useCallback); a new `load` (e.g. a changed filter) loads again.
 */
export function useAutoRefresh(load: () => unknown, intervalMs = 30_000) {
  useEffect(() => {
    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const t = setInterval(onVisible, intervalMs)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, intervalMs])
}
