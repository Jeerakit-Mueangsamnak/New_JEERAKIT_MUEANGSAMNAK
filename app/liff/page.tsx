'use client'
import React from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { useLiff } from '@/lib/line/use-liff'

/**
 * LIFF endpoint (<site>/liff). LINE opens this first for https://liff.line.me/<id>/<form>; liff.init
 * then moves on to /liff/<form> by itself. Opened without a form = nothing to show but a note.
 */
export default function LiffEntryPage() {
  const opened = useLiff()
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-black text-sm">
      {opened.phase === 'error' ? (
        <p className="flex items-start gap-2 text-red-700 dark:text-red-400">
          <AlertCircle className="w-5 h-5 shrink-0" /> {opened.message}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin" /> กำลังเปิด…
        </p>
      )}
    </main>
  )
}
