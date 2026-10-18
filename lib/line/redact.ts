/**
 * Removes credentials from anything that may reach a log or an error message: bearer
 * tokens, the known secret values, and long opaque strings that look like tokens.
 */
export function redactSecrets(text: string, knownSecrets: ReadonlyArray<string | null | undefined> = []): string {
  let out = String(text ?? '')
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[REDACTED]')
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Za-z0-9+/=_-]{120,}\b/g, '[REDACTED]')
}
