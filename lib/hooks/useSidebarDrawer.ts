'use client'

import { create } from 'zustand'

/**
 * Open/close state of the sidebar drawer (below xl). Shared because the toggle lives in
 * TopHeader while the drawer lives in Sidebar — they are siblings in app/layout.tsx.
 */
interface SidebarDrawerState {
  isOpen: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useSidebarDrawer = create<SidebarDrawerState>((set) => ({
  isOpen: false,
  setOpen: (open) => set({ isOpen: open }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}))
