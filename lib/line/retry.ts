import { type ProviderResult } from './types'

/**
 * Retry policy of the outbox. Each attempt re-sends with the SAME X-Line-Retry-Key, so a
 * request LINE already accepted is never delivered twice (LINE answers 409 for it).
 */
export const LINE_RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600, 10800] as const

export type AttemptOutcome =
  | { outcome: 'SENT' }
  | { outcome: 'RETRY'; retryAt: Date; errorCode: string }
  | { outcome: 'DEAD'; errorCode: string }

function errorCodeFor(result: ProviderResult): string {
  if (result.errorCode) return result.errorCode
  if (result.status === 0) return 'NETWORK'
  if (result.status === 401) return 'TOKEN_INVALID'
  if (result.status === 403) return 'FORBIDDEN'
  if (result.status === 429) return 'RATE_OR_QUOTA_LIMIT'
  if (result.status >= 500) return 'LINE_SERVER_ERROR'
  return `HTTP_${result.status}`
}

/** attempts = attempts already made including this one. */
export function decideAttempt(result: ProviderResult, attempts: number, maxAttempts: number, now: Date): AttemptOutcome {
  // 409 with a retry key = LINE already accepted this exact request earlier.
  if (result.ok || result.status === 409) return { outcome: 'SENT' }
  const errorCode = errorCodeFor(result)
  const retryable = result.status === 0 || result.status === 429 || result.status >= 500
  if (!retryable || attempts >= maxAttempts) return { outcome: 'DEAD', errorCode }
  const step = LINE_RETRY_BACKOFF_SECONDS[Math.min(Math.max(attempts - 1, 0), LINE_RETRY_BACKOFF_SECONDS.length - 1)]
  const waitSeconds = Math.max(step, result.retryAfterSeconds ?? 0)
  return { outcome: 'RETRY', retryAt: new Date(now.getTime() + waitSeconds * 1000), errorCode }
}
