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

/**
 * ตั้งค่า LINE (in คนใน LINE) has sub-pages; บันทึกการตั้งค่า saves only the sub-page that is open
 * (owner 2026-11-06: "บันทึกหน้าต่อหน้า"). Each saving sub-page owns one part of policies.line.
 */
export type LinePart = 'notify' | 'templates' | 'other'
export const LINE_VIEW_PART: Readonly<Record<string, LinePart>> = { NOTIFY: 'notify', TEMPLATES: 'templates', SCHEDULE: 'other' }
const LINE_PARTS: readonly LinePart[] = ['notify', 'templates', 'other']

/** The config this sub-page's บันทึก sends: the saved LINE settings with only `part` taken from the draft. */
export function withLinePart(saved: SystemConfig, draft: SystemConfig, part: LinePart): SystemConfig {
  return { ...saved, line: { ...saved.line, [part]: draft.line[part] } }
}

/** This sub-page has changes not saved yet. */
export function isLinePartDirty(state: SectionState, part: LinePart): boolean {
  return sectionKey('line', withLinePart(state.base, state.draft, part)) !== sectionKey('line', state.base)
}

/** After one LINE sub-page is saved: the other sub-pages keep their unsaved changes. */
export function applyLinePartSaved(state: SectionState, part: LinePart, server: SystemConfig): SectionState {
  const kept = Object.fromEntries(LINE_PARTS.filter((p) => p !== part).map((p) => [p, state.draft.line[p]]))
  return { base: server, draft: { ...server, line: { ...server.line, ...kept } }, conflict: false }
}

/** "คืนค่าที่บันทึกไว้" on a LINE sub-page: only that sub-page goes back. */
export function resetLinePart(state: SectionState, part: LinePart, server: SystemConfig): SectionState {
  return { ...state, draft: { ...state.draft, line: { ...state.draft.line, [part]: server.line[part] } } }
}
