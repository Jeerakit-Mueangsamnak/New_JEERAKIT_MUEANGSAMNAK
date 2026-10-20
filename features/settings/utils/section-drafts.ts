import type { SettingsSection, SystemConfig } from '@/features/settings/services/settings-storage'
import { sectionPatch } from '@/features/settings/api/settings-repository'

/**
 * Per-section draft state of the Settings page. Each section keeps the server value it started
 * from, so a change pushed from the server (another device, the refresh on tab focus) updates
 * clean sections but never overwrites a section the OWNER is editing — that section is marked
 * as conflicted and keeps the draft until the OWNER saves or reloads it.
 */
export interface SectionState {
  /** Server config this section's draft is based on. */
  base: SystemConfig
  draft: SystemConfig
  /** The server value changed while this section had unsaved edits. */
  conflict: boolean
}

export type SectionDrafts = Record<SettingsSection, SectionState>

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'business',
  'taxDiscount',
  'payment',
  'salesRental',
  'product',
  'documentNumbering',
  'notifications',
  'shopSecurity',
  'line',
]

/** What a section would send — two configs are the same for a section when this matches. */
export function sectionKey(section: SettingsSection, cfg: SystemConfig): string {
  return JSON.stringify(sectionPatch(section, cfg))
}

export function isSectionDirty(state: SectionState, section: SettingsSection): boolean {
  return sectionKey(section, state.draft) !== sectionKey(section, state.base)
}

export function initSectionDrafts(server: SystemConfig): SectionDrafts {
  return Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s, { base: server, draft: server, conflict: false }])) as SectionDrafts
}

/** A new server config arrived: clean sections follow it, dirty ones keep their draft. */
export function applyServerUpdate(drafts: SectionDrafts, server: SystemConfig): SectionDrafts {
  const next = { ...drafts }
  for (const s of SETTINGS_SECTIONS) {
    const st = drafts[s]
    if (!isSectionDirty(st, s)) {
      next[s] = { base: server, draft: server, conflict: false }
    } else if (sectionKey(s, server) !== sectionKey(s, st.base)) {
      next[s] = { ...st, conflict: true }
    }
  }
  return next
}

/** After a section save: that section takes the saved value; the others are re-synced. */
export function applySectionSaved(drafts: SectionDrafts, section: SettingsSection, server: SystemConfig): SectionDrafts {
  const next = applyServerUpdate({ ...drafts, [section]: { base: server, draft: server, conflict: false } }, server)
  return next
}

/** Cancel / "โหลดค่าล่าสุด": the section's draft goes back to the latest server value. */
export function resetSection(drafts: SectionDrafts, section: SettingsSection, server: SystemConfig): SectionDrafts {
  return { ...drafts, [section]: { base: server, draft: server, conflict: false } }
}
