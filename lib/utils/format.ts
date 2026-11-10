/**
 * Shared display formats used by more than one screen.
 */

/**
 * Phone number as the shop writes it: digits only, max 10, dashes added while typing
 * (xxx-xxx-xxxx). Works the same for typed text and for a number filled in from a customer.
 */
export function formatPhoneNumber(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`
}

/** YYYY-MM-DD -> DD/MM/BBBB (Buddhist year), e.g. 15/10/2569; anything else is shown as-is. */
export function formatThaiNumericDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : iso || ''
}
