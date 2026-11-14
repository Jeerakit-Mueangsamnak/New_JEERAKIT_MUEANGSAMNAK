'use client'
import { useEffect, useState } from 'react'

/**
 * Opens LIFF for a form page inside LINE (owner 2026-11-13): init with NEXT_PUBLIC_LIFF_ID, log in
 * to LINE when needed, then the page has the SDK. Every request the page sends carries
 * liff.getIDToken(); the server checks it with LINE (lib/line/liff-request.ts).
 */
export type Liff = (typeof import('@line/liff'))['default']

export type LiffState = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; liff: Liff }

export function useLiff(): LiffState {
  const [state, setState] = useState<LiffState>({ phase: 'loading' })
  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    if (!liffId) {
      setState({ phase: 'error', message: 'ระบบ LINE ยังไม่ได้ตั้งค่า กรุณาแจ้งร้าน' })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const sdk = (await import('@line/liff')).default
        await sdk.init({ liffId })
        if (!sdk.isLoggedIn()) {
          sdk.login({ redirectUri: window.location.href })
          return
        }
        if (!cancelled) setState({ phase: 'ready', liff: sdk })
      } catch {
        if (!cancelled) setState({ phase: 'error', message: 'เปิดหน้านี้ไม่สำเร็จ กรุณาเปิดลิงก์ในแอป LINE อีกครั้ง' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

/** POST to a LIFF endpoint with the LINE ID token; the answer always has ok + message. */
export async function postLiff<T extends { ok: boolean; message?: string }>(liff: Liff, url: string, body: Record<string, unknown>): Promise<T> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, idToken: liff.getIDToken() }),
    })
    return (await res.json()) as T
  } catch {
    return { ok: false, message: 'ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่' } as T
  }
}
