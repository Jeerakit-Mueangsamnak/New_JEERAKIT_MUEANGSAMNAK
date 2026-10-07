'use client'

import React, { useEffect } from 'react'
import Image from 'next/image'
import { useStableOrientationHeight } from '@/lib/hooks/useDeviceOrientation'

/** Branding zone background — the single source for every Auth screen (light and dark). */
export const AUTH_BRANDING_BG = '#DFDFDF'

interface AuthLayoutProps {
  children: React.ReactNode
  brandingTitle?: string
  brandingSubtitle?: string
  brandingIcon?: React.ReactNode
  brandingBadge?: string
  showPinBadge?: boolean
  hideBrandingInPortrait?: boolean
  /** Extra classes for the root container (e.g. a higher z-index for overlays). */
  className?: string
  contentClassName?: string
}

/**
 * Shared layout for every Auth screen (Login, Register, Forgot/Reset Password,
 * Verify Email, PIN lock/setup, MFA challenge).
 *
 * - Landscape (iPad landscape, desktop): 50 / 50 — branding left, content right
 * - Portrait (iPad portrait, phones):    30 / 70 — branding top, content bottom
 *
 * Pages only render their own content; split ratio, content width, spacing,
 * logo sizing and alignment are owned here so the whole Auth flow stays uniform.
 */
export function AuthLayout({
  children,
  className = '',
  contentClassName = '',
}: AuthLayoutProps) {
  const { orientation, stableHeight } = useStableOrientationHeight()
  const isLandscape = orientation === 'landscape'

  // Split ratio — the single source of truth for every Auth screen:
  // landscape = 50 / 50 (side by side), portrait = 30 / 70 (stacked)
  const brandingFlex = isLandscape ? '0 0 50%' : '0 0 30%'
  const contentFlex = isLandscape ? '0 0 50%' : '0 0 70%'

  // Prevent unwanted window-level scroll shift on iOS Safari when focusing inputs
  useEffect(() => {
    const preventWindowScroll = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0)
      }
    }
    window.addEventListener('scroll', preventWindowScroll)
    return () => window.removeEventListener('scroll', preventWindowScroll)
  }, [])

  return (
    <div
      data-auth-layout={isLandscape ? 'landscape' : 'portrait'}
      className={`fixed top-0 left-0 right-0 w-full overflow-hidden overscroll-none bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex z-50 ${
        isLandscape ? 'flex-row' : 'flex-col'
      } ${className}`}
      style={{
        // Height is measured once per orientation so the virtual keyboard never resizes the split
        height: stableHeight ? `${stableHeight}px` : '100lvh',
      }}
    >
      {/*
        Branding / Logo Area:
        - Landscape: left 50%
        - Portrait:  top 30%
      */}
      <div
        data-auth-branding
        className={`relative flex items-center justify-center overflow-hidden min-w-0 min-h-0 text-center ${
          isLandscape
            ? 'h-full border-r border-slate-200 dark:border-slate-800 px-6 sm:px-10 lg:px-16 py-8'
            : 'w-full border-b border-slate-200 dark:border-slate-800 px-6 sm:px-10 py-4 sm:py-6'
        }`}
        style={{ flex: brandingFlex, backgroundColor: AUTH_BRANDING_BG }}
      >
        {/* Logo box: fills the branding area but never overflows it; aspect ratio kept by object-contain */}
        <div
          className={`relative z-10 flex items-center justify-center w-full h-full ${
            isLandscape ? 'max-w-md' : 'max-w-sm sm:max-w-md'
          }`}
        >
          <Image
            src="/logo.png"
            alt="JJK JEERAKIT PLASTIC FORMWORK UTTARADIT"
            width={896}
            height={254}
            priority
            unoptimized
            className="w-full h-auto max-h-full object-contain select-none"
          />
        </div>
      </div>

      {/*
        Content / Form Area:
        - Landscape: right 50%, content vertically centred
        - Portrait:  bottom 70%, content top-aligned (keeps inputs above the virtual keyboard)
        Inner wrapper uses min-h-full so tall content scrolls instead of being clipped.
      */}
      <div
        className={`relative min-w-0 min-h-0 overflow-y-auto overscroll-contain bg-white dark:bg-slate-900 ${
          isLandscape ? 'h-full' : 'w-full'
        } ${contentClassName}`}
        style={{ flex: contentFlex }}
      >
        <div
          className={`min-h-full w-full flex flex-col items-center px-6 sm:px-10 lg:px-16 py-8 sm:py-10 ${
            isLandscape ? 'justify-center' : 'justify-start'
          }`}
        >
          <div className="w-full max-w-sm sm:max-w-md flex flex-col items-center">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
