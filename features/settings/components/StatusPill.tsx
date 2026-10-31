/**
 * Shared status chip for the Settings › LINE screens (green = on/linked, grey = off/not linked).
 * Kept in its own .tsx file because the style module (settings-ui.ts) holds strings only.
 */
export function StatusPill({ ok, okText, noText }: { ok: boolean; okText: string; noText: string }) {
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-lg text-[11px] font-bold ${
        ok
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
      }`}
    >
      {ok ? okText : noText}
    </span>
  )
}
