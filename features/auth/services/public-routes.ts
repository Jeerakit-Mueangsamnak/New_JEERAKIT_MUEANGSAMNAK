/**
 * Routes reachable without a Supabase session.
 * Shared by the server middleware guard and the client AuthShell so both agree.
 */
export const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/auth/callback',
  // Forms opened inside LINE (LIFF: /liff, /liff/bind, /liff/job, /liff/finance); each proves the person with a LINE ID token.
  '/liff',
]

/**
 * Machine endpoints called without a session; each checks its own signature. Exact match
 * only, so nothing else under /api becomes public.
 */
export const PUBLIC_API_ROUTES = [
  '/api/line/webhook', // LINE signature
  '/api/line/cron', // Bearer LINE_OUTBOX_CRON_SECRET
  '/api/line/outbox', // Bearer LINE_OUTBOX_CRON_SECRET
  '/api/line/liff-bind', // LINE ID token verified with LINE
  '/api/line/liff-job', // LINE ID token verified with LINE
  '/api/line/liff-finance', // LINE ID token verified with LINE
]

export function isPublicRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  if (PUBLIC_API_ROUTES.includes(pathname)) return true
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'))
}
