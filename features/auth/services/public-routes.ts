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
]

export function isPublicRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'))
}
