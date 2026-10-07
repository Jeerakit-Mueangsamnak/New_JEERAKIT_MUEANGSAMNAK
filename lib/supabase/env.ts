/**
 * Single source for Supabase public configuration (safe for browser + server).
 *
 * Public key: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (new `sb_publishable_...` key) is preferred;
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy anon JWT) is accepted as a fallback.
 * The secret / service_role key is NEVER read here — see lib/supabase/admin.ts (server-only).
 *
 * NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them in the browser bundle.
 */
export function getSupabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
}

export function getSupabasePublicKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim()
}

export function isSupabasePublicConfigValid(): boolean {
  const url = getSupabaseUrl()
  const key = getSupabasePublicKey()
  return Boolean(url && key && !url.includes('placeholder') && !key.includes('placeholder'))
}

/**
 * Only allow same-site relative paths as post-auth destinations (blocks open redirects
 * such as `//evil.com` or `https://evil.com`).
 */
export function safeRedirectPath(path: string | null | undefined, fallback = '/pos'): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
    return fallback
  }
  // URL parsing strips tab/newline and treats `\` as `/`, so `/\t/evil.com` would become `//evil.com`
  if (/[\u0000-\u001F\u007F\\]/.test(path)) return fallback
  try {
    if (new URL(path, 'http://same.invalid').origin !== 'http://same.invalid') return fallback
  } catch {
    return fallback
  }
  return path
}
