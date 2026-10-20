'use client'

import { useEffect, useState } from 'react'

/** `matchMedia(query).matches`, kept in sync; null until mounted (server render / first paint). */
export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null)

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

/** Tailwind `xl` (1280px): the desktop TopHeader shows; below it the Sidebar's mobile header. */
export const XL_MEDIA_QUERY = '(min-width: 1280px)'
