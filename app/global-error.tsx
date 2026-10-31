'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import './globals.css'

// Last-resort screen when a page crashes; the error goes to Sentry (when enabled).
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="th">
      <body className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">ระบบขัดข้องชั่วคราว</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          ระบบบันทึกปัญหานี้ไว้แล้ว กรุณาโหลดหน้าใหม่ ถ้ายังเป็นอยู่ให้แจ้งเจ้าของร้าน
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm rounded-xl"
        >
          โหลดหน้าใหม่
        </button>
      </body>
    </html>
  )
}
