/**
 * Shared look for every Settings screen (ตั้งค่าระบบ, ตั้งค่าส่วนตัว, สิทธิ์ผู้ใช้):
 * one input / label / section / title style so the pages read as one system.
 * Main / sub tabs use TAB_* from components/common/ActionButton.
 */
/** Fields = the customers menu fields (owner 2026-11-13: "ดูที่เมนูข้อมูลลูกค้าเป็นหลัก"). */
export const SETTINGS_INPUT =
  'w-full h-[30px] px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-xs font-bold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'
export const SETTINGS_INPUT_MONO = `${SETTINGS_INPUT} font-mono`
export const SETTINGS_LABEL = 'block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5'
export const SETTINGS_HELPER = 'text-[11px] text-slate-500 dark:text-slate-400'
/** A section placed straight on the work area (ตั้งค่าระบบ, customers-menu look): no side indent, so it lines up with the title line. */
export const SETTINGS_SECTION_FLAT = 'py-2 space-y-3 border-b border-slate-200 dark:border-slate-700 last:border-b-0'
export const SETTINGS_SECTION_TITLE = 'text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2'
/** A short settings list shown as a framed table (owner 2026-11-14): DataTableFrame with a border, rows not capped in height. */
export const SETTINGS_TABLE_FRAME = 'rounded-xl border border-[#acacad] bg-white dark:bg-slate-900'
export const SETTINGS_TABLE_BODY = '!min-h-0 !max-h-none'
