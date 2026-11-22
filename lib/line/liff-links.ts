/**
 * Links to the forms that open inside LINE (LIFF, owner 2026-11-13). One LIFF app whose endpoint is
 * <site>/liff; LINE adds the path after the LIFF id: https://liff.line.me/<id>/bind → <site>/liff/bind.
 * No LIFF id = no link (the screens say the form is not set up yet).
 */
export type LiffForm = 'bind' | 'job' | 'finance' | 'register'

export function liffUrl(form: LiffForm, params: Record<string, string> = {}, liffId: string | undefined = process.env.NEXT_PUBLIC_LIFF_ID): string | null {
  const id = (liffId || '').trim()
  if (!id) return null
  const query = new URLSearchParams(params).toString()
  return `https://liff.line.me/${encodeURIComponent(id)}/${form}${query ? `?${query}` : ''}`
}
