/**
 * Shared look for every Settings screen (ตั้งค่าระบบ, ตั้งค่าส่วนตัว, สิทธิ์ผู้ใช้):
 * one input / label / section / title style so the pages read as one system.
 * Main / sub tabs use TAB_* from components/common/ActionButton.
 */
export const SETTINGS_INPUT =
  'w-full h-9 px-3 py-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'
export const SETTINGS_INPUT_MONO = `${SETTINGS_INPUT} font-mono`
export const SETTINGS_LABEL = 'block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1'
export const SETTINGS_HELPER = 'text-[11px] text-slate-500 dark:text-slate-400'
/** A flat section separated by a divider (no card inside a card). */
export const SETTINGS_SECTION = 'py-4 px-3 sm:px-4 space-y-3 border-b border-slate-200 dark:border-slate-700 last:border-b-0'
export const SETTINGS_SECTION_TITLE = 'text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2'
