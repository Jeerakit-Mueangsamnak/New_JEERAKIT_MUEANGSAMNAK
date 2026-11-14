'use client'
/** What the customer sees in the LINE chat for a designed bill card (same layout as billDesignMessage). */
import React from 'react'
import type { FlexRow } from '@/lib/line/flex'

export function LineCardPreview({ title, badge, color, rows, text, footer }: { title: string; badge?: string; color: string; rows: FlexRow[]; text?: string; footer?: string }) {
  return (
    <div aria-label="ตัวอย่างการ์ด" className="w-full max-w-[19rem] rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-md text-slate-900">
      <div className="px-4 py-3.5 space-y-2" style={{ backgroundColor: color }}>
        <p className="text-base font-bold text-white break-words">{title || ' '}</p>
        {badge?.trim() && <span className="inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold text-white">{badge.trim()}</span>}
      </div>
      <div className="divide-y divide-slate-100">
        {text?.trim() && <p className="px-4 py-2.5 text-xs text-slate-700 whitespace-pre-wrap">{text.trim()}</p>}
        {rows.map((r) => (
          <div key={r.label} className="px-4 py-2.5 flex items-start justify-between gap-3 text-xs">
            <span className="text-slate-500 shrink-0">{r.label}</span>
            <span className="font-bold text-right break-words min-w-0">{r.value}</span>
          </div>
        ))}
      </div>
      {footer?.trim() && <p className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-600 whitespace-pre-wrap">{footer.trim()}</p>}
    </div>
  )
}
